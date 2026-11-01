/** Native Loader services with scripted model output and observable fixture tool bodies. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets, { auditRows } from '@deepseek-ai/dsh-agent-preset-registry'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import Attachments from '@deepseek-ai/dsh-attachment-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import Uploads from '@deepseek-ai/dsh-client-file-upload'
import Commands from '@deepseek-ai/dsh-commands'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import Workspaces, { type Workspace } from '@deepseek-ai/dsh-workspace'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { textResponse } from '../../../../../core/agent-loop/tests/mock-adapter.ts'
import * as Manager from '../../../src/index.ts'
import { managementStateSchema } from '../../../src/state.ts'

/** Per-Session model scripts avoid a shared FIFO racing independent native Agents. */
export class ManagementAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly scripts = new Map<string, StreamChunk[][]>()

  /** Queue deterministic model output for one native Agent. */
  enqueue(agent: Agent, ...responses: StreamChunk[][]): void {
    const script = this.scripts.get(agent.id) ?? []
    script.push(...responses)
    this.scripts.set(agent.id, script)
  }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* this.scripts.get(String(options.sessionId))?.shift() ?? textResponse('Idle; no completion claim.')
  }
}

/** Real registry tool bodies make forbidden executor calls observable without executing a shell. */
function marker(ctx: Context, name: string): void {
  ctx.effect(() => ctx.tools.register({
    name, description: `Fixture capability ${name}`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: name }] },
    execute: async () => name,
  }))
}

const presetRows = {
  name: 'native-management-presets', inject: ['agentPresets', 'tools', 'systemPrompt'],
  async apply(ctx: Context): Promise<void> {
    for (const tool of ['bash', 'skill', 'mcp__fixture__read']) marker(ctx, tool)
    ctx.effect(() => ctx.systemPrompt.section({ name: 'ordinary-persona', order: 1, text: 'ORDINARY PERSONA' }))
    for (const id of ['manager', 'ordinary', 'independent']) {
      ctx.effect(() => ctx.agentPresets.register({ id, plugins: id === 'manager' ? [] : [
        { name: `cordis:${id}-tools` },
      ] }))
    }
  },
}

/** Boot the test-only composition over a private persisted world.
 * @param root - Private temporary directory for configuration, workspaces, and storage.
 * @param own - Register the Context for teardown before setup can fail.
 * @returns Native services, scripted model output, and public-operation helpers.
 */
export async function bootManagementHost(root: string, own: (ctx: Context) => void) {
  const ctx = new Context()
  own(ctx)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    include: Include, persistence: Persistence, storage: Storage, 'storage-json': StorageJson,
    'storage-domain': StorageDomain, workspace: Workspaces, query: Query, typert: (await import('@deepseek-ai/dsh-typert-registry')).default,
    'default-model': AgentDefaultModel, credentials: Credentials, connection: Connection,
    attachments: Attachments, commands: Commands, uploads: Uploads, questions: UserQuestions,
    presets: AgentPresets, 'fixture-presets': presetRows, loop: AgentLoop,
    controller: SessionController, manager: Manager,
    'ordinary-tools': { inject: ['tools'], apply: (scope: Context) => { marker(scope, 'ordinary_only') } },
    'independent-tools': { inject: ['tools'], apply: (scope: Context) => { marker(scope, 'independent_only') } },
  })
  const adapter = new ManagementAdapter()
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], adapter))
  const compositionPath = join(root, 'cordis.yml')
  await copyFile(new URL('./cordis.yml', import.meta.url), compositionPath)
  await ctx.loader.root.update([{ id: 'composition', name: 'cordis:include', config: {
    path: pathToFileURL(compositionPath).href,
    patches: [
      { id: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
      { id: 'storage-json', config: { root: join(root, 'storages') } },
      { id: 'attachments', config: { dshHome: join(root, 'home') } },
      { id: 'credentials', config: { dshHome: join(root, 'home'), watch: false } },
    ],
  } }])
  const audit = await auditRows(ctx.loader)
  if (audit.failed.length || audit.pending.length) throw new Error(`Native composition did not mount: ${JSON.stringify(audit)}`)
  const domain = ctx.storageDomain.get('session_manager')
  if (domain === undefined) throw new Error('Management domain did not open')
  const state = () => managementStateSchema.parse(domain.global.get())

  async function create(id: string, workspace: Workspace, agentPreset = 'ordinary'): Promise<Agent> {
    const sessionId = SessionId(id)
    await ctx.sessionController.create({ sessionId, workspaceId: workspace.id, agentPreset })
    await workspace.attachSession(sessionId)
    return agent(sessionId)
  }
  function agent(id: string): Agent {
    const found = ctx.agents.get(SessionId(id))
    if (found === undefined) throw new Error(`Native Agent not published: ${id}`)
    return found
  }
  async function execute(owner: Agent, name: string, args: object = {}, callId = name) {
    return ctx.tools.execute({ agent: owner, name, arguments: args, callId: ToolCallId(callId), signal: new AbortController().signal })
  }
  async function turn(owner: Agent, text: string, ...responses: StreamChunk[][]): Promise<void> {
    adapter.enqueue(owner, ...responses)
    owner.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    await owner.whenIdle()
    await ctx.sessions.flush(owner.session)
  }
  async function command(owner: Agent, line: string) {
    return ctx.commands.execute(owner, line, [], new AbortController().signal)
  }
  return { ctx, adapter, state, create, agent, execute, turn, command }
}

/** Native fixture capabilities shared by the behavior scenarios. */
export type ManagementHost = Awaited<ReturnType<typeof bootManagementHost>>
