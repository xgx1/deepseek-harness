/** Native management behavior through Loader, public tools, durable inboxes, and ordinary Sessions. */
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
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

async function createWorker(host: ManagementHost, manager: Agent, workspaceId: string, key: string) {
  const result = await host.execute(manager, 'manager_create', {
    workspaceId, agentPreset: 'independent', message: 'Implement the selected task.', idempotencyKey: key,
  })
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
      'ask_user_question', 'manager_answer', 'manager_create', 'manager_list',
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
    expect(await host.execute(manager, 'bash')).toMatchObject({ isError: false, value: 'bash' })
    expect(ctx.tools.schemas(ordinary).map(tool => tool.name)).toEqual(before)
    await host.turn(manager, 'Use the surviving ordinary prompt after extension unload.')
    expect(JSON.stringify(requests(host, manager).at(-1)?.messages[0])).toContain('ORDINARY PERSONA')
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
    expect(ctx.agents.roots()).toContain(worker)
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
    host.adapter.enqueue(manager, toolCallResponse('manager-human', 'ask_user_question', { questionId, questions, timeout: 1 }))
    await host.turn(worker, 'Ask for the two business decisions.', toolCallResponse('worker-business', 'ask_user_question', { questions }))
    await expect.poll(() => state().questions[questionId]?.status).toBe('pending')
    await expect.poll(() => ctx.sessionProjections.stateOf(manager.session, 'userQuestions')?.questions.active).toMatchObject([
      { callId: 'manager-human', state: 'continued', questions: [{ id: 'color' }, { id: 'size' }] },
    ])
    await manager.whenIdle()
    expect(requests(host, worker)).toHaveLength(2)
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
    expect(await host.execute(worker, 'ask_user_question', { questions }, 'worker-business')).toMatchObject({
      isError: false, value: { pending: true, questionId }, concludesTurn: true,
    })
    expect(inputs(manager.session).filter(message => JSON.stringify(message.content).includes('worker-question'))).toHaveLength(1)
    await ctx.sessions.flush(manager.session)
    expect(lastToolResult(manager.session)).toMatchObject({ isError: false })
    expect(lastToolResult(manager.session)?.content.some(block => block.type === 'text' && block.text.includes('"pending":true'))).toBe(true)

    const workerRequests = requests(host, worker).length
    expect(await host.execute(manager, 'manager_answer', {
      questionId, answers: [{ id: 'color', selected: ['Blue'] }],
    })).toMatchObject({ isError: false, value: { pending: true } })
    await worker.whenIdle()
    expect(requests(host, worker)).toHaveLength(workerRequests)
    expect(state().questions[questionId]?.answers).toEqual([{ id: 'color', selected: ['Blue'] }])
    expect(await host.execute(manager, 'manager_send', {
      workerSessionId: worker.id, message: 'Do not skip the size question.', idempotencyKey: 'blocked',
    })).toMatchObject({ isError: true })

    await ctx.sessions.flush(manager.session)
    await ctx.sessions.flush(worker.session)
    await ctx.fiber.dispose()
    const cold = await bootManagementHost(host.root, owner => contexts.push(owner))
    const resolved = await cold.ctx.sessionController.resolveAgent(manager.id)
    if ('error' in resolved) throw resolved.error
    const coldManager = resolved.agent
    expect(cold.state().questions[questionId]).toMatchObject({ status: 'pending', answers: [{ id: 'color', selected: ['Blue'] }] })
    expect(cold.ctx.agents.get(worker.id)).toBeUndefined()
    expect(cold.ctx.sessionProjections.stateOf(coldManager.session, 'userQuestions')?.questions.active).toMatchObject([
      { callId: 'manager-human', state: 'continued' },
    ])
    expect(cold.ctx.userQuestions.answer(coldManager, ToolCallId('manager-human'), { answers: [
      { id: 'color', selected: ['Blue'] }, { id: 'size', selected: [], custom: 'Large' },
    ] })).toBe(true)
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
    expect(await cold.execute(coldManager, 'manager_answer', {
      questionId, answers: [{ id: 'size', selected: [], custom: 'Large' }],
    })).toMatchObject({ isError: false, value: { pending: false } })
    expect(inputs(coldWorker.session).filter(message => JSON.stringify(message.content).includes('manager-answer'))).toHaveLength(1)
    expect(cold.ctx.userQuestions.answer(coldManager, ToolCallId('manager-human'), { answers: questions.map(question => ({ id: question.id, selected: [] })) })).toBe(false)
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
