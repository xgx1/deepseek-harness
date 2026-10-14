import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import BrowserUse from '@deepseek-ai/dsh-browser-use'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import Llm, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Agents from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Projections from '@deepseek-ai/dsh-session-projection'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { bindScopeParent } from '@deepseek-ai/dsh-scope'
import { BrowserMcpConfig, mountSessionMcp, validateBrowserMcpConfig } from '../src/mcp.ts'

const fixture = fileURLToPath(new URL('./mcp-fixture.mjs', import.meta.url))
const roots: string[] = []
const contexts: Context[] = []
const TOOL = 'mcp__browser-fixture__visit'

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class FixtureModel extends LlmAdapter {
  requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.tools?.some(tool => tool.name === TOOL) && options.messages.at(-1)?.role === 'user') {
      const call = { type: 'tool-call' as const, id: ToolCallId('visit'), name: TOOL, arguments: '{"label":"fixture"}' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Visited.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Visited.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

class PresentationRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fixture'
  resolve(): never { throw new Error('Unexpected PTC execution in a presentation test') }
  run(): Promise<never> { return Promise.reject(new Error('Unexpected PTC execution in a presentation test')) }
}

async function load(exclusive = false, mode?: string, toolCallTimeoutMs?: number, toolOrder?: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-mcp-'))
  roots.push(root)
  const model = new FixtureModel()
  const modules = new Map<string, unknown>([
    ['browserUse', BrowserUse], ['prompt', SystemPrompt], ['tools', Tools], ['llm', Llm],
    ['sessions', Sessions], ['agents', Agents], ['loop', AgentLoop], ['projections', Projections],
    ['fs', LocalFileSystem], ['workingDirectory', WorkingDirectory],
    ['model', { inject: ['llm'], apply(ctx: Context) { ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model)) } }],
    ['browser', { inject: ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory'], apply(ctx: Context) {
      mountSessionMcp(ctx, { name: 'browser-fixture', exclusive, command: process.execPath, args: [fixture, root, ...mode === undefined ? [] : [mode]], ...toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs, env: {} } })
    } }],
  ])
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([...modules.keys()].map(name => ({ id: name, name, config: name === 'loop' ? { agents: [] } : name === 'prompt' && toolOrder !== undefined ? { toolOrder } : {} }))))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected fixture module ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const browser = [...ctx.loader.entries()].find(entry => entry.options.id === 'browser')!.fiber!
  return { ctx, root, model, browser }
}

async function warm(ctx: Context, agent: Agent, signal = new AbortController().signal) {
  await agent.whenIdle()
  return ctx.systemPrompt.assemble({ agent, scope: agent, signal })
}

/**
 * Wake one turn so the Session's own first step waits for browser discovery to
 * settle, and let that turn finish before the caller inspects the tools it
 * produced. The turn reaches its model whenever the fixture has a route.
 */
