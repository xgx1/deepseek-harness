/** Native management behavior through Loader, public tools, durable inboxes, and ordinary Sessions. */
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { UserQuestionProjectionState } from '@deepseek-ai/dsh-user-questions/src/projection.ts'
import { deliveryId } from '../src/state.ts'
import { bootManagementHost, type ManagementHost } from './fixtures/native-management/host.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function world() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-native-management-')))
  roots.push(root)
  const host = await bootManagementHost(root, ctx => contexts.push(ctx))
  const paths = ['manager', 'work', 'other'].map(name => join(root, name))
  await Promise.all(paths.map(path => mkdir(path)))
  const [home, work, other] = await Promise.all(paths.map(path => host.ctx.workspaceRegistry.create(path)))
  if (home === undefined || work === undefined || other === undefined) throw new Error('Fixture workspaces were not created')
  const manager = await host.create('manager-session', home, 'manager')
  return { ...host, root, home, work, other, manager }
}

function inputs(session: Session) {
  return session.snapshotEvents().flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
    .filter(message => message.source.kind === 'session-manager')
}

function lastToolResult(session: Session) {
  return session.snapshotEvents().flatMap(event => event.type === 'tool/result' ? [event.data.message] : []).at(-1)
}

function requests(host: ManagementHost, agent: Agent) {
  return host.adapter.requests.filter(request => request.sessionId === agent.id)
}

/** The userQuestions projection fold for one Agent, read from the persisted checkpoint cache. */
function activeQuestions(ctx: Context, agent: Agent) {
  return ctx.sessionProjections.checkpoint(agent.session).userQuestions?.val as UserQuestionProjectionState | undefined
}

async function createWorker(host: ManagementHost, manager: Agent, workspaceId: string, key: string) {
  const result = await host.execute(manager, 'manager_create', {
    workspaceId, agentPreset: 'independent', message: 'Implement the selected task.', idempotencyKey: key,
  })
  if (result === undefined) throw new Error('manager_create produced no result')
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error(JSON.stringify(result.content))
  return host.agent(z.object({ workerSessionId: z.string() }).parse(result.value).workerSessionId)
}

const questions = [
  { id: 'color', question: 'Which color?', options: [{ label: 'Blue' }, { label: 'Red' }] },
  { id: 'size', question: 'Which size?' },
]

