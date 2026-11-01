/** Restricted preference access through the installed OpenViking runtime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { Session } from '@deepseek-ai/dsh-session'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'

interface MemoryRuntime {
  readonly client: {
    fetchJSON(path: string, init: { method?: string; body?: string }, options: { actorPeerId: string }): Promise<unknown>
  }
  resolveSessionPeer(cwd: string): unknown
}

const keySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u)
// Forbidden shapes: control characters, URLs, secret-looking words, temporary approval,
// inferred identity, and long opaque blobs that are probably credentials.
const forbidden = new RegExp(
  '[\\n\\r`<>]|https?:|\\b(?:api[ _-]?key|token|password|secret|credential|authorization'
    + '|bearer|private[ _-]?key|once|today|temporary|this session|approve|allow|permission'
    + '|my name|I am|I live|I work)\\b|密钥|密码|令牌|凭据|授权|仅本次|这次|今天|临时|不要记住|别记住'
    + '|sk-[\\w-]+|[\\w+/=-]{32,}',
  'iu',
)
const segmentSchema = z.string().regex(/^[-a-zA-Z0-9_][-.a-zA-Z0-9_]{0,199}$/u)
const responseSchema = z.object({
  ok: z.boolean(), status: z.number().int().min(0).max(599), result: z.unknown(),
  error: z.looseObject({ code: z.string().optional() }).optional(),
})
const mutationSchema = z.object({
  operation: z.enum(['remember', 'correct', 'forget']), scope: z.enum(['global', 'project']),
  projectCwd: z.string().optional(), key: keySchema, text: z.string().optional(),
  evidenceSeq: z.number().int().nonnegative(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict()
const queueSchema = z.record(z.string(), z.object({
  processed: z.number().int().nonnegative(), requeue_count: z.number().int().nonnegative(),
  error_count: z.literal(0), errors: z.array(z.unknown()).length(0),
}).strict())
const mutationResponseSchema = z.object({
  uri: z.string(), semantic_status: z.string().optional(), queue_status: z.unknown().optional(),
  vector_status: z.string().optional(), overview_status: z.string().optional(),
})
const writeResponseSchema = mutationResponseSchema.extend({
  root_uri: z.string(), context_type: z.literal('memory'), mode: z.enum(['create', 'replace']),
  content_updated: z.literal(true), written_bytes: z.number().int().nonnegative(),
  semantic_status: z.string(), vector_status: z.string(),
})
const findSchema = z.object({
  memories: z.array(z.object({ uri: z.string(), context_type: z.literal('memory'), level: z.literal(2) })).max(8),
  resources: z.array(z.unknown()).length(0), skills: z.array(z.unknown()).length(0), total: z.number().int().nonnegative(),
})

/** One fresh preference; project entries precede global entries without merging their text. */
export interface ManagerPreference {
  readonly scope: 'global' | 'project'
  readonly key: string
  readonly uri: string
  readonly text: string
  readonly hash: string
}

/** Failures never imply rollback; source reports the known mutation outcome. */
export interface PreferenceFailure {
  readonly status: 'unavailable' | 'rejected' | 'conflict' | 'partial' | 'unknown'
  readonly source: 'unchanged' | 'updated' | 'deleted' | 'unknown'
  readonly message: string
}

/** Complete bounded lookup result; truncation drops whole entries, never preference text. */
export type PreferenceLookupResult = { readonly status: 'ok'; readonly preferences: ManagerPreference[]; readonly truncated: boolean } | PreferenceFailure

/** Mutation input; projectCwd must be resolved and authorized by the Host, never copied from model JSON. */
export interface PreferenceMutation {
  readonly operation: 'remember' | 'correct' | 'forget'
  readonly scope: 'global' | 'project'
  readonly projectCwd?: string
  readonly key: string
  readonly text?: string
  readonly evidenceSeq: number
  readonly expectedHash?: string
}

/** A successful mutation has fresh content and completed indexing; partial and unknown outcomes require inspection. */
export type PreferenceMutationResult = {
  readonly status: 'ok'
  readonly operation: PreferenceMutation['operation']
  readonly scope: PreferenceMutation['scope']
  readonly key: string
  readonly uri: string
  readonly hash?: string
} | PreferenceFailure

class PreferenceError extends Error {
  constructor(readonly failure: PreferenceFailure) { super(failure.message) }
}
const fail = (message: string, status: PreferenceFailure['status'] = 'unavailable', source: PreferenceFailure['source'] = 'unchanged'): never => {
  throw new PreferenceError({ status, source, message })
}
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value))
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function isMemoryRuntime(value: unknown): value is MemoryRuntime {
  return record(value) && record(value.client) && typeof value.client.fetchJSON === 'function' && typeof value.resolveSessionPeer === 'function'
}