async function gate(_ctx: Context, agent: Agent): Promise<void> {
  agent.followup(createUserMessage({ content: [], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function execute(ctx: Context, agent: Agent, name = TOOL) {
  return ctx.tools.execute({ agent, name, arguments: name === TOOL ? { label: 'direct' } : {}, callId: ToolCallId('direct'), signal: new AbortController().signal })
}

function resource(ctx: Context, agent: Agent | undefined, name = 'read_mcp_resource', server = 'browser-fixture', callId = name) {
  return ctx.tools.execute({
    ...agent === undefined ? {} : { agent }, name,
    arguments: { server, ...name === 'read_mcp_resource' ? { uri: 'browser-fixture://state' } : {} },
    callId: ToolCallId(callId), signal: new AbortController().signal,
  })
}

function browserState(result: Awaited<ReturnType<typeof resource>>): { counter: number; pid: number } {
  expect(result.isError).toBe(false)
  const value = result.value as { contents: { text: string }[] }
  return JSON.parse(value.contents[0]!.text) as { counter: number; pid: number }
}

function registerIndependentTool(ctx: Context) {
  ctx.tools.register({
    name: 'unrelated', description: 'An independent capability.', parameters: { type: 'object' },
    output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'Independent.' }] },
    execute: async () => true,
  })
}

async function events(root: string) {
  return (await readFile(join(root, 'events.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; pid: number; name?: string; cwd?: string })
}

it('requires a browser mode and validates launch and attachment settings', () => {
  expect(BrowserMcpConfig({ mode: 'launch' })).toEqual({ mode: 'launch', headless: true })
  expect(BrowserMcpConfig({ mode: 'launch', headless: false, executablePath: '/chromium', toolCallTimeoutMs: 12 })).toMatchObject({ headless: false, toolCallTimeoutMs: 12 })
  expect(BrowserMcpConfig({ mode: 'attach', endpoint: 'wss://browser.example/devtools/browser/id' })).toEqual({ mode: 'attach', endpoint: 'wss://browser.example/devtools/browser/id', exclusive: true })
  expect(BrowserMcpConfig({ mode: 'attach', endpoint: 'wss://browser.example/devtools/browser/id', exclusive: false })).toEqual({ mode: 'attach', endpoint: 'wss://browser.example/devtools/browser/id', exclusive: false })
  for (const invalid of [{}, { mode: 'attach' }, { mode: 'attach', endpoint: 'file:///tmp/browser' }, { mode: 'launch', toolCallTimeoutMs: 0 }, { mode: 'launch', executablePath: '' }]) {
    expect(() => BrowserMcpConfig(invalid as never)).toThrow()
  }
  for (const endpoint of ['http://localhost:bad/path', 'http://localhost trailing-junk', 'file:///tmp/browser', 'http://localhost/ ']) {
    expect(() => { validateBrowserMcpConfig({ mode: 'attach', endpoint }) }).toThrow('browser endpoint')
  }
})

it('waits for SystemPrompt and ToolRuntime before reserving the provider', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(BrowserUse)
  await ctx.plugin(Agents)
  provideWorkingDirectoryFixture(ctx)
  const tools = ctx.plugin(Tools)
  const browser = ctx.plugin({
    inject: ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory'],
    apply(provider: Context) {
      mountSessionMcp(provider, { name: 'browser-fixture', exclusive: true, command: process.execPath, args: [fixture] })
    },
  })
  await Promise.all([tools, browser])
  expect(ctx.get('tools')).toBeUndefined()
  expect(ctx.browserUse.providerName).toBeUndefined()
  await ctx.plugin(SystemPrompt)
  await Promise.all([tools, browser])
  expect(ctx.browserUse.providerName).toBe('browser-fixture')
})

describe('Session MCP Loader composition', () => {
  it('discovers schemas before the first model request and retains distinct state across turns', async () => {
    const { ctx, root, model, browser } = await load(false, undefined, 5000)
    const first = await ctx.agents.create({ sessionId: SessionId('first'), meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'fixture' } })
    const second = await ctx.agents.create({ sessionId: SessionId('second') })
    expect(ctx.tools.schemas()).toEqual([])
    first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Visit the fixture.' }], source: { kind: 'user' } }))
    await first.agent.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0]?.tools?.find(tool => tool.name === TOOL)).toMatchObject({ description: 'Visit the fixture page.', parameters: { required: ['label'], additionalProperties: false } })
    expect(JSON.stringify(first.agent.session.snapshotEvents())).toContain('Visit 1: fixture')
    expect((await execute(ctx, first.agent)).content).toEqual([{ type: 'text', text: 'Visit 2: direct' }])
    first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Visit once more.' }], source: { kind: 'user' } }))
    await first.agent.whenIdle()
    expect(model.requests).toHaveLength(4)
    expect(JSON.stringify(first.agent.session.snapshotEvents())).toContain('Visit 3: fixture')
    await gate(ctx, second.agent)
    await warm(ctx, second.agent)
    expect((await execute(ctx, second.agent)).content).toEqual([{ type: 'text', text: 'Visit 1: direct' }])
    await gate(ctx, first.agent)
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.tools.schemas(first.agent)).toHaveLength(2)
    const initial = await events(root)
    expect(initial.filter(event => event.event === 'start')).toHaveLength(4)
    expect(initial.filter(event => event.event === 'probe')).toHaveLength(2)
    expect(initial.filter(event => event.event === 'initialize')).toHaveLength(2)
    await first.dispose()
    expect(ctx.tools.schemas(first.agent)).toEqual([])
    const resumed = await ctx.agents.create({ sessionId: SessionId('first') })
    await gate(ctx, resumed.agent)
    await warm(ctx, resumed.agent)
    expect((await execute(ctx, resumed.agent)).content).toEqual([{ type: 'text', text: 'Visit 1: direct' }])
    await browser.dispose()
    expect(ctx.browserUse.providerName).toBeUndefined()
    const closed = await events(root)
    for (const { pid } of closed.filter(event => event.event === 'start')) {
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    }
  })

  it('keeps unrelated and child Sessions running without a busy attachment and admits a later owner', async () => {
    const { ctx, root, model } = await load(true)
    registerIndependentTool(ctx)
    const first = await ctx.agents.create({ sessionId: SessionId('first') })
    const second = await ctx.agents.create({ sessionId: SessionId('second'), agentOptions: { provider: 'fixture', model: 'fixture' } })
    const child = await ctx.agents.create({
      sessionId: SessionId('child'), parentAgent: first.agent, agentOptions: { provider: 'fixture', model: 'fixture' },
      setup: (_inner, agent) => { bindScopeParent(agent, first.agent) },
    })
    await gate(ctx, first.agent)
    await warm(ctx, first.agent)
    expect(ctx.tools.schemas(child.agent).some(tool => tool.name === TOOL)).toBe(false)
    for (const { agent } of [second, child]) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Answer without using the browser.' }], source: { kind: 'user' } }))
    }
    await Promise.all([second.agent.whenIdle(), child.agent.whenIdle()])
    expect(model.requests).toHaveLength(2)
    expect(model.requests.map(request => request.tools?.map(tool => tool.name))).toEqual([['unrelated'], ['unrelated']])
    for (const { agent } of [second, child]) {
      expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['unrelated'])
      expect((await execute(ctx, agent)).isError).toBe(true)
      expect((await execute(ctx, agent, 'unrelated')).isError).toBe(false)
      await gate(ctx, agent)
      expect((await warm(ctx, agent)).tools.map(tool => tool.name)).toEqual(['unrelated'])
    }
    first.agent.ctx.tools.register({
      name: 'mcp__browser-fixture__late', description: 'A newly discovered browser operation.', parameters: { type: 'object' },
      output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'Late browser result.' }] },
      execute: async () => true,
    })
    expect(ctx.tools.schemas(child.agent).filter(tool => tool.name.startsWith('mcp__browser-fixture__'))).toEqual([])
    await gate(ctx, child.agent)
    expect((await warm(ctx, child.agent)).tools.map(tool => tool.name)).toEqual(['unrelated'])
    expect((await execute(ctx, child.agent, 'mcp__browser-fixture__late')).isError).toBe(true)
    expect((await events(root)).filter(event => event.event === 'initialize')).toHaveLength(1)
    expect((await events(root)).filter(event => event.event === 'call')).toEqual([])
    await gate(ctx, first.agent)
    expect((await execute(ctx, first.agent)).isError).toBe(false)
    await first.dispose()
    await gate(ctx, child.agent)
    expect((await warm(ctx, child.agent)).tools.some(tool => tool.name === TOOL)).toBe(false)
    expect((await execute(ctx, child.agent)).isError).toBe(true)
    await gate(ctx, second.agent)
    expect((await warm(ctx, second.agent)).tools.map(tool => tool.name)).toEqual(['unrelated'])
    const successor = await ctx.agents.create({ sessionId: SessionId('successor') })
    await gate(ctx, successor.agent)
    expect((await warm(ctx, successor.agent)).tools.some(tool => tool.name === TOOL)).toBe(true)
    expect((await execute(ctx, successor.agent)).isError).toBe(false)
    await successor.dispose()
    await second.dispose()
    const resumed = await ctx.agents.create({ sessionId: SessionId('second') })
    await gate(ctx, resumed.agent)
    expect((await warm(ctx, resumed.agent)).tools.some(tool => tool.name === TOOL)).toBe(true)
    expect((await execute(ctx, resumed.agent)).isError).toBe(false)
  })

  it('keeps creation immediate and fails the first step while discovery is pending', async () => {
    const { ctx, root, model, browser } = await load(true, 'hold')
    const first = await ctx.agents.create({ sessionId: SessionId('first') })
    first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Visit the fixture.' }], source: { kind: 'user' } }))
    const turn = first.agent.whenIdle()
    await vi.waitFor(async () => { expect((await events(root)).some(event => event.event === 'probe')).toBe(true) })
    const second = await ctx.agents.create({ sessionId: SessionId('second'), agentOptions: { provider: 'fixture', model: 'fixture' } })
    second.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Answer without using the browser.' }], source: { kind: 'user' } }))
    await second.agent.whenIdle()
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools ?? []).toEqual([])
    expect((await events(root)).filter(event => event.event === 'start')).toHaveLength(1)
    await browser.dispose()
    await turn
    expect(model.requests).toHaveLength(1)
    expect(first.agent).toBe(ctx.agents.get(SessionId('first')))
  })

  it('fails the first step and rolls back the process when discovery fails', async () => {
    const failed = await load(false, 'fail')
    const { agent } = await failed.ctx.agents.create({
      sessionId: SessionId('failure'), agentOptions: { provider: 'fixture', model: 'fixture' },
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Visit the fixture.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(failed.model.requests).toEqual([])
    expect(failed.ctx.agents.get(agent.id)).toBe(agent)
    expect(failed.ctx.tools.schemas(agent)).toEqual([])
    const failedEvents = await events(failed.root)
    expect(failedEvents.filter(event => event.event === 'initialize')).toHaveLength(1)
    for (const { pid } of failedEvents.filter(event => event.event === 'start')) {
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    }
    const held = await load(false, 'hold')
    const pendingOwner = await held.ctx.agents.create({ sessionId: SessionId('pending') })
    pendingOwner.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Visit the fixture.' }], source: { kind: 'user' } }))
    const interrupted = pendingOwner.agent.whenIdle()
    await vi.waitFor(async () => { expect((await events(held.root)).some(event => event.event === 'probe')).toBe(true) })
    await held.browser.dispose()
    await interrupted
    expect(held.model.requests).toEqual([])
    for (const { pid } of (await events(held.root)).filter(event => event.event === 'start')) {
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    }
  })

  it('does not reconnect and silently replace browser state after a process exits', async () => {
    const { ctx, root } = await load()
    const owner = await ctx.agents.create({ sessionId: SessionId('disconnect') })
    await gate(ctx, owner.agent)
    await warm(ctx, owner.agent)
    const servingPid = (await events(root)).find(event => event.event === 'initialize')!.pid
    await execute(ctx, owner.agent, 'mcp__browser-fixture__disconnect')
    await vi.waitFor(() => { expect(() => process.kill(servingPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' })) })
    await gate(ctx, owner.agent)
    await warm(ctx, owner.agent)
    expect((await events(root)).filter(event => event.event === 'initialize')).toHaveLength(1)
    expect((await execute(ctx, owner.agent)).isError).toBe(true)
  })

  it('keeps browser ownership exact when scopes inherit tools and leaves unrelated tools usable', async () => {
    const { ctx } = await load()
    await ctx.systemPrompt.assemble()
    const owner = await ctx.agents.create({ sessionId: SessionId('parent') })
    const child = await ctx.agents.create({
      sessionId: SessionId('child'), parentAgent: owner.agent,
      setup: (_inner, agent) => { bindScopeParent(agent, owner.agent) },
    })
    await gate(ctx, owner.agent)
    await warm(ctx, owner.agent)
    registerIndependentTool(ctx)
    expect((await execute(ctx, owner.agent, 'unrelated')).content).toEqual([{ type: 'text', text: 'Independent.' }])
    await gate(ctx, child.agent)
    await warm(ctx, child.agent)
    expect((await execute(ctx, child.agent)).content).toEqual([{ type: 'text', text: 'Visit 1: direct' }])
  })

  it('denies inherited browser resources and instructions while keeping unrelated MCP servers usable', async () => {
    const { ctx, root } = await load(true)
    await ctx.plugin(McpResources)
    ctx.mcpResources.register('docs', { request: async () => ({ contents: [{ uri: 'docs://memo', text: 'Independent document.' }] }) })
    const parent = await ctx.agents.create({ sessionId: SessionId('resource-parent') })
    const child = await ctx.agents.create({
      sessionId: SessionId('resource-child'), parentAgent: parent.agent,
      setup: (_inner, agent) => { bindScopeParent(agent, parent.agent) },
    })
    await gate(ctx, parent.agent)
    expect(renderPrompt(await warm(ctx, parent.agent))).toContain('BROWSER_FIXTURE_INSTRUCTION')
    await gate(ctx, child.agent)
    const blocked = await warm(ctx, child.agent)
    expect(blocked.tools.some(tool => tool.name === TOOL)).toBe(false)
    expect(renderPrompt(blocked)).not.toContain('BROWSER_FIXTURE_INSTRUCTION')
    expect(renderPrompt(blocked)).toContain('browser-fixture')
    for (const name of ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource']) {
      expect((await resource(ctx, child.agent, name)).isError).toBe(true)
    }
    expect((await resource(ctx, undefined)).isError).toBe(true)
    expect((await events(root)).filter(event => event.event === 'resource')).toEqual([])
    expect((await resource(ctx, child.agent, 'read_mcp_resource', 'docs')).value)
      .toEqual({ contents: [{ uri: 'docs://memo', text: 'Independent document.' }] })
    for (const args of [null, 'invalid arguments']) {
      expect((await ctx.tools.execute({ agent: child.agent, name: 'read_mcp_resource', arguments: args, callId: ToolCallId('invalid-resource'), signal: new AbortController().signal })).isError).toBe(true)
    }
    expect(browserState(await resource(ctx, parent.agent)).counter).toBe(0)
    await parent.dispose()
    await gate(ctx, child.agent)
    expect(renderPrompt(await warm(ctx, child.agent))).not.toContain('BROWSER_FIXTURE_INSTRUCTION')
    expect((await resource(ctx, child.agent)).isError).toBe(true)
    const successor = await ctx.agents.create({ sessionId: SessionId('resource-successor') })
    await gate(ctx, successor.agent)
    expect(renderPrompt(await warm(ctx, successor.agent))).toContain('BROWSER_FIXTURE_INSTRUCTION')
    expect(browserState(await resource(ctx, successor.agent)).counter).toBe(0)
  })

  it('uses the child connection for resources and serializes them with browser tools exactly once', async () => {
    const { ctx } = await load()
    await ctx.plugin(McpResources)
    const parent = await ctx.agents.create({ sessionId: SessionId('parent') })
    const child = await ctx.agents.create({
      sessionId: SessionId('child'), parentAgent: parent.agent,
      setup: (_inner, agent) => { bindScopeParent(agent, parent.agent) },
    })
    await gate(ctx, parent.agent)
    await warm(ctx, parent.agent)
    await execute(ctx, parent.agent)
    await gate(ctx, child.agent)
    await warm(ctx, child.agent)
    const parentOnly = vi.fn(async () => true)
    parent.agent.ctx.tools.register({
      name: 'mcp__browser-fixture__parent_only', description: 'A browser operation available only in the parent.', parameters: { type: 'object' },
      output: { schema: { type: 'boolean' }, render: () => [] }, execute: parentOnly,
    })
    expect((await execute(ctx, child.agent, 'mcp__browser-fixture__parent_only')).isError).toBe(true)
    expect(parentOnly).not.toHaveBeenCalled()
    const parentState = browserState(await resource(ctx, parent.agent))
    const childState = browserState(await resource(ctx, child.agent))
    expect(parentState.counter).toBe(1)
    expect(childState.counter).toBe(0)
    expect(childState.pid).not.toBe(parentState.pid)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const started: string[] = []
    const stop = ctx.on('tools/execute', async (exec, next) => {
      if (exec.agent === child.agent) {
        started.push(exec.name)
        if (exec.callId === ToolCallId('held-resource')) {
          entered.resolve(undefined)
          await release.promise
        }
      }
      return next()
    })
    try {
      const reading = resource(ctx, child.agent, 'read_mcp_resource', 'browser-fixture', 'held-resource')
      await entered.promise
      const visiting = execute(ctx, child.agent)
      expect((await execute(ctx, parent.agent)).isError).toBe(false)
      expect(started).toEqual(['read_mcp_resource'])
      release.resolve(undefined)
      expect(browserState(await reading).counter).toBe(0)
      expect((await visiting).isError).toBe(false)
      expect(started).toEqual(['read_mcp_resource', TOOL])
      expect(browserState(await resource(ctx, child.agent)).counter).toBe(1)
    } finally {
      release.resolve(undefined)
      stop()
    }
  })

  it('holds an immediate PTC turn until the first SDK includes browser tools', async () => {
    const { ctx, root, model } = await load(false, 'gate', undefined, ['run_code', '<unlisted-tools>'])
    await writeFile(join(root, 'release'), '')
    await ctx.plugin(PresentationRuntime)
    let initializing!: Agent
    const created = ctx.agents.create({
      sessionId: SessionId('ptc-first-request'), agentOptions: { provider: 'fixture', model: 'fixture' },
      setup: (inner, agent) => {
        initializing = agent
        inner.tools.presentAs('ptc')
        inner.on('agent/created', () => {
          agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Describe the available browser tools.' }], source: { kind: 'user' } }))
        }, { prepend: true })
      },
    })
    await vi.waitFor(async () => { expect((await events(root)).some(event => event.event === 'probe')).toBe(true) })
    const owner = await created
    await rm(join(root, 'release'))
    expect(model.requests).toEqual([])
    expect((await execute(ctx, initializing)).isError).toBe(true)
    await writeFile(join(root, 'release'), '')
    await vi.waitFor(() => { expect(ctx.tools.schemas(initializing).some(tool => tool.name === TOOL)).toBe(true) })
    await owner.agent.whenIdle()
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools?.map(tool => tool.name)).toEqual(['run_code'])
    expect(JSON.stringify(model.requests[0]?.messages)).toContain(TOOL)
  })

  it('closes the starting client when a later creation listener rejects', async () => {
    const { ctx, root, model } = await load(false, undefined, undefined)
    let initializing!: Agent
    await expect(ctx.agents.create({
      sessionId: SessionId('later-listener-failure'), agentOptions: { provider: 'fixture', model: 'fixture' },
      setup: (inner, agent) => {
        initializing = agent
        inner.on('agent/created', () => { throw new Error('later initialization failed') })
      },
    })).rejects.toThrow('later initialization failed')
    expect(model.requests).toEqual([])
    expect(ctx.agents.get(initializing.id)).toBeUndefined()
    expect(ctx.sessions.get(initializing.id)).toBeUndefined()
    expect(ctx.tools.schemas(initializing)).toEqual([])
    expect((await execute(ctx, initializing)).isError).toBe(true)
    await expect(events(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains a live server directory and starts the resumed server in the current Session directory', async () => {
    const { ctx, root } = await load()
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
    await mkdir(join(root, 'original'))
    await mkdir(join(root, 'selected'))
    const original = await realpath(join(root, 'original'))
    const selected = await realpath(join(root, 'selected'))
    const sessionId = SessionId('browser-directory')
    const first = await ctx.agents.create({ sessionId, meta: { cwd: original } })
    expect((await execute(ctx, first.agent)).isError).toBe(false)
    const initial = await events(root)
    const firstCall = initial.findLast(event => event.event === 'call')
    expect(firstCall).toMatchObject({ cwd: original })
    const starts = initial.filter(event => event.event === 'start').length

    await ctx.workingDirectory.set(first.agent, selected)
    expect(first.agent.session.header.cwd).toBe(original)
    expect((await execute(ctx, first.agent)).isError).toBe(false)
    const changed = await events(root)
    expect(changed.findLast(event => event.event === 'call')).toMatchObject({ cwd: original, pid: firstCall?.pid })
    expect(changed.filter(event => event.event === 'start')).toHaveLength(starts)
    await first.dispose()

    const resumed = await ctx.agents.resume({ resumeSessionId: sessionId })
    expect(resumed.agent.session.header.cwd).toBe(original)
    expect((await execute(ctx, resumed.agent)).isError).toBe(false)
    const reopened = await events(root)
    expect(reopened.findLast(event => event.event === 'call')).toMatchObject({ cwd: selected })
    expect(reopened.filter(event => event.event === 'start').length).toBeGreaterThan(starts)
    await resumed.dispose()
  })

  it('finishes a persisted resume before discovery and holds only its first step', async () => {
    const { ctx, root, model } = await load(true, 'gate')
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
    await writeFile(join(root, 'release'), '')
    const sessionId = SessionId('persisted-browser')
    const first = await ctx.agents.create({ sessionId, agentOptions: { provider: 'fixture', model: 'fixture' } })
    first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Visit the fixture.' }], source: { kind: 'user' } }))
    await first.agent.whenIdle()
    expect(model.requests).toHaveLength(2)
    await first.dispose()
    await rm(join(root, 'release'))

    const controller = new AbortController()
    const canceledResume = ctx.agents.resume({
      resumeSessionId: sessionId, signal: controller.signal,
      agentOptions: { provider: 'fixture', model: 'fixture' },
      setup: (inner, agent) => {
        inner.on('agent/created', () => {
          agent.followup(createUserMessage({ content: [], source: { kind: 'user' } }))
        }, { prepend: true })
      },
    })
    await vi.waitFor(async () => { expect((await events(root)).filter(event => event.event === 'probe')).toHaveLength(2) })
    controller.abort(new Error('cancel browser resume'))
    const interrupted = await canceledResume
    await interrupted.agent.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(ctx.agents.get(sessionId)).toBe(interrupted.agent)
    // The aborted discovery left that Session without browser tools.
    expect(ctx.tools.schemas(interrupted.agent).some(tool => tool.name === TOOL)).toBe(false)
    await interrupted.dispose()

    let resumed = false
    const resuming = ctx.agents.resume({ resumeSessionId: sessionId }).then((handle) => {
      resumed = true
      return handle
    })
    await vi.waitFor(async () => { expect((await events(root)).filter(event => event.event === 'probe')).toHaveLength(3) })
    expect(resumed).toBe(true)
    expect(model.requests).toHaveLength(2)
    await writeFile(join(root, 'release'), '')
    const owner = await resuming
    await gate(ctx, owner.agent)
    expect(ctx.tools.schemas(owner.agent).some(tool => tool.name === TOOL)).toBe(true)
    expect((await execute(ctx, owner.agent)).content).toEqual([{ type: 'text', text: 'Visit 1: direct' }])
    await owner.dispose()
  })

  it('initializes only future activations after provider reload', async () => {
    const { ctx, root, browser } = await load()
    await browser.dispose()
    const existing = await ctx.agents.create({ sessionId: SessionId('existing') })
    await ctx.plugin({
      inject: ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory'],
      apply(inner: Context) {
        mountSessionMcp(inner, { name: 'browser-fixture', exclusive: false, command: process.execPath, args: [fixture, root] })
      },
    })
    expect((await warm(ctx, existing.agent)).tools).toEqual([])
    const future = await ctx.agents.create({ sessionId: SessionId('future') })
    await gate(ctx, future.agent)
    expect((await warm(ctx, future.agent)).tools.some(tool => tool.name === TOOL)).toBe(true)
    expect((await execute(ctx, existing.agent)).isError).toBe(true)
    expect((await execute(ctx, future.agent)).isError).toBe(false)
  })
})
