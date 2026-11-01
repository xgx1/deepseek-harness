import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { bootManagementHost, type ManagementHost } from './fixtures/native-management/host.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { ManagerPreferences } from '../src/preferences.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function backend(ctx = new Context(), ownedCwd = '/owned/project') {
  if (!contexts.includes(ctx)) contexts.push(ctx)
  const files = new Map([
    ['viking://user/alice/memories/preferences/language.md', 'I prefer Chinese.'],
    ['viking://user/alice/peers/repo/memories/preferences/language.md', 'I prefer English.'],
  ])
  const requests: { path: string; init: { method?: string; body?: string }; actorPeerId?: string }[] = []
  const runtime = {
    resolveSessionPeer: (cwd: string) => {
      expect(cwd).toBe(ownedCwd)
      return { peerId: 'repo', legacyPeerId: '' }
    },
    client: {
      async fetchJSON(
        path: string, init: { method?: string; body?: string } = {}, options: { actorPeerId?: string } = {},
      ): Promise<unknown> {
        requests.push({ path, init, ...options })
        if (path === '/api/v1/system/status') return { ok: true, status: 200, result: { initialized: true, user: 'alice' } }
        if (path === '/api/v1/search/find') {
          const query = z.object({ query: z.string(), target_uri: z.array(z.string()), context_type: z.literal('memory'), limit: z.literal(8), level: z.literal(2) }).strict().parse(JSON.parse(init.body ?? 'null'))
          const uris = [...files.keys()].filter(uri => query.target_uri.some(root => uri.startsWith(`${root.replace('viking://~/', 'viking://user/alice/')}/`)))
          return { ok: true, status: 200, result: {
            memories: uris.map(uri => ({ uri, context_type: 'memory', level: 2, score: 0.9, abstract: 'stale summary', tags: [] })),
            resources: [], skills: [], total: uris.length,
          } }
        }
        if (path === '/api/v1/content/write') {
          const body = z.object({ uri: z.string(), content: z.string(), mode: z.enum(['create', 'replace']), wait: z.literal(true) }).strict().parse(JSON.parse(init.body ?? 'null'))
          const uri = body.uri.replace('viking://~/', 'viking://user/alice/')
          if (body.mode === 'create' && files.has(uri)) return { ok: false, status: 409, result: null, error: { code: 'ALREADY_EXISTS' } }
          files.set(uri, body.content)
          return { ok: true, status: 200, result: { uri, root_uri: uri.slice(0, uri.lastIndexOf('/')), context_type: 'memory', mode: body.mode,
            written_bytes: Buffer.byteLength(body.content), content_updated: true, semantic_status: 'skipped', vector_status: 'complete', overview_status: 'complete', queue_status: null } }
        }
        const url = new URL(path, 'http://stub.invalid')
        const uri = url.searchParams.get('uri')?.replace('viking://~/', 'viking://user/alice/') ?? ''
        if (url.pathname === '/api/v1/content/read') {
          expect(url.searchParams.get('raw')).toBe('true')
          return files.has(uri) ? { ok: true, status: 200, result: files.get(uri) }
            : { ok: false, status: 404, result: null, error: { code: 'NOT_FOUND', message: 'missing' } }
        }
        if (url.pathname === '/api/v1/fs') {
          expect(init.method).toBe('DELETE')
          expect(url.searchParams.get('recursive')).toBe('false')
          expect(url.searchParams.get('wait')).toBe('true')
          files.delete(uri)
          return { ok: true, status: 200, result: { uri, estimated_deleted_count: 1 } }
        }
        throw new Error(`Unexpected external request ${path}`)
      },
    },
  }
  ctx.provide('openvikingMemory', runtime)
  return { ctx, runtime, files, requests }
}

async function world() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-manager-preferences-')))
  roots.push(root)
  const host = await bootManagementHost(root, ctx => contexts.push(ctx))
  const cwd = join(root, 'work')
  await mkdir(cwd)
  const workspace = await host.ctx.workspaceRegistry.create(cwd)
  const owner = await host.create('preference-owner', workspace)
  return { ...backend(host.ctx, cwd), host, owner, cwd }
}

async function evidence(host: ManagementHost, owner: Agent, text: string) {
  await host.turn(owner, text)
  const events = owner.session.snapshotEvents()
  const event = events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (event === undefined) throw new Error('Direct human evidence was not logged')
  return event.seq
}