function memoryRuntime(value: unknown): MemoryRuntime {
  if (!isMemoryRuntime(value)) return fail('Installed OpenViking preference access is unavailable.')
  return value
}

/** Purpose-built preference lookup and direct-human-authorized mutation; no recall or adapter cache. */
export class ManagerPreferences {
  /** @param ctx - Host services. @param maxMessageBytes - Complete JSON result byte ceiling, at least 128. */
  constructor(private readonly ctx: Context, private readonly maxMessageBytes: number) {
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 128) throw new Error('Preference byte limit must be an integer of at least 128')
  }

  private failure(error: unknown): PreferenceFailure {
    const value: PreferenceFailure = error instanceof PreferenceError ? error.failure : {
      status: 'unavailable', source: 'unchanged', message: 'Preference access failed; ask the user before relying on preferences.',
    }
    return bytes(value) <= this.maxMessageBytes ? value : { status: value.status, source: value.source, message: 'Preference operation failed.' }
  }

  private async request(
    runtime: MemoryRuntime, peer: string, path: string, signal: AbortSignal, init: { method?: string; body?: string } = {},
  ) {
    signal.throwIfAborted()
    const response = responseSchema.safeParse(await runtime.client.fetchJSON(path, init, { actorPeerId: peer }))
    signal.throwIfAborted()
    if (!response.success || (response.data.ok && (response.data.status < 200 || response.data.status >= 300))) return fail('OpenViking returned an invalid response.')
    return response.data
  }

  private async roots(projectCwd: string | undefined, signal: AbortSignal) {
    const runtime = memoryRuntime(this.ctx.get('openvikingMemory'))
    let peer = ''
    if (projectCwd !== undefined) {
      if (!isAbsolute(projectCwd) || projectCwd.includes('\0')) return fail('Project cwd must be Host-resolved.', 'rejected')
      const resolved = z.object({ peerId: segmentSchema }).safeParse(runtime.resolveSessionPeer(projectCwd))
      if (!resolved.success) return fail('OpenViking has no safe project peer for this cwd.')
      peer = resolved.data.peerId
    }
    const response = await this.request(runtime, peer, '/api/v1/system/status', signal)
    const identity = z.object({ initialized: z.literal(true), user: segmentSchema }).safeParse(response.result)
    if (!response.ok || !identity.success) return fail('OpenViking user identity is unavailable.')
    const home = `viking://user/${identity.data.user}`
    const roots = [
      ...(peer === '' ? [] : [{ scope: 'project' as const, alias: `viking://~/peers/${peer}/memories/preferences`, uri: `${home}/peers/${peer}/memories/preferences` }]),
      { scope: 'global' as const, alias: 'viking://~/memories/preferences', uri: `${home}/memories/preferences` },
    ]
    return { runtime, peer, roots }
  }

  private leaf(uri: string, roots: Awaited<ReturnType<ManagerPreferences['roots']>>['roots']) {
    for (const root of roots) {
      for (const prefix of [root.uri, root.alias]) {
        if (!uri.startsWith(`${prefix}/`) || !uri.endsWith('.md')) continue
        const key = keySchema.safeParse(uri.slice(prefix.length + 1, -3))
        if (key.success) return { scope: root.scope, key: key.data, uri: `${root.uri}/${key.data}.md` }
      }
    }
    return fail('OpenViking returned a preference outside the requested scope.')
  }

  private async read(runtime: MemoryRuntime, peer: string, uri: string, signal: AbortSignal): Promise<string | undefined> {
    const response = await this.request(runtime, peer, `/api/v1/content/read?${new URLSearchParams({ uri, raw: 'true' })}`, signal)
    if (!response.ok && response.status === 404 && response.error?.code === 'NOT_FOUND') return undefined
    if (!response.ok || typeof response.result !== 'string') return fail('Fresh preference content is unavailable.')
    return response.result
  }

  private async authorize(session: Session, input: PreferenceMutation, signal: AbortSignal): Promise<void> {
    const sessions = this.ctx.get('sessions')
    const controller = this.ctx.get('sessionController')
    if (sessions === undefined || controller === undefined || this.ctx.get('sessionPersistence') === undefined
      || sessions.get(session.id) !== session || !(await sessions.flush(session))) return fail('Durable human preference evidence is required.', 'rejected')
    signal.throwIfAborted()
    using observation = await this.ctx.sessionQuery.observeSession(session.id, { signal, projectionMode: 'none' })
    const events = observation.events
    const event = events[input.evidenceSeq]
    const latest = events.findLast(item => item.type === 'user/message' && item.data.source.kind === 'user')
    if (observation.header.origin === 'subagent' || input.evidenceSeq < observation.inheritedEventCount || event?.seq !== input.evidenceSeq
      || event.type !== 'user/message' || event.data.source.kind !== 'user' || event.surfaceOp !== 'append'
      || event.sourceEventSeqs !== undefined || latest !== event
      || events.some(item => typeof item.surfaceOp === 'object' && item.surfaceOp.startSeq <= event.seq && item.surfaceOp.endSeq >= event.seq)
      || event.data.content.some(block => block.type !== 'text')) return fail('Use the latest actual direct-human preference request.', 'rejected')
    const text = event.data.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    // ponytail: exact directives only; broader prose requires explicit human clarification, not inferred authorization.
    const english = /^(Remember|Correct|Forget) (global|project) preference ([a-z0-9][a-z0-9_-]{0,79})(?:: (.+))?$/iu.exec(text)
    const chinese = /^(全局|项目)(记住|更正|忘记)偏好 ([a-z0-9][a-z0-9_-]{0,79})(?:[：:] ?(.+))?$/u.exec(text)
    const chineseOperations: Readonly<Record<string, string>> = { 记住: 'remember', 更正: 'correct', 忘记: 'forget' }
    const operation = english?.[1]?.toLowerCase() ?? chineseOperations[chinese?.[2] ?? '']
    const scope = english?.[2]?.toLowerCase() ?? (chinese?.[1] === '全局' ? 'global' : chinese?.[1] === '项目' ? 'project' : undefined)
    const key = english?.[3] ?? chinese?.[3]
    const content = english?.[4] ?? chinese?.[4]
    if (bytes(text) > this.maxMessageBytes || operation !== input.operation || scope !== input.scope || key !== input.key
      || content !== input.text) return fail('Request the exact preference operation, scope, key and text directly from the human.', 'rejected')
    if (input.operation === 'forget') return
    if (content === undefined || content.trim() !== content || Buffer.byteLength(content) < 8
      || !/^(?:I (?:prefer|like)\b|(?:Please )?always\b|我(?:偏好|更喜欢|喜欢)|以后|默认)/iu.test(content)
      || forbidden.test(content)) {
      return fail('Only a minimal lasting preference is allowed; no secrets, facts or temporary authorization.', 'rejected')
    }
  }

  /**
   * Mutate only after a flushed native direct-human message: `Remember|Correct global|project preference key: text`,
   * or `Forget global|project preference key`; Chinese accepts `全局|项目记住|更正|忘记偏好 key：text`.
   * Corrections check a fresh SHA-256 before writing; the backend has no atomic conditional-write API.
   * @param session - Attached Session containing the latest, unreplaced, non-inherited direct-human evidence.
   * @param input - Explicit operation, scope, key, exact minimal text and evidence seq; project cwd is Host-resolved.
   * @param signal - Caller cancellation; in-flight writes settle under the installed transport's timeout, never imply rollback.
   * @returns Complete bounded success, rejection, partial source mutation, or unknown outcome; never retries writes.
   */
  async mutate(session: Session, input: PreferenceMutation, signal: AbortSignal): Promise<PreferenceMutationResult> {
    let source: PreferenceFailure['source'] = 'unchanged'
    try {
      signal.throwIfAborted()
      const parsed = mutationSchema.safeParse(input)
      if (!parsed.success || bytes(input) > this.maxMessageBytes || (input.scope === 'project' && input.projectCwd === undefined)
        || (input.operation === 'forget' && input.text !== undefined) || (input.operation !== 'forget' && input.text === undefined)
        || (input.operation === 'correct' && input.expectedHash === undefined)) return fail('Supply an explicit valid preference request and correction hash.', 'rejected')
      await this.authorize(session, input, signal)
      const { runtime, peer, roots } = await this.roots(input.scope === 'project' ? input.projectCwd : undefined, signal)
      const root = roots.find(item => item.scope === input.scope)
      if (root === undefined) return fail('Project preference scope could not be resolved.', 'rejected')
      const uri = `${root.alias}/${input.key}.md`
      const canonical = `${root.uri}/${input.key}.md`
      if (input.operation !== 'remember') {
        const current = await this.read(runtime, peer, uri, signal)
        if (current === undefined || (input.expectedHash !== undefined && hash(current) !== input.expectedHash)) return fail('Preference changed or disappeared; look it up before retrying.', 'conflict')
      }
      const success: PreferenceMutationResult = { status: 'ok', operation: input.operation, scope: input.scope, key: input.key, uri: canonical,
        ...(input.text === undefined ? {} : { hash: hash(input.text) }) }
      if (bytes(success) > this.maxMessageBytes) return fail('Preference result exceeds the byte limit.', 'rejected')
      signal.throwIfAborted()
      source = 'unknown'
      const response = input.operation === 'forget'
        ? await this.request(runtime, peer, `/api/v1/fs?${new URLSearchParams({ uri, recursive: 'false', wait: 'true' })}`, signal, { method: 'DELETE' })
        : await this.request(runtime, peer, '/api/v1/content/write', signal, { method: 'POST', body: JSON.stringify({ uri, content: input.text,
          mode: input.operation === 'remember' ? 'create' : 'replace', wait: true }) })
      if (!response.ok) {
        if (input.operation === 'remember' && response.status === 409 && response.error?.code === 'ALREADY_EXISTS') {
          source = 'unchanged'
          return fail('Preference already exists; look it up before correcting it.', 'conflict')
        }
        return fail('Preference source may have changed; inspect before retrying.', 'unknown', 'unknown')
      }
      const result = (input.operation === 'forget' ? mutationResponseSchema : writeResponseSchema).safeParse(response.result)
      if (!result.success || this.leaf(result.data.uri, roots).uri !== canonical) return fail('Preference mutation outcome is unknown.', 'unknown', 'unknown')
      if (input.operation !== 'forget') {
        const written = writeResponseSchema.parse(result.data)
        if (written.root_uri !== root.uri && written.root_uri !== root.alias) return fail('Preference mutation outcome is unknown.', 'unknown', 'unknown')
        if (written.mode !== (input.operation === 'remember' ? 'create' : 'replace') || written.written_bytes !== Buffer.byteLength(input.text ?? '')) return fail('Preference mutation outcome is unknown.', 'unknown', 'unknown')
      }
      source = input.operation === 'forget' ? 'deleted' : 'updated'
      const queue = result.data.queue_status
      if ((queue !== undefined && queue !== null && !queueSchema.safeParse(queue).success)
        || (result.data.semantic_status !== undefined && !['complete', 'skipped'].includes(result.data.semantic_status))
        || (result.data.overview_status !== undefined && !['complete', 'skipped'].includes(result.data.overview_status))
        || (input.operation !== 'forget' && result.data.vector_status !== 'complete')
        || (input.operation === 'forget' && result.data.vector_status !== undefined && result.data.vector_status !== 'complete')) {
        return fail('Preference source changed but search freshness is unconfirmed; inspect before retrying.', 'partial', source)
      }
      const confirmed = await this.read(runtime, peer, uri, signal)
      if (confirmed !== input.text) return fail('Preference source changed but verification failed; inspect before retrying.', 'partial', source)
      return success
    } catch (error) {
      if (source !== 'unchanged') return this.failure(new PreferenceError({ status: source === 'unknown' ? 'unknown' : 'partial', source,
        message: 'Preference source may have changed; inspect before retrying.' }))
      return this.failure(error)
    }
  }

  /**
   * Read scoped leaf files freshly, never search abstracts or context-mode recall.
   * @param input - Search text and optional Host-resolved owned worker cwd; never pass a model-supplied path.
   * @param signal - Caller cancellation; the installed transport owns its network timeout.
   * @returns Complete JSON bounded by the constructor's byte ceiling, or explicit unavailability.
   */
  async lookup(input: { query: string; projectCwd?: string }, signal: AbortSignal): Promise<PreferenceLookupResult> {
    try {
      if (!input.query.trim() || bytes(input) > this.maxMessageBytes) return fail('Supply a bounded preference query.', 'rejected')
      const { runtime, peer, roots } = await this.roots(input.projectCwd, signal)
      const response = await this.request(runtime, peer, '/api/v1/search/find', signal, { method: 'POST', body: JSON.stringify({
        query: input.query, target_uri: roots.map(root => root.alias), context_type: 'memory', limit: 8, level: 2,
      }) })
      const found = findSchema.safeParse(response.result)
      if (!response.ok || !found.success) return fail('Scoped preference search failed; do not assume no preferences exist.')
      const leaves = found.data.memories.map(hit => this.leaf(hit.uri, roots))
        .sort((a, b) => Number(a.scope === 'global') - Number(b.scope === 'global'))
      const result = { status: 'ok' as const, preferences: [] as ManagerPreference[], truncated: found.data.total > leaves.length }
      for (const leaf of leaves) {
        if (result.preferences.some(item => item.uri === leaf.uri)) continue
        const text = await this.read(runtime, peer, leaf.uri, signal)
        if (text === undefined) { result.truncated = true; continue }
        const preference = { ...leaf, text, hash: hash(text) }
        const next = { ...result, preferences: [...result.preferences, preference], truncated: false }
        if (bytes(next) > this.maxMessageBytes) result.truncated = true
        else result.preferences.push(preference)
      }
      return result
    } catch (error) { return this.failure(error) }
  }
}