describe('native management composition', () => {
  it('isolates manager schemas, prompt and executor without adopting ordinary Sessions in its workspace', async () => {
    const host = await world()
    const { ctx, manager, home } = host
    const ordinary = await host.create('same-workspace', home)
    const before = ctx.tools.schemas(ordinary).map(tool => tool.name)
    await host.turn(manager, 'List my capabilities.')
    const managerRequest = requests(host, manager).at(-1)
    expect(managerRequest?.tools?.map(tool => tool.name).sort()).toEqual([
      'ask_user_question', 'manager_add_workspace', 'manager_answer', 'manager_create', 'manager_list',
      'manager_preferences', 'manager_send', 'manager_workspaces',
    ])
    expect(JSON.stringify(managerRequest?.messages[0])).toContain('You manage ordinary work conversations')
    expect(JSON.stringify(managerRequest?.messages[0])).not.toContain('ORDINARY PERSONA')

    for (const name of ['run_code', 'bash', 'skill', 'mcp__fixture__read']) {
      expect(await host.execute(manager, name)).toMatchObject({
        isError: true, error: { message: 'Manager execution capability denied' },
      })
    }
    for (const name of ['bash', 'skill', 'mcp__fixture__read', 'ordinary_only']) {
      expect(await host.execute(ordinary, name)).toMatchObject({ isError: false, value: name })
    }
    expect(ctx.tools.schemas(ordinary).map(tool => tool.name)).toEqual(before)
    expect(await host.execute(manager, 'manager_list')).toMatchObject({ isError: false, value: { conversations: [], questions: [] } })
    expect(await host.execute(manager, 'manager_send', {
      workerSessionId: ordinary.id, message: 'Must not be adopted.', idempotencyKey: 'not-owned',
    })).toMatchObject({ isError: true })
    expect(inputs(ordinary.session)).toEqual([])
    expect(ctx.tools.get('manager_report', ordinary)).toBeUndefined()
    expect(ctx.tools.get('manager_create', ordinary)).toBeUndefined()
    expect(ctx.tools.get('manager_add_workspace', ordinary)).toBeUndefined()

    const remove = manager.ctx.tools.register({
      name: 'bash', description: 'A later scope-local registration must not bypass policy.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'forbidden body',
    })
    try {
      expect(await host.execute(manager, 'bash')).toMatchObject({
        isError: true, error: { message: 'Manager execution capability denied' },
      })
    } finally { remove() }

    const managerEntry = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:manager')
    if (managerEntry?.fiber === undefined) throw new Error('Manager Loader row is missing')
    await managerEntry.fiber.dispose()
    expect(ctx.tools.get('manager_create', manager)).toBeUndefined()
    // 上游契约：scoped executor 卸载后该 scope 的选择保持 unavailable，绝不回落到另一个 executor。
    await expect(host.execute(manager, 'bash')).rejects.toThrow(/tool executor is unavailable/i)
    expect(await host.execute(ordinary, 'bash')).toMatchObject({ isError: false, value: 'bash' })
    expect(ctx.tools.schemas(ordinary).map(tool => tool.name)).toEqual(before)
    // 管理器 scope 的 executor 已随之卸载，该 Agent 再也走不到模型；普通 Agent 的提示词与能力原样存活。
    await host.turn(ordinary, 'Use the surviving ordinary prompt after extension unload.')
    expect(JSON.stringify(requests(host, ordinary).at(-1)?.messages[0])).toContain('ORDINARY PERSONA')
  })

  it('registers an existing directory as a workspace and refuses paths it cannot own', async () => {
    const host = await world()
    const { ctx, manager, root } = host
    const directory = join(root, 'fresh-workspace')
    await mkdir(directory)
    const canonical = await realpath(directory)

    const added = await host.execute(manager, 'manager_add_workspace', { path: directory })
    expect(added).toMatchObject({ isError: false, value: { path: canonical, created: true } })
    const workspaceId = z.object({ workspaceId: z.string() }).parse(added?.value).workspaceId
    expect(ctx.workspaceRegistry.list().map(workspace => workspace.id)).toContain(workspaceId)
    expect(await host.execute(manager, 'manager_workspaces')).toMatchObject({
      isError: false,
      value: { workspaces: expect.arrayContaining([expect.objectContaining({ id: workspaceId, path: canonical })]) },
    })

    // 幂等：同一目录再加一次不产生第二条登记。
    expect(await host.execute(manager, 'manager_add_workspace', { path: directory })).toMatchObject({
      isError: false, value: { workspaceId, created: false },
    })
    expect(ctx.workspaceRegistry.list().filter(workspace => workspace.path === canonical)).toHaveLength(1)

    // 相对路径拒绝（否则会按进程 cwd 建目录）。
    const relative = await host.execute(manager, 'manager_add_workspace', { path: 'relative/dir' })
    expect(relative).toMatchObject({ isError: true })
    expect(JSON.stringify(relative?.content)).toContain('absolute path')
    expect(ctx.workspaceRegistry.list()).toHaveLength(4)

    // 目录不存在时一次调用就建出来并登记。
    const fresh = join(root, 'made-by-manager', 'nested')
    expect(await host.execute(manager, 'manager_add_workspace', { path: fresh })).toMatchObject({
      isError: false, value: { path: await realpath(fresh), created: true, createdDirectory: true },
    })
    expect(ctx.workspaceRegistry.list()).toHaveLength(5)
  })

  it('creates an independent cross-workspace root and routes a durable question until all answers arrive once', async () => {
    const host = await world()
    const { ctx, manager, work, other, state } = host
    const unrelated = await host.create('unrelated-worker', other)
    const worker = await createWorker(host, manager, work.id, 'first-task')
    await worker.whenIdle()
    expect(worker.session.header).toMatchObject({ cwd: work.path, agentPreset: 'independent', isSeeded: false })
    expect(worker.session.header.parentSession).toBeUndefined()
    expect(worker.session.header.origin).not.toBe('subagent')
    expect(ctx.agents.list()).toContain(worker)
    expect(work.sessionIds).toContain(worker.id)
    expect(ctx.tools.schemas(worker).map(tool => tool.name)).toContain('independent_only')
    expect(ctx.tools.schemas(worker).map(tool => tool.name)).not.toContain('ordinary_only')
    expect(await createWorker(host, manager, work.id, 'first-task')).toBe(worker)
    expect(inputs(worker.session)).toHaveLength(1)
    expect(await host.execute(manager, 'manager_create', {
      workspaceId: work.id, agentPreset: 'independent', message: 'Conflicting task.', idempotencyKey: 'first-task',
    })).toMatchObject({ isError: true })

    await manager.whenIdle()
    const questionId = deliveryId(worker.id, 'worker-business')
    // 管理端不直接向用户提问：入口只把用户引到任务面板（ADR-0013）。
    expect(await host.execute(manager, 'ask_user_question', { questions })).toMatchObject({
      isError: false, value: { recorded: false, where: 'task-panel' },
    })
    expect(JSON.stringify(activeQuestions(ctx, manager) ?? {})).not.toContain('ask_user_question')
    await host.turn(worker, 'Ask for the two business decisions.', toolCallResponse('worker-business', 'ask_user_question', { questions }))
    await expect.poll(() => state().questions[questionId]?.status).toBe('pending')
    await manager.whenIdle()
    // 非阻塞：提问后这一轮继续往下走，所以是 3 次请求而不是「问完就停」的 2 次。
    expect(requests(host, worker)).toHaveLength(3)
    expect(lastToolResult(worker.session)).toMatchObject({ isError: false })
    expect(lastToolResult(worker.session)?.content.some(block => block.type === 'text' && block.text.includes('"pending":true'))).toBe(true)
    const forwarded = inputs(manager.session).filter(message => JSON.stringify(message.content).includes('worker-question'))
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]?.source).toMatchObject({ kind: 'session-manager', managerSessionId: manager.id, workerSessionId: worker.id })
    const forwardedText = forwarded[0]?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
    expect(z.json().parse(JSON.parse(forwardedText))).toMatchObject({
      type: 'worker-question', id: questionId, workerId: worker.id, managerId: manager.id,
      questions, answers: [], status: 'pending',
    })
    const asked = await host.execute(worker, 'ask_user_question', { questions }, 'worker-business')
    expect(asked).toMatchObject({ isError: false, value: { pending: true, questionId } })
    expect(asked?.concludesTurn).not.toBe(true)
    expect(inputs(manager.session).filter(message => JSON.stringify(message.content).includes('worker-question'))).toHaveLength(1)
    await ctx.sessions.flush(manager.session)

    const workerRequests = requests(host, worker).length
    expect(await host.execute(manager, 'manager_answer', {
      questionId, answers: [{ id: 'color', selected: ['Blue'] }],
    })).toMatchObject({ isError: false, value: { pending: true } })
    await worker.whenIdle()
    expect(requests(host, worker)).toHaveLength(workerRequests)
    expect(state().questions[questionId]?.answers).toEqual([{ id: 'color', selected: ['Blue'] }])
    // 问题未答也照样能继续派活：没有人被挂起。
    expect(await host.execute(manager, 'manager_send', {
      workerSessionId: worker.id, message: 'Keep going with the provisional layout.', idempotencyKey: 'continue',
    })).toMatchObject({ isError: false, value: { delivered: true } })

    await ctx.sessions.flush(manager.session)
    await ctx.sessions.flush(worker.session)
    await ctx.fiber.dispose()
    const cold = await bootManagementHost(host.root, owner => contexts.push(owner))
    const resolved = await cold.ctx.sessionController.resolveAgent(manager.id)
    if ('error' in resolved) throw resolved.error
    const coldManager = resolved.agent
    expect(cold.state().questions[questionId]).toMatchObject({ status: 'pending', answers: [{ id: 'color', selected: ['Blue'] }] })
    expect(cold.ctx.agents.get(worker.id)).toBeUndefined()
    // 冷恢复后由管理端补上最后一项，工作对话只被唤醒一次。
    expect(await cold.execute(coldManager, 'manager_answer', {
      questionId, answers: [{ id: 'size', selected: [], custom: 'Large' }],
    })).toMatchObject({ isError: false, value: { pending: false } })
    await expect.poll(() => cold.state().questions[questionId]?.status).toBe('answered')
    await expect.poll(() => cold.ctx.agents.get(worker.id)).toBeDefined()
    const coldWorker = cold.agent(worker.id)
    await coldWorker.whenIdle()
    await coldManager.whenIdle()
    expect(requests(cold, coldWorker)).toHaveLength(1)
    const answerInputs = inputs(coldWorker.session).filter(message => JSON.stringify(message.content).includes('manager-answer'))
    expect(answerInputs).toHaveLength(1)
    expect(answerInputs[0]?.source).toMatchObject({ kind: 'session-manager', managerSessionId: manager.id, workerSessionId: worker.id })
    expect(JSON.stringify(answerInputs[0]?.content)).toContain('does not grant tool permissions')
    expect(inputs(unrelated.session)).toEqual([])
    expect(requests(host, unrelated)).toEqual([])
    expect(cold.ctx.agents.get(unrelated.id)).toBeUndefined()
    expect(inputs(coldWorker.session).filter(message => JSON.stringify(message.content).includes('manager-answer'))).toHaveLength(1)
  })

  it('retains paused deliveries across a cold reopen and revokes detached workers', async () => {
    const host = await world()
    const { manager, work } = host
    const worker = await createWorker(host, manager, work.id, 'recover-task')
    await worker.whenIdle()
    await manager.whenIdle()
    expect(await host.command(manager, `/manage pause ${worker.id}`)).toMatchObject({ result: { kind: 'success' } })
    const before = requests(host, worker).length
    expect(await host.execute(manager, 'manager_send', {
      workerSessionId: worker.id, message: 'Not while paused.', idempotencyKey: 'paused-send',
    })).toMatchObject({ isError: true })
    await host.turn(worker, 'A direct input must not override management pause.')
    expect(requests(host, worker)).toHaveLength(before)
    expect(await host.command(manager, `/manage resume ${worker.id}`)).toMatchObject({ result: { kind: 'success' } })
    expect(await host.command(manager, '/manage pause')).toMatchObject({ result: { kind: 'success' } })
    const report = { status: 'progress', summary: 'A durable report waiting for its manager.' }
    const reportId = deliveryId(worker.id, 'report', 'recovery-report')
    expect(await host.execute(worker, 'manager_report', report, 'recovery-report')).toMatchObject({ isError: false })
    expect(host.state().deliveries[reportId]).toMatchObject({ targetId: manager.id, delivered: false })
    expect(inputs(manager.session).some(message => message.id === reportId)).toBe(false)
    await host.ctx.sessions.flush(worker.session)
    await host.ctx.sessions.flush(manager.session)
    await host.ctx.fiber.dispose()

    const recovered = await bootManagementHost(host.root, ctx => contexts.push(ctx))
    const result = await recovered.ctx.sessionController.resolveAgent(manager.id)
    if ('error' in result) throw result.error
    const resumedManager = result.agent
    expect(recovered.state().pausedManagers).toContain(manager.id)
    expect(recovered.state().deliveries[reportId]).toMatchObject({ delivered: false })
    expect(inputs(resumedManager.session).some(message => message.id === reportId)).toBe(false)
    expect(await recovered.command(resumedManager, '/manage resume')).toMatchObject({ result: { kind: 'success' } })
    await resumedManager.whenIdle()
    expect(recovered.state().deliveries[reportId]).toMatchObject({ delivered: true })
    expect(inputs(resumedManager.session).filter(message => message.id === reportId)).toHaveLength(1)
    expect(await recovered.execute(resumedManager, 'manager_send', {
      workerSessionId: worker.id, message: 'Recovered instruction.', idempotencyKey: 'recovery',
    })).toMatchObject({ isError: false })
    const resumedWorker = recovered.agent(worker.id)
    await resumedWorker.whenIdle()
    expect(await recovered.execute(resumedWorker, 'manager_report', report, 'recovery-report')).toMatchObject({ isError: false })
    expect(inputs(resumedManager.session).filter(message => message.id === reportId)).toHaveLength(1)
    expect(await recovered.execute(resumedWorker, 'manager_report', { ...report, summary: 'Conflicting retry.' }, 'recovery-report')).toMatchObject({ isError: true })
    expect(inputs(resumedWorker.session).filter(message => JSON.stringify(message.content).includes('Recovered instruction.'))).toHaveLength(1)
    expect(await recovered.execute(resumedManager, 'manager_send', {
      workerSessionId: worker.id, message: 'Recovered instruction.', idempotencyKey: 'recovery',
    })).toMatchObject({ isError: false })
    expect(inputs(resumedWorker.session).filter(message => JSON.stringify(message.content).includes('Recovered instruction.'))).toHaveLength(1)
    expect(await recovered.command(resumedManager, `/manage detach ${worker.id}`)).toMatchObject({ result: { kind: 'success' } })
    expect(await recovered.execute(resumedManager, 'manager_send', {
      workerSessionId: worker.id, message: 'Revoked.', idempotencyKey: 'detached',
    })).toMatchObject({ isError: true })
    expect(recovered.ctx.tools.get('manager_report', resumedWorker)).toBeUndefined()
    await resumedManager.whenIdle()
    const managerRequests = requests(recovered, resumedManager).length
    await recovered.turn(resumedWorker, 'Ordinary work after detachment.')
    await resumedManager.whenIdle()
    expect(requests(recovered, resumedWorker)).toHaveLength(2)
    expect(requests(recovered, resumedManager)).toHaveLength(managerRequests)
    expect(await recovered.execute(resumedWorker, 'independent_only')).toMatchObject({ isError: false, value: 'independent_only' })
  })
})