describe('restricted manager preferences', () => {
  it('creates, freshness-checks corrections, and forgets only an exact direct-human-authorized key and scope', async () => {
    const f = await world()
    const adapter = new ManagerPreferences(f.ctx, 2048)
    const signal = new AbortController().signal
    const evidenceSeq = await evidence(f.host, f.owner, 'Remember global preference tone: I prefer short answers.')
    const remembered = await adapter.mutate(f.owner.session, { operation: 'remember', scope: 'global', key: 'tone', text: 'I prefer short answers.', evidenceSeq }, signal)
    expect(remembered).toMatchObject({ status: 'ok', operation: 'remember', uri: 'viking://user/alice/memories/preferences/tone.md' })
    expect(f.files.get('viking://user/alice/memories/preferences/tone.md')).toBe('I prefer short answers.')
    if (remembered.status !== 'ok' || remembered.hash === undefined) throw new Error('Remember did not return a freshness hash')
    const correction = await evidence(f.host, f.owner, 'Correct global preference tone: I prefer detailed answers.')
    const corrected = await adapter.mutate(f.owner.session, { operation: 'correct', scope: 'global', key: 'tone', text: 'I prefer detailed answers.', evidenceSeq: correction, expectedHash: remembered.hash }, signal)
    expect(corrected).toMatchObject({ status: 'ok', operation: 'correct' })
    expect(f.files.get('viking://user/alice/memories/preferences/tone.md')).toBe('I prefer detailed answers.')
    const deletion = await evidence(f.host, f.owner, 'Forget global preference tone')
    expect(await adapter.mutate(f.owner.session, { operation: 'forget', scope: 'project', projectCwd: f.cwd, key: 'tone', evidenceSeq: deletion }, signal)).toMatchObject({ status: 'rejected', source: 'unchanged' })
    expect(await adapter.mutate(f.owner.session, { operation: 'forget', scope: 'global', key: 'tone', evidenceSeq: deletion }, signal)).toMatchObject({ status: 'ok', operation: 'forget' })
    expect(f.files.has('viking://user/alice/memories/preferences/tone.md')).toBe(false)
  })

  it('rejects worker reports and inherited or superseded human evidence before contacting OpenViking', async () => {
    const f = await world()
    const adapter = new ManagerPreferences(f.ctx, 2048)
    const command = 'Remember global preference tone: I prefer short answers.'
    const evidenceSeq = await evidence(f.host, f.owner, command)
    const input = { operation: 'remember' as const, scope: 'global' as const, key: 'tone', text: 'I prefer short answers.', evidenceSeq }
    const fork = f.ctx.sessions.fork(f.owner.session, undefined, SessionId('preference-fork'))
    expect(await adapter.mutate(fork, input, new AbortController().signal)).toMatchObject({ status: 'rejected', source: 'unchanged' })
    await evidence(f.host, f.owner, 'That earlier preference request is withdrawn.')
    expect(await adapter.mutate(f.owner.session, input, new AbortController().signal)).toMatchObject({ status: 'rejected', source: 'unchanged' })
    const report = f.owner.session.append('user/message', createUserMessage({ source: {
      kind: 'session-manager', deliveryId: MessageId('preference-report'), managerSessionId: f.owner.id, workerSessionId: f.owner.id, generation: 1,
    }, content: [{ type: 'text', text: command }] }), { surfaceOp: 'append' })
    expect(await adapter.mutate(f.owner.session, { ...input, evidenceSeq: report.seq }, new AbortController().signal)).toMatchObject({ status: 'rejected', source: 'unchanged' })
    expect(f.requests).toEqual([])
  })

  it.each([
    ['The worker said: Remember global preference tone: I prefer short answers.', 'I prefer short answers.'],
    ['Remember preference tone: I prefer short answers.', 'I prefer short answers.'],
    ['Remember global preference tone: I am a developer.', 'I am a developer.'],
    ['Remember global preference tone: I prefer short answers today.', 'I prefer short answers today.'],
    ['Remember global preference tone: I prefer password abc123.', 'I prefer password abc123.'],
    ['Remember global preference tone: I prefer Chinese.', 'I prefer English.'],
    ['Remember global preference tone: I prefer temporary approval.', 'I prefer temporary approval.'],
  ])('rejects non-lasting, secret, inferred or ungrounded human text: %s', async (command, text) => {
    const f = await world()
    const evidenceSeq = await evidence(f.host, f.owner, command)
    const result = await new ManagerPreferences(f.ctx, 2048).mutate(f.owner.session, { operation: 'remember', scope: 'global', key: 'tone', text, evidenceSeq }, new AbortController().signal)
    expect(result).toMatchObject({ status: 'rejected', source: 'unchanged' })
    expect(f.requests).toEqual([])
  })

  it('rejects stale correction hashes without replacing source content', async () => {
    const f = await world()
    const evidenceSeq = await evidence(f.host, f.owner, 'Correct global preference language: I prefer English.')
    const result = await new ManagerPreferences(f.ctx, 2048).mutate(f.owner.session, { operation: 'correct', scope: 'global', key: 'language', text: 'I prefer English.', evidenceSeq, expectedHash: '0'.repeat(64) }, new AbortController().signal)
    expect(result).toMatchObject({ status: 'conflict', source: 'unchanged' })
    expect(f.files.get('viking://user/alice/memories/preferences/language.md')).toBe('I prefer Chinese.')
    expect(f.requests.some(request => request.init.method === 'POST' || request.init.method === 'DELETE')).toBe(false)
  })

  it.each([
    'viking://user/bob/memories/preferences/language.md',
    'viking://user/alice/peers/other/memories/preferences/language.md',
    'viking://user/alice/memories/preferences/../language.md',
    'viking://user/alice/memories/preferences/%2e%2e.md',
    'viking://user/alice/memories/preferences/.overview.md',
    'viking://user/alice/memories/preferences/nested/language.md',
    'viking://user/alice/memories/preferences/language.md?steal=true',
  ])('rejects noncanonical or out-of-scope lookup hit %s without reading it', async (uri) => {
    const f = backend()
    const original = f.runtime.client.fetchJSON.bind(f.runtime.client)
    f.runtime.client.fetchJSON = async (path, init, options) => path === '/api/v1/search/find'
      ? { ok: true, status: 200, result: { memories: [{ uri, context_type: 'memory', level: 2 }], resources: [], skills: [], total: 1 } }
      : original(path, init, options)
    expect(await new ManagerPreferences(f.ctx, 2048).lookup({ query: 'language', projectCwd: '/owned/project' }, new AbortController().signal)).toMatchObject({ status: 'unavailable', source: 'unchanged' })
    expect(f.requests.some(request => request.path.startsWith('/api/v1/content/read'))).toBe(false)
  })

  it('bounds whole multibyte entries including JSON wrappers at exact and tiny byte limits', async () => {
    const f = backend()
    f.files.clear()
    f.files.set('viking://user/alice/memories/preferences/language.md', 'I prefer 简洁。')
    const input = { query: 'language' }
    const full = await new ManagerPreferences(f.ctx, 2048).lookup(input, new AbortController().signal)
    expect(full).toMatchObject({ status: 'ok', truncated: false, preferences: [{ text: 'I prefer 简洁。' }] })
    const exact = Buffer.byteLength(JSON.stringify(full))
    for (const limit of [128, exact - 1, exact]) {
      const result = await new ManagerPreferences(f.ctx, limit).lookup(input, new AbortController().signal)
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(limit)
      expect(result).toMatchObject(limit === exact ? full : { status: 'ok', preferences: [], truncated: true })
    }
    expect(() => new ManagerPreferences(f.ctx, 127)).toThrow('at least 128')
  })

  it.each([
    { semantic_status: 'queued' },
    { vector_status: 'skipped' },
    { queue_status: { Embedding: { processed: 1, requeue_count: 0, error_count: 1, errors: [{ message: 'failed' }] } } },
    { queue_status: { Embedding: { processed: 1, requeue_count: 0, error_count: 0, errors: [], pending: 1 } } },
  ])('reports source writes with incomplete indexing as partial, not rollback or success: %j', async (status) => {
    const f = await world()
    const evidenceSeq = await evidence(f.host, f.owner, 'Remember global preference tone: I prefer short answers.')
    const original = f.runtime.client.fetchJSON.bind(f.runtime.client)
    f.runtime.client.fetchJSON = async (path, init, options) => {
      const reply = await original(path, init, options)
      if (path !== '/api/v1/content/write') return reply
      const response: { ok: true; status: number; result: Record<string, unknown> } = z
        .object({ ok: z.literal(true), status: z.number(), result: z.record(z.string(), z.unknown()) }).parse(reply)
      return { ...response, result: { ...response.result, ...status } }
    }
    const result = await new ManagerPreferences(f.ctx, 2048).mutate(f.owner.session, { operation: 'remember', scope: 'global', key: 'tone', text: 'I prefer short answers.', evidenceSeq }, new AbortController().signal)
    expect(result).toMatchObject({ status: 'partial', source: 'updated' })
    expect(f.files.get('viking://user/alice/memories/preferences/tone.md')).toBe('I prefer short answers.')
  })

  it('reports an unknown outcome when transport fails after the source was written', async () => {
    const f = await world()
    const evidenceSeq = await evidence(f.host, f.owner, 'Remember global preference tone: I prefer short answers.')
    const original = f.runtime.client.fetchJSON.bind(f.runtime.client)
    f.runtime.client.fetchJSON = async (path, init, options) => {
      const reply = await original(path, init, options)
      if (path === '/api/v1/content/write') throw new Error('secret transport diagnostic must not leak')
      return reply
    }
    const result = await new ManagerPreferences(f.ctx, 2048).mutate(f.owner.session, { operation: 'remember', scope: 'global', key: 'tone', text: 'I prefer short answers.', evidenceSeq }, new AbortController().signal)
    expect(result).toMatchObject({ status: 'unknown', source: 'unknown' })
    expect(JSON.stringify(result)).not.toContain('secret transport')
    expect(f.files.get('viking://user/alice/memories/preferences/tone.md')).toBe('I prefer short answers.')
  })

  it('rejects missing runtime methods and malformed normalized success envelopes without leaking backend errors', async () => {
    const f = backend()
    const broken = new Context()
    contexts.push(broken)
    broken.provide('openvikingMemory', { client: { fetchJSON: f.runtime.client.fetchJSON.bind(f.runtime.client) } })
    expect(await new ManagerPreferences(broken, 128).lookup({ query: 'language' }, new AbortController().signal)).toMatchObject({ status: 'unavailable' })
    for (const reply of [
      { status: 'ok', result: { initialized: true, user: 'alice' } },
      { ok: true, status: 500, result: { initialized: true, user: 'alice' } },
      { ok: true, status: 200, result: { initialized: true, user: '../bob' } },
      { ok: false, status: 403, result: null, error: { code: 'PERMISSION_DENIED', message: 'secret credential value' } },
    ]) {
      f.runtime.client.fetchJSON = async () => reply
      const result = await new ManagerPreferences(f.ctx, 128).lookup({ query: 'language' }, new AbortController().signal)
      expect(result).toMatchObject({ status: 'unavailable', source: 'unchanged' })
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(128)
      expect(JSON.stringify(result)).not.toContain('secret credential')
    }
  })

  it('stores Chinese project directives only under the Host-resolved peer and forbids unsafe leaf keys', async () => {
    const f = await world()
    const adapter = new ManagerPreferences(f.ctx, 2048)
    const evidenceSeq = await evidence(f.host, f.owner, '项目记住偏好 tone：我偏好简洁回答。')
    const input = { operation: 'remember' as const, scope: 'project' as const, projectCwd: f.cwd, key: 'tone', text: '我偏好简洁回答。', evidenceSeq }
    for (const key of ['../tone', '%2ftone', 'nested/tone', '.overview', 'viking://~/tone']) {
      expect(await adapter.mutate(f.owner.session, { ...input, key }, new AbortController().signal)).toMatchObject({ status: 'rejected', source: 'unchanged' })
    }
    expect(f.requests).toEqual([])
    expect(await adapter.mutate(f.owner.session, input, new AbortController().signal)).toMatchObject({ status: 'ok', scope: 'project', uri: 'viking://user/alice/peers/repo/memories/preferences/tone.md' })
    expect(f.files.has('viking://user/alice/memories/preferences/tone.md')).toBe(false)
    expect(f.files.get('viking://user/alice/peers/repo/memories/preferences/tone.md')).toBe('我偏好简洁回答。')
    expect(f.requests.every(request => request.actorPeerId === 'repo')).toBe(true)
  })

  it('does not dispatch a cancelled mutation and reports cancellation after dispatch as unknown', async () => {
    const f = await world()
    const evidenceSeq = await evidence(f.host, f.owner, 'Remember global preference tone: I prefer short answers.')
    const adapter = new ManagerPreferences(f.ctx, 2048)
    const input = { operation: 'remember' as const, scope: 'global' as const, key: 'tone', text: 'I prefer short answers.', evidenceSeq }
    const before = new AbortController()
    before.abort()
    expect(await adapter.mutate(f.owner.session, input, before.signal)).toMatchObject({ source: 'unchanged' })
    expect(f.requests).toEqual([])
    const after = new AbortController()
    const original = f.runtime.client.fetchJSON.bind(f.runtime.client)
    f.runtime.client.fetchJSON = async (path, init, options) => {
      const result = await original(path, init, options)
      if (path === '/api/v1/content/write') after.abort()
      return result
    }
    expect(await adapter.mutate(f.owner.session, input, after.signal)).toMatchObject({ status: 'unknown', source: 'unknown' })
    expect(f.files.get('viking://user/alice/memories/preferences/tone.md')).toBe('I prefer short answers.')
  })

  it('requires correction hashes and refuses result budgets too small for a mutation before writing', async () => {
    const f = await world()
    const evidenceSeq = await evidence(f.host, f.owner, 'Correct global preference language: I prefer English.')
    expect(await new ManagerPreferences(f.ctx, 2048).mutate(f.owner.session, { operation: 'correct', scope: 'global', key: 'language', text: 'I prefer English.', evidenceSeq }, new AbortController().signal)).toMatchObject({ status: 'rejected', source: 'unchanged' })
    const remember = await evidence(f.host, f.owner, 'Remember global preference tone: I prefer short answers.')
    const result = await new ManagerPreferences(f.ctx, 180).mutate(f.owner.session, { operation: 'remember', scope: 'global', key: 'tone', text: 'I prefer short answers.', evidenceSeq: remember }, new AbortController().signal)
    expect(result).toMatchObject({ status: 'rejected', source: 'unchanged' })
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(180)
    expect(f.files.has('viking://user/alice/memories/preferences/tone.md')).toBe(false)
    expect(f.requests.some(request => request.init.method === 'POST')).toBe(false)
  })

  it('reports incomplete delete indexing without restoring or claiming successful deletion', async () => {
    const f = await world()
    const evidenceSeq = await evidence(f.host, f.owner, 'Forget global preference language')
    const original = f.runtime.client.fetchJSON.bind(f.runtime.client)
    f.runtime.client.fetchJSON = async (path, init, options) => {
      const reply = await original(path, init, options)
      if (!path.startsWith('/api/v1/fs?')) return reply
      const response: { ok: true; status: number; result: Record<string, unknown> } = z
        .object({ ok: z.literal(true), status: z.number(), result: z.record(z.string(), z.unknown()) }).parse(reply)
      return { ...response, result: { ...response.result, semantic_status: 'deferred' } }
    }
    expect(await new ManagerPreferences(f.ctx, 2048).mutate(f.owner.session, { operation: 'forget', scope: 'global', key: 'language', evidenceSeq }, new AbortController().signal)).toMatchObject({ status: 'partial', source: 'deleted' })
    expect(f.files.has('viking://user/alice/memories/preferences/language.md')).toBe(false)
  })

  it('targets owned project and global roots, reads fresh content and orders project preferences first', async () => {
    const f = backend()
    const adapter = new ManagerPreferences(f.ctx, 2048)
    const result = await adapter.lookup({ query: 'language', projectCwd: '/owned/project' }, new AbortController().signal)
    expect(result).toMatchObject({ status: 'ok', truncated: false, preferences: [
      { scope: 'project', key: 'language', text: 'I prefer English.' },
      { scope: 'global', key: 'language', text: 'I prefer Chinese.' },
    ] })
    const hashes = (result as { preferences: readonly { hash: string }[] }).preferences
    expect(hashes[0]?.hash).toMatch(/^[a-f0-9]{64}$/u)
    expect(f.requests.find(request => request.path === '/api/v1/search/find')).toEqual({
      path: '/api/v1/search/find', actorPeerId: 'repo', init: { method: 'POST', body: JSON.stringify({
        query: 'language', target_uri: ['viking://~/peers/repo/memories/preferences', 'viking://~/memories/preferences'], context_type: 'memory', limit: 8, level: 2,
      }) },
    })
    f.files.set('viking://user/alice/peers/repo/memories/preferences/language.md', 'I prefer German.')
    await expect(adapter.lookup({ query: 'language', projectCwd: '/owned/project' }, new AbortController().signal))
      .resolves.toMatchObject({ status: 'ok', preferences: [{ text: 'I prefer German.' }, { text: 'I prefer Chinese.' }] })
  })
})
