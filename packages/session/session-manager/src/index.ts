/** Opt-in management of independent, ordinary work Sessions. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-commands'
import { freezeMessage, type ContentBlock, type MessageId, type ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { z as jsonSchema } from 'zod'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  answerSchema, deliveryId, managementDomain, mergeAnswers, questionSchema, truncateUtf8,
  type ManagedLink, type ManagementAnswer, type ManagementQuestion, type ManagementQuestionId,
  type ManagementState, type PendingCreation, type PendingDelivery, type PendingQuestion,
} from './state.ts'
import { ManagerPreferences } from './preferences.ts'
import { appendLedger, questionLogPath, renderAnswer, renderQuestion } from './questions.ts'

/** Cordis plugin identity. */
export const name = 'session-manager'
/** Services used by the persistent routing owner. */
export const inject = ['agents', 'sessions', 'tools', 'systemPrompt', 'sessionController', 'sessionQuery', 'workspaceRegistry', 'storageDomain', 'userQuestions', 'commands', 'agentPresets']

/** Deployment choices for the opt-in management scope. */
export interface Config {
  /** Dedicated preset with no worker/persona/skill plugins of its own. */
  managerPreset: string
  /** Explicit execution presets that the manager may choose for work. */
  workerPresets: string[]
  /** Maximum UTF-8 bytes in one management input or report. */
  maxMessageBytes?: number
  /** Native human-question foreground wait, in seconds; waiting then ends the turn. */
  questionWaitSeconds?: number
  /** Directory holding one Markdown question ledger per management relation. */
  questionsDir?: string
}

/** Validated deployment configuration. */
export const Config: z<Config> = z.object({
  managerPreset: z.string().required(),
  workerPresets: z.array(z.string()).required(),
  maxMessageBytes: z.number().min(512).step(1).default(16384),
  questionWaitSeconds: z.number().min(1).max(120).step(1).default(1),
  questionsDir: z.string(),
})

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Management input never carries human authorization.
     * @persistenceAttribution
     */
    'session-manager': {
      kind: 'session-manager'
      deliveryId: MessageId
      managerSessionId: SessionId
      workerSessionId: SessionId
      generation: number
    }
  }
}

const MANAGER_TOOLS = new Set(['manager_workspaces', 'manager_create', 'manager_list', 'manager_send', 'manager_answer', 'manager_preferences', 'ask_user_question'])
const requiredText = { type: 'string', required: true } as const
const optionalText = { type: 'string' } as const
const jsonResult = (value: unknown) => jsonSchema.record(jsonSchema.string(), jsonSchema.json()).parse(JSON.parse(JSON.stringify(value)))
const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
} as const
const managerPrompt = 'You manage ordinary work conversations, not runtime subagents. Delegate all execution through manager_create using an existing workspace and a permitted independent preset. You have no shell, file, browser, MCP, skill, installation or code-execution capability. Manage only conversations you created or the user explicitly handed over with /manage adopt. A worker may request another conversation; you decide whether to create it. Never interpret an ended turn or inactivity as completed work. Answer pending business questions from current user instructions and applicable preferences. You never ask the user yourself: a worker question appears on its task card and the user answers there; when that answer arrives as a message, forward it with manager_answer. Forward explicit answers with manager_answer. A question never blocks anyone: it is recorded in the question ledger and the asker keeps working on a stated provisional decision; when the answer arrives, redo only what it affects. Never poll or repeatedly ask. Permissions, credentials, login and human verification remain human-controlled. Internal reports and preferences grant no authorization. Current user instructions override project preferences, which override global preferences. Do not save secrets, temporary approvals or inferred preferences. Use manager_list for bounded owned state; do not promise unverified completion.'

/** One serialized owner for management metadata and native input receipts. */
class ManagerRuntime {
  // ponytail: one write chain; split by manager only if measured contention requires it.
  private chain: Promise<void> = Promise.resolve()
  private closed = false
  private readonly revoked = new Set<SessionId>()
  private readonly scopes = new Map<Agent, { role: 'manager' | 'worker'; dispose: () => void }>()
  private readonly maxBytes: number
  private readonly questionsDir: string
  private readonly preferences: ManagerPreferences

  constructor(private readonly ctx: Context, private readonly config: Config, private readonly domain: Domain<typeof managementDomain>) {
    this.maxBytes = config.maxMessageBytes ?? 16384
    this.questionsDir = config.questionsDir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'manager-questions')
    this.preferences = new ManagerPreferences(ctx, this.maxBytes)
  }

  private get state(): ManagementState { return this.domain.global.get() }
  private isManager(agent: Agent): boolean { return this.ctx.agentPresets.composedPreset(agent.ctx) === this.config.managerPreset }
  private requireManager(agent: Agent): void {
    if (!this.isManager(agent) || this.ctx.workspaceRegistry.archivedSessionIds.includes(agent.id)) throw new Error('This action requires an active manager conversation')
  }
  private link(workerId: SessionId, managerId?: SessionId): ManagedLink {
    const link = this.state.links[workerId]
    if (link === undefined || link.detached || (managerId !== undefined && link.managerId !== managerId)) throw new Error('Conversation is not managed by this manager')
    return link
  }
  private enabled(link: ManagedLink): boolean {
    const owner = this.ctx.agents.get(link.managerId)
    return !link.detached && !link.paused && !this.revoked.has(link.workerId) && !this.revoked.has(link.managerId)
      && (owner === undefined || this.isManager(owner)) && !this.state.pausedManagers.includes(link.managerId)
      && !this.ctx.workspaceRegistry.archivedSessionIds.some(id => id === link.workerId || id === link.managerId)
      && this.ctx.workspaceRegistry.get(link.workspaceId)?.sessionIds.includes(link.workerId) === true
  }
  private checkSize(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value)) > this.maxBytes) throw new Error(`Management input exceeds ${this.maxBytes} UTF-8 bytes; shorten it`)
  }
  private async write(change: (next: ManagementState) => void): Promise<void> {
    const next = structuredClone(this.state)
    change(next)
    await this.domain.global.set(next)
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => {
      if (this.closed) throw new Error('Manager extension is stopping')
      return operation()
    })
    this.chain = result.then(() => {}, (error: unknown) => {
      this.ctx.logger.warn(`session-manager: ${error instanceof Error ? error.message : 'operation failed'}`)
    })
    return result
  }
  private background(operation: () => Promise<void>): void {
    // run owns the visible Host diagnostic; durable pending records remain.
    void this.run(operation).catch(() => { /* recorded by run */ })
  }

  async start(): Promise<void> {
    if (this.config.workerPresets.length === 0 || this.config.workerPresets.includes(this.config.managerPreset)) throw new Error('Configure independent worker presets, excluding the manager preset')
    this.ctx.on('agent/created', ({ agent }) => { this.install(agent) })
    this.ctx.on('agent-preset/selected', (id) => { const agent = this.ctx.agents.get(id); if (agent !== undefined) this.install(agent) })
    this.ctx.on('agent/disposed', ({ agent }) => { this.scopes.get(agent)?.dispose(); this.scopes.delete(agent) })
    this.ctx.on('session-controller/cancel-requested', async (id) => {
      const link = this.state.links[id]
      const owned = link !== undefined && !link.detached
      const manager = this.ctx.agents.get(id)
      if (!owned && (manager === undefined || !this.isManager(manager))) return
      this.revoked.add(id)
      await this.run(() => this.write((state) => {
        const current = state.links[id]
        if (current !== undefined && !current.detached) {
          if (!current.paused) current.generation++
          current.paused = true
        }
        if (manager !== undefined && this.isManager(manager) && !state.pausedManagers.includes(id)) state.pausedManagers.push(id)
      }))
    })
    this.ctx.on('session/event', (session, event) => {
      if (event.type === 'user/message' && event.data.source.kind === 'user-question-reply') {
        const message = event.data
        this.background(() => this.humanReply(session, message))
      }
      if (event.type !== 'turn/end' || this.state.links[session.id] === undefined) return
      if (event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'user') this.revoked.add(session.id)
      this.background(() => this.scan(session.id))
    })
    this.ctx.commands.register({
      name: 'manage', description: 'Explicitly adopt, detach, pause or resume a work conversation: /manage adopt|detach|pause|resume [session-id]',
      input: { hint: 'adopt|detach|pause|resume [session-id]' },
      handler: async ({ agent, rawInput }) => {
        try {
          const [action, target, extra] = rawInput.trim().split(/\s+/u)
          if (extra !== undefined || !['adopt', 'detach', 'pause', 'resume'].includes(action ?? '')) throw new Error('Use /manage adopt|detach|pause|resume [session-id]')
          await this.control(agent, action ?? '', target === undefined ? agent.id : brandString<SessionId>(target))
          return { kind: 'success', text: `Management ${action} recorded.` }
        } catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : 'Management command failed' } }
      },
    })
    for (const agent of this.ctx.agents.list()) this.install(agent)
    await this.recover()
  }

  private install(agent: Agent): void {
    const role = this.isManager(agent) ? 'manager' : this.state.links[agent.id]?.detached === false ? 'worker' : undefined
    const current = this.scopes.get(agent)
    if (current?.role === role) return
    current?.dispose()
    this.scopes.delete(agent)
    if (role === undefined) return
    if (agent.session.header.origin === 'subagent' || (role === 'manager' && agent.session.header.isSeeded)) throw new Error('Management requires an ordinary, non-forked root conversation')
    const disposers: (() => void)[] = []
    const add = (definition: ToolDefinition): void => { disposers.push(agent.ctx.tools.register(definition)) }
    if (role === 'manager') {
      disposers.push(agent.ctx.tools.setExecutor(new NativeToolExecutor(agent.ctx)), agent.ctx.tools.restrict({ allow: [] }))
      disposers.push(agent.ctx.tools.guard(exec => MANAGER_TOOLS.has(exec.name) ? undefined : 'Manager execution capability denied'))
      disposers.push(agent.ctx.systemPrompt.suppressRuntimeContext())
      disposers.push(agent.ctx.systemPrompt.section({ name: 'manager:system', order: 0, complete: true, interpolate: false, text: managerPrompt }))
      this.managerTools(agent, add)
    } else this.workerTools(agent, add)
    disposers.push(agent.ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      if (role === 'manager') {
        if (this.revoked.has(agent.id) || this.state.pausedManagers.includes(agent.id)) { this.park(agent, decision.messages); return { kind: 'reject' } }
        return { ...decision, messages: decision.messages.filter((message) => {
          if (message.source.kind === 'user' || message.source.kind === 'user-question-reply') return true
          if (message.source.kind !== 'session-manager') return false
          const source = message.source
          const link = this.state.links[source.workerSessionId]
          return link !== undefined && link.managerId === agent.id && link.generation === source.generation && !link.detached
        }) }
      }
      const link = this.state.links[agent.id]
      if (link === undefined || !this.enabled(link)) { this.park(agent, decision.messages); return { kind: 'reject' } }
      return { ...decision, messages: decision.messages.filter(message => message.source.kind !== 'session-manager'
        || (message.source.workerSessionId === agent.id && message.source.generation === link.generation)) }
    }, { prepend: true }))
    const dispose = (): void => { for (const undo of disposers.splice(0).reverse()) undo() }
    this.scopes.set(agent, { role, dispose })
  }

  private park(agent: Agent, messages: readonly UserMessage[]): void {
    for (const message of messages) {
      if (message.source.kind === 'user' || message.source.kind === 'user-question-reply') agent.send(message, 'next-step', false)
      else if (message.source.kind === 'session-manager') {
        const link = this.state.links[message.source.workerSessionId]
        if (link !== undefined && !link.detached && link.generation === message.source.generation) agent.send(message, 'next-step', false)
      }
    }
  }

  private workspaceCwd(workerId: SessionId, managerId: SessionId): string {
    const link = this.link(workerId, managerId)
    const workspace = this.ctx.workspaceRegistry.get(link.workspaceId)
    if (workspace === undefined) throw new Error('The work conversation’s workspace no longer exists')
    return workspace.path
  }

  private managerTools(agent: Agent, add: (definition: ToolDefinition) => void): void {
    add(defineTool({
      name: 'manager_workspaces',
      description: 'List existing workspaces and the independent execution presets available for new work conversations.',
      parameters: {},
      output,
      execute: () => {
        this.requireManager(agent)
        return Promise.resolve(jsonResult({
          workspaces: this.ctx.workspaceRegistry.list().map(workspace => ({
            id: workspace.id, title: workspace.title, path: workspace.path,
          })),
          workerPresets: this.config.workerPresets,
        }))
      },
    }))
    add(defineTool({
      name: 'manager_create',
      description: 'Create an ordinary work conversation in an existing workspace with an independent execution preset. '
        + 'Reuse the same idempotencyKey only for the identical task. Set requestId when approving a worker creation request.',
      parameters: {
        workspaceId: requiredText, agentPreset: requiredText, message: requiredText,
        idempotencyKey: requiredText, requestId: optionalText,
      },
      output,
      execute: args => this.create(agent, {
        workspaceId: brandString<WorkspaceId>(args.workspaceId),
        agentPreset: args.agentPreset,
        message: args.message,
        idempotencyKey: args.idempotencyKey,
        ...(args.requestId === undefined ? {} : { requestId: brandString<ManagementQuestionId>(args.requestId) }),
      }),
    }))
    add(defineTool({
      name: 'manager_list',
      description: 'Read only your explicitly managed conversations, pending questions and failed deliveries. '
        + 'An ended turn is not task completion.',
      parameters: { workerSessionId: optionalText },
      output,
      execute: (args) => {
        this.requireManager(agent)
        if (args.workerSessionId !== undefined) this.link(brandString<SessionId>(args.workerSessionId), agent.id)
        return Promise.resolve(jsonResult({
          conversations: Object.values(this.state.links)
            .filter(link => link.managerId === agent.id && !link.detached
              && (args.workerSessionId === undefined || link.workerId === args.workerSessionId)),
          questions: Object.values(this.state.questions)
            .filter(question => question.managerId === agent.id && question.status === 'pending'
              && (args.workerSessionId === undefined || question.workerId === args.workerSessionId)),
          deliveryErrors: Object.values(this.state.deliveries)
            .filter(delivery => delivery.error !== undefined && this.state.links[delivery.workerId]?.managerId === agent.id)
            .map(delivery => ({ id: delivery.id, targetId: delivery.targetId, error: delivery.error })),
        }))
      },
    }))
    add(defineTool({
      name: 'manager_send',
      description: 'Send instructions to your active managed work conversation. Answer a pending question with manager_answer instead. '
        + 'Optionally forward native attachments from a real user message in this manager conversation.',
      parameters: {
        workerSessionId: requiredText, message: requiredText, idempotencyKey: requiredText,
        attachmentMessageSeq: { type: 'integer' },
      },
      output,
      execute: args => this.run(async () => {
        this.requireManager(agent)
        const link = this.link(brandString<SessionId>(args.workerSessionId), agent.id)
        if (!this.enabled(link)) throw new Error('Conversation is paused, archived or detached; the user must resume it')
        const id = deliveryId(agent.id, 'send', args.idempotencyKey)
        await this.enqueue(link, link.workerId, id, args.message, agent.id, args.attachmentMessageSeq)
        await this.drain()
        return { delivered: this.state.deliveries[id]?.delivered === true, workerSessionId: link.workerId }
      }),
    }))
    add(defineTool({
      name: 'manager_answer',
      description: 'Answer original question IDs for one of your workers. Partial answers remain pending; duplicate identical answers are safe. '
        + 'For creation requests use manager_create to approve, or answer Reject with a reason.',
      parameters: {
        questionId: requiredText,
        answers: { type: 'array', required: true, items: { type: 'json' } },
        attachmentMessageSeq: { type: 'integer' },
      },
      output,
      execute: args => this.run(() => this.answer(
        agent,
        brandString<ManagementQuestionId>(args.questionId),
        args.answers.map(answer => answerSchema.parse(answer)),
        args.attachmentMessageSeq,
      )),
    }))
    add(defineTool({
      name: 'manager_preferences',
      description: 'Look up explicit long-term user preferences, or apply a user-authorized remember/correct/forget operation '
        + 'on the latest direct-human instruction. Project scope uses an owned worker workspace. '
        + 'Never store secrets, one-time approvals or inferred preferences.',
      parameters: {
        operation: { type: 'string', enum: ['lookup', 'remember', 'correct', 'forget'], required: true },
        query: optionalText,
        scope: { type: 'string', enum: ['global', 'project'] },
        workerSessionId: optionalText,
        key: optionalText,
        text: optionalText,
        evidenceSeq: { type: 'integer' },
        expectedHash: optionalText,
      },
      output,
      execute: async (args, exec) => {
        this.requireManager(agent)
        const projectCwd = args.workerSessionId === undefined
          ? undefined
          : this.workspaceCwd(brandString<SessionId>(args.workerSessionId), agent.id)
        const project = projectCwd === undefined ? {} : { projectCwd }
        if (args.operation === 'lookup') {
          return jsonResult(await this.preferences.lookup({ query: args.query ?? '', ...project }, exec.signal))
        }
        if (args.scope === undefined || args.key === undefined || args.evidenceSeq === undefined) {
          throw new Error('A preference mutation needs scope, key and the evidenceSeq of the latest direct-human directive')
        }
        if (args.scope === 'project' && projectCwd === undefined) {
          throw new Error('Project preferences need an owned worker conversation')
        }
        const expected = args.expectedHash === undefined ? {} : { expectedHash: args.expectedHash }
        if (args.operation === 'forget') {
          if (args.text !== undefined) throw new Error('Forget accepts no replacement text')
          return jsonResult(await this.preferences.mutate(agent.session, {
            operation: 'forget', scope: args.scope, key: args.key, evidenceSeq: args.evidenceSeq, ...project, ...expected,
          }, exec.signal))
        }
        if (args.text === undefined) throw new Error('Remember and correct need the exact lasting preference text')
        return jsonResult(await this.preferences.mutate(agent.session, {
          operation: args.operation, scope: args.scope, key: args.key, text: args.text,
          evidenceSeq: args.evidenceSeq, ...project, ...expected,
        }, exec.signal))
      },
    }))
    // 管理端不直接向用户提问：提问只出现在任务面板对应任务上，用户在那里作答，
    // 管理端收到答复后用 manager_answer 转给工作对话（ADR-0013）。
    add(defineTool({
      name: 'ask_user_question',
      description: 'Unavailable here by design: questions are answered on the task card, not in this conversation. '
        + 'A worker question is already shown on its task card; keep working and its answer arrives as a normal message. '
        + 'To obtain information you lack, tell the worker to raise the question.',
      parameters: { questions: { type: 'array', items: { type: 'json' } }, questionId: optionalText },
      output,
      execute: async (args) => {
        this.requireManager(agent)
        return {
          recorded: false,
          where: 'task-panel',
          message: args.questionId === undefined
            ? 'Questions belong to a task: have the worker raise it, then the user answers on that task card.'
            : 'That question is already on its task card; the user answers there and the answer arrives as a message here.',
        }
      },
    }))
  }

  private workerTools(agent: Agent, add: (definition: ToolDefinition) => void): void {
    add(defineTool({
      name: 'ask_user_question',
      description: 'Record a business question for this conversation’s manager. It never blocks: keep working on a provisional decision '
        + 'and say which assumption you took. The answer arrives later as an ordinary message; redo only the parts it affects. '
        + 'Permissions, login and human verification still require the human.',
      parameters: { questions: { type: 'array', required: true, items: { type: 'json' } } },
      output,
      execute: async (args, exec) => {
        const result = await this.request(agent, exec.callId, args.questions.map(question => questionSchema.parse(question)))
        return { ...result, message: 'Question recorded. Do not wait: continue now with a provisional decision and state that assumption.' }
      },
    }))
    add(defineTool({
      name: 'manager_request_session',
      description: 'Request another work conversation. Your manager decides whether to create it in the requested workspace and preset; '
        + 'this tool cannot create conversations.',
      parameters: {
        workspaceId: requiredText, agentPreset: requiredText, message: requiredText, reason: requiredText,
      },
      output,
      execute: async (args, exec) => {
        const result = await this.request(agent, exec.callId, [
          { id: 'creation', question: args.reason, options: [{ label: 'Reject' }] },
        ], { ...args, workspaceId: brandString<WorkspaceId>(args.workspaceId) })
        exec.concludeTurn()
        return result
      },
    }))
    add(defineTool({
      name: 'manager_report',
      description: 'Report progress, an explicit completed result, or a blocker to your manager. Use completed only when the actual '
        + 'assigned work is finished; an ordinary ended turn is not completion.',
      parameters: {
        status: { type: 'string', enum: ['progress', 'completed', 'blocked'], required: true },
        summary: requiredText,
      },
      output,
      execute: (args, exec) => this.run(async () => {
        const link = this.link(agent.id)
        this.checkSize(args)
        await this.enqueue(link, link.managerId, deliveryId(agent.id, 'report', exec.callId), JSON.stringify({
          type: 'explicit-report', workerSessionId: agent.id, ...args,
        }))
        await this.drain()
        return { recorded: true, status: args.status }
      }),
    }))
  }

  private async create(agent: Agent, request: {
    workspaceId: WorkspaceId
    agentPreset: string
    message: string
    idempotencyKey: string
    requestId?: ManagementQuestionId
  }): Promise<{ workerSessionId: SessionId }> {
    return this.run(async () => {
      this.requireManager(agent)
      this.checkSize(request)
      if (!request.idempotencyKey.trim() || !request.message.trim()) throw new Error('Supply a task and stable nonempty idempotencyKey')
      if (!this.config.workerPresets.includes(request.agentPreset)) throw new Error('Choose a permitted independent worker preset')
      const preset = await this.ctx.agentPresets.resolve(request.agentPreset)
      if (preset.broken !== undefined) throw new Error(`Worker preset is unavailable: ${preset.broken}`)
      if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) throw new Error('Choose an existing workspace')
      const key = deliveryId(agent.id, 'create', request.idempotencyKey)
      const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
      let creation = this.state.creations[key]
      if (creation !== undefined && creation.digest !== digest) throw new Error('This idempotencyKey already belongs to different creation input')
      if (creation === undefined) {
        if (request.requestId !== undefined) {
          const question = this.state.questions[request.requestId]
          if (question === undefined || question.managerId !== agent.id || question.creation === undefined || question.status !== 'pending') throw new Error('Unknown pending creation request')
          const requesting = this.link(question.workerId, agent.id)
          if (!this.enabled(requesting) || requesting.generation !== question.generation) throw new Error('Creation request was revoked or paused')
        }
        creation = { managerId: agent.id, workerId: brandString<SessionId>(`session-${randomUUID()}`), workspaceId: request.workspaceId, agentPreset: request.agentPreset, digest, message: request.message, ready: false, ...(request.requestId === undefined ? {} : { requestId: request.requestId }) }
        const reserved = creation
        await this.write((state) => { state.creations[key] = reserved })
      }
      await this.finishCreation(key, creation)
      await this.drain()
      return { workerSessionId: creation.workerId }
    })
  }

  private async finishCreation(key: string, creation: PendingCreation): Promise<void> {
    if (creation.ready) return
    if (this.state.pausedManagers.includes(creation.managerId) || this.ctx.workspaceRegistry.archivedSessionIds.includes(creation.managerId)) throw new Error('Manager is paused or archived')
    const workspace = this.ctx.workspaceRegistry.get(creation.workspaceId)
    if (workspace === undefined) throw new Error('Creation workspace no longer exists')
    await this.ctx.sessionController.create({
      workspaceId: creation.workspaceId, sessionId: creation.workerId, agentPreset: creation.agentPreset,
    })
    await workspace.attachSession(creation.workerId)
    const link: ManagedLink = {
      workerId: creation.workerId, managerId: creation.managerId, workspaceId: creation.workspaceId,
      agentPreset: creation.agentPreset, generation: 0, paused: false, detached: false, seenSeq: -1,
    }
    const existing = this.state.links[link.workerId]
    if (existing?.detached || existing?.paused) throw new Error('Creation was revoked by the user')
    const initial = this.pending(existing ?? link, link.workerId, deliveryId(link.workerId, 'initial-task'), creation.message ?? '')
    const question = creation.requestId === undefined ? undefined : this.state.questions[creation.requestId]
    const requesting = question === undefined ? undefined : this.link(question.workerId, creation.managerId)
    const approval = question === undefined || requesting === undefined ? undefined
      : this.pending(requesting, requesting.workerId, deliveryId(question.id, 'created'), JSON.stringify({ type: 'creation-approved', questionId: question.id, workerSessionId: creation.workerId }))
    await this.write((state) => {
      state.links[link.workerId] = existing ?? link
      state.creations[key] = { ...creation, ready: true }
      delete state.creations[key].message
      state.deliveries[initial.id] ??= initial
      if (question !== undefined && approval !== undefined) {
        const stored = state.questions[question.id]
        if (stored !== undefined) stored.status = 'answered'
        state.deliveries[approval.id] ??= approval
      }
    })
    const worker = this.ctx.agents.get(link.workerId)
    if (worker !== undefined) this.install(worker)
  }

  private async request(agent: Agent, callId: ToolCallId, questions: ManagementQuestion[], creation?: PendingQuestion['creation']): Promise<{ pending: true; questionId: ManagementQuestionId }> {
    return this.run(async () => {
      const link = this.link(agent.id)
      if (!this.enabled(link)) throw new Error('Management was paused, archived or detached')
      this.checkSize({ questions, creation })
      if (questions.length === 0 || new Set(questions.map(question => question.id)).size !== questions.length) throw new Error('Use nonempty, unique question IDs')
      const id = brandString<ManagementQuestionId>(deliveryId(agent.id, callId))
      const question: PendingQuestion = { id, workerId: agent.id, managerId: link.managerId, generation: link.generation, callId, questions, answers: [], status: 'pending', ...(creation === undefined ? {} : { creation }) }
      const old = this.state.questions[id]
      if (old !== undefined && (JSON.stringify(old.questions) !== JSON.stringify(questions) || JSON.stringify(old.creation) !== JSON.stringify(creation))) throw new Error('Question call identity already belongs to different input')
      this.background(() => appendLedger(questionLogPath(this.questionsDir, link.managerId), renderQuestion({
        questionId: id, workerId: agent.id, at: Date.now(), items: questions,
      })))
      const delivery = this.pending(link, link.managerId, deliveryId(id, 'question'), JSON.stringify({ type: creation === undefined ? 'worker-question' : 'creation-request', ...question }))
      await this.write((state) => {
        state.questions[id] ??= question
        state.deliveries[delivery.id] ??= delivery
      })
      await this.drain()
      return { pending: true, questionId: id }
    })
  }

  /** Read one Session's durable header and events without opening or resuming it. */
  private async inspect(sessionId: SessionId): Promise<{ readonly meta: SessionHeader; readonly events: readonly SessionEvent[] }> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    return { meta: observation.header, events: [...observation.events] }
  }

  private async humanReply(session: Session, message: UserMessage): Promise<void> {
    if (message.source.kind !== 'user-question-reply') return
    const agent = this.ctx.agents.get(session.id)
    if (agent === undefined || !this.isManager(agent)) return
    if (!(await this.ctx.sessions.flush(session))) throw new Error('Human answers require durable Session persistence')
    const snapshot = await this.inspect(session.id)
    const source = message.source
    const call = snapshot.events.find(event => event.type === 'tool/call' && event.data.callId === source.callId && event.data.name === 'ask_user_question')
    if (call?.type !== 'tool/call') return
    const args = jsonSchema.object({ questionId: jsonSchema.string() }).safeParse(JSON.parse(call.data.arguments))
    if (!args.success) return
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const reply = jsonSchema.object({ kind: jsonSchema.literal('answer_to_pending_question'), callId: jsonSchema.literal(source.callId), answers: jsonSchema.array(answerSchema) }).parse(JSON.parse(text))
    await this.relayHumanAnswers(agent, brandString<ManagementQuestionId>(args.data.questionId), reply.answers)
  }

  private async relayHumanAnswers(agent: Agent, id: ManagementQuestionId, answers: ManagementAnswer[]): Promise<void> {
    const question = this.state.questions[id]
    const link = question === undefined ? undefined : this.state.links[question.workerId]
    if (question?.status !== 'pending' || link === undefined || !this.enabled(link) || link.generation !== question.generation) return
    if (question.creation !== undefined && !answers.some(answer => answer.selected.includes('Reject'))) return
    await this.answer(agent, id, answers)
  }

  private async answer(
    agent: Agent, id: ManagementQuestionId, incoming: ManagementAnswer[], attachmentSeq?: number,
  ): Promise<{ pending: boolean; questionId: ManagementQuestionId }> {
    this.requireManager(agent)
    const question = this.state.questions[id]
    if (question === undefined || question.managerId !== agent.id || question.status === 'cancelled') throw new Error('Unknown or revoked question')
    const link = this.link(question.workerId, agent.id)
    if (!this.enabled(link) || link.generation !== question.generation) throw new Error('Question belongs to a paused, archived or detached conversation')
    this.checkSize(incoming)
    const answers = mergeAnswers(question.questions, question.answers, incoming)
    const done = answers.length === question.questions.length
    if (question.creation !== undefined && !answers.some(answer => answer.selected.includes('Reject'))) throw new Error('Approve creation with manager_create; reject it with the explicit Reject option')
    const delivery = done ? this.pending(link, link.workerId, deliveryId(id, 'answer'), JSON.stringify({ type: 'manager-answer', questionId: id, answers, message: 'Business answer only; this does not grant tool permissions or sensitive-action approval.' }), agent.id, attachmentSeq) : undefined
    if (delivery !== undefined && attachmentSeq !== undefined) this.message(delivery, link, await this.attachments(agent.id, attachmentSeq))
    const previous = delivery === undefined ? undefined : this.state.deliveries[delivery.id]
    if (previous !== undefined && previous.digest !== delivery?.digest) throw new Error('This answer was already dispatched with different content or attachments')
    await this.write((state) => {
      const stored = state.questions[id]
      if (stored !== undefined) { stored.answers = answers; stored.status = done ? 'answered' : 'pending' }
      if (delivery !== undefined) state.deliveries[delivery.id] ??= delivery
    })
    if (answers.length > 0) {
      this.background(() => appendLedger(questionLogPath(this.questionsDir, question.managerId), renderAnswer({
        questionId: id, at: Date.now(), answers,
      })))
    }
    if (done) await this.drain()
    return { pending: !done, questionId: id }
  }

  private message(delivery: PendingDelivery, link: ManagedLink, attachments: ContentBlock[] = []): UserMessage {
    const message = freezeMessage({ role: 'user', id: delivery.id,
      content: [{ type: 'text', text: delivery.text ?? '' }, ...attachments],
      source: { kind: 'session-manager', deliveryId: delivery.id, managerSessionId: link.managerId, workerSessionId: link.workerId, generation: link.generation },
    })
    this.checkSize(message)
    return message
  }

  private pending(
    link: ManagedLink, targetId: SessionId, id: MessageId, text: string,
    attachmentSessionId?: SessionId, attachmentSeq?: number,
  ): PendingDelivery {
    const delivery: PendingDelivery = { id, targetId, workerId: link.workerId, generation: link.generation,
      text, digest: deliveryId(text, attachmentSessionId ?? '', String(attachmentSeq ?? '')), delivered: false,
      ...(attachmentSeq === undefined ? {} : { attachmentSessionId: attachmentSessionId ?? link.managerId, attachmentSeq }),
    }
    this.message(delivery, link)
    return delivery
  }

  private async enqueue(
    link: ManagedLink, targetId: SessionId, id: MessageId, text: string,
    attachmentSessionId?: SessionId, attachmentSeq?: number,
  ): Promise<void> {
    const delivery = this.pending(link, targetId, id, text, attachmentSessionId, attachmentSeq)
    const old = this.state.deliveries[id]
    if (old !== undefined) {
      if (old.digest !== delivery.digest) throw new Error('Delivery identity already belongs to different content')
      return
    }
    if (attachmentSeq !== undefined) {
      this.message(delivery, link, await this.attachments(attachmentSessionId ?? link.managerId, attachmentSeq))
    }
    await this.write((state) => { state.deliveries[id] = delivery })
  }

  private async attachments(sessionId: SessionId, seq: number): Promise<ContentBlock[]> {
    const snapshot = await this.inspect(sessionId)
    const event = snapshot.events[seq]
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') throw new Error('Attachments must come from an actual user message in this manager conversation')
    return event.data.content.filter(block => block.type === 'image' || block.type === 'file')
  }

  private async drain(): Promise<void> {
    for (const delivery of Object.values(this.state.deliveries)) {
      if (delivery.delivered) continue
      const link = this.state.links[delivery.workerId]
      if (link === undefined || !this.enabled(link) || link.generation !== delivery.generation) continue
      try {
        const resolved = await this.ctx.sessionController.resolveAgent(delivery.targetId)
        if ('error' in resolved) throw resolved.error
        const current = this.state.links[delivery.workerId]
        if (current === undefined || !this.enabled(current) || current.generation !== delivery.generation) continue
        const agent = resolved.agent
        if (delivery.targetId === current.managerId && !this.isManager(agent)) throw new Error('Owner no longer uses the manager preset')
        if (!(await this.ctx.sessions.flush(agent.session))) throw new Error('Durable Session persistence is required before delivery')
        const snapshot = await this.inspect(agent.id)
        const known = snapshot.events.some(event => (event.type === 'user/message' && event.data.id === delivery.id)
          || (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === delivery.id)))
        if (!known) {
          const attachments = delivery.attachmentSeq !== undefined && delivery.attachmentSessionId !== undefined
            ? await this.attachments(delivery.attachmentSessionId, delivery.attachmentSeq) : []
          if (!this.enabled(this.link(delivery.workerId))
                || this.state.links[delivery.workerId]?.generation !== delivery.generation) continue
          agent.followup(this.message(delivery, current, attachments))
        }
        if (!(await this.ctx.sessions.flush(agent.session))) throw new Error('No durable inbox checkpoint acknowledged delivery')
        await this.write((state) => {
          const stored = state.deliveries[delivery.id]
          if (stored !== undefined) { stored.delivered = true; delete stored.text; delete stored.error }
        })
      } catch (error) {
        await this.write((state) => { const stored = state.deliveries[delivery.id]; if (stored !== undefined) stored.error = 'Delivery is pending: inspect the target conversation and retry recovery after resolving its availability or persistence error.' })
        this.ctx.logger.warn(`session-manager: delivery ${delivery.id} remains pending (${error instanceof Error ? error.name : 'failure'})`)
      }
    }
  }

  private async scan(sessionId: SessionId): Promise<void> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined && !(await this.ctx.sessions.flush(live))) throw new Error('Reports require durable Session persistence')
    const snapshot = await this.inspect(sessionId)
    for (const event of snapshot.events) {
      const link = this.state.links[sessionId]
      if (link === undefined || link.detached || event.seq <= link.seenSeq || event.type !== 'turn/end') continue
      const id = deliveryId(sessionId, 'turn-ended', String(event.seq))
      const last = snapshot.events.findLast(item => item.type === 'assistant/message' && item.data.turn === event.data.turn)
      const text = last?.type === 'assistant/message' ? last.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : ''
      const waiting = Object.values(this.state.questions).some(question => question.workerId === sessionId && question.status === 'pending')
      const cancelled = event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'user'
      const reporting = { ...link, generation: link.generation + (cancelled && !link.paused ? 1 : 0) }
      const report = { type: 'turn-ended', workerSessionId: sessionId, turn: event.data.turn, outcome: waiting ? 'waiting' : event.data.reason.kind, taskCompleted: false, summary: '', truncated: false }
      const base = this.pending(reporting, link.managerId, id, JSON.stringify(report))
      const budget = this.maxBytes - Buffer.byteLength(JSON.stringify(this.message(base, reporting)))
      report.summary = truncateUtf8(text, Math.max(0, Math.floor(budget / 8)))
      report.truncated = report.summary !== text
      const delivery = this.pending(reporting, link.managerId, id, JSON.stringify(report))
      await this.write((state) => {
        const current = state.links[sessionId]
        if (current === undefined) return
        current.seenSeq = event.seq
        if (cancelled && !current.paused) { current.paused = true; current.generation++ }
        state.deliveries[id] ??= delivery
      })
    }
    await this.drain()
  }

  private async control(agent: Agent, action: string, targetId: SessionId): Promise<void> {
    this.requireManager(agent)
    if (targetId !== agent.id && action !== 'adopt') this.link(targetId, agent.id)
    if (action === 'pause' || action === 'detach') this.revoked.add(targetId)
    await this.run(async () => {
      if (targetId === agent.id) {
        if (action !== 'pause' && action !== 'resume') throw new Error('Name a work conversation for adopt or detach')
        await this.write((state) => { state.pausedManagers = action === 'pause' ? [...new Set([...state.pausedManagers, agent.id])] : state.pausedManagers.filter(id => id !== agent.id) })
      } else if (action === 'adopt') {
        const old = this.state.links[targetId]
        if (old !== undefined && !old.detached && old.managerId !== agent.id) throw new Error('Conversation already belongs to another manager')
        const snapshot = await this.inspect(targetId)
        const resolved = await this.ctx.sessionController.resolveAgent(targetId)
        if ('error' in resolved) throw resolved.error
        if (snapshot.meta.origin === 'subagent' || this.isManager(resolved.agent) || this.ctx.workspaceRegistry.archivedSessionIds.includes(targetId)) throw new Error('Adopt an unarchived ordinary work conversation, not a manager or subagent')
        const workspace = this.ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(targetId))
        if (workspace === undefined) throw new Error('Assign this conversation to an existing workspace before adopting it')
        await this.write((state) => { state.links[targetId] = { workerId: targetId, managerId: agent.id, workspaceId: workspace.id, agentPreset: snapshot.meta.agentPreset ?? '', generation: (old?.generation ?? -1) + 1, paused: false, detached: false, seenSeq: snapshot.events.length - 1 } })
      } else {
        this.link(targetId, agent.id)
        await this.write((state) => {
          const link = state.links[targetId]
          if (link === undefined) return
          link.generation++
          link.paused = action === 'pause'
          link.detached = action === 'detach'
          for (const question of Object.values(state.questions)) if (question.workerId === targetId && question.status === 'pending') question.status = 'cancelled'
        })
      }
      if (action === 'resume' || action === 'adopt') this.revoked.delete(targetId)
      const target = this.ctx.agents.get(targetId)
      if (target !== undefined) {
        if (action === 'pause') target.cancel({ kind: 'user' })
        this.install(target)
        if (action === 'resume' && target.id === agent.id) {
          for (const message of [...target.inbox.nextTurn, ...target.inbox.nextStep]) await this.humanReply(target.session, message)
        }
      }
      await this.drain()
    })
  }

  private async recover(): Promise<void> {
    await this.run(async () => {
      for (const [key, creation] of Object.entries(this.state.creations)) if (!creation.ready) await this.finishCreation(key, creation)
      for (const link of Object.values(this.state.links)) {
        if (!link.detached) await this.scan(link.workerId)
      }
      const managers = new Set(Object.values(this.state.questions).filter(question => question.status === 'pending').map(question => question.managerId))
      for (const id of managers) {
        if (this.state.pausedManagers.includes(id) || this.ctx.workspaceRegistry.archivedSessionIds.includes(id)) continue
        const resolved = await this.ctx.sessionController.resolveAgent(id)
        if ('error' in resolved) throw resolved.error
        if (!this.isManager(resolved.agent)) continue
        const snapshot = await this.inspect(id)
        for (const event of snapshot.events) {
          if (event.type === 'user/message') await this.humanReply(resolved.agent.session, event.data)
        }
        for (const message of [...resolved.agent.inbox.nextTurn, ...resolved.agent.inbox.nextStep]) {
          await this.humanReply(resolved.agent.session, message)
        }
        await this.drain()
      }
    })
  }

  async close(): Promise<void> {
    this.closed = true
    await this.chain
    for (const entry of this.scopes.values()) entry.dispose()
    this.scopes.clear()
    await this.domain.close()
  }
}

/** Mount durable management routing without changing the core loop.
 * @param ctx - Persistent Host plugin scope.
 * @param config - Validated manager and worker preset choices.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(managementDomain)
  const runtime = new ManagerRuntime(ctx, config, domain)
  ctx.effect(() => () => runtime.close(), 'session-manager.close')
  await runtime.start()
}
