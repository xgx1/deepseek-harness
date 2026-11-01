/** Native UI Stop persists management suspension even when the ordinary Agent is already idle. */
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { bootManagementHost } from './fixtures/native-management/host.ts'

const contexts: Context[] = []
let root: string | undefined

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  if (root !== undefined) {
    if (!root.startsWith(join(tmpdir(), 'dsh-manager-stop-'))) throw new Error('Unexpected fixture cleanup path')
    await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

it('keeps idle managed work stopped across cold recovery without adopting unrelated work', async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-manager-stop-')))
  const host = await bootManagementHost(root, ctx => contexts.push(ctx))
  const homePath = join(root, 'home-workspace')
  const workPath = join(root, 'work')
  await Promise.all([mkdir(homePath), mkdir(workPath)])
  const home = await host.ctx.workspaceRegistry.create(homePath)
  const work = await host.ctx.workspaceRegistry.create(workPath)
  const manager = await host.create('stop-manager', home, 'manager')
  const unrelated = await host.create('unrelated-idle', work)
  const creation = await host.execute(manager, 'manager_create', {
    workspaceId: work.id, agentPreset: 'independent', message: 'Perform the assigned work.', idempotencyKey: 'idle-stop',
  })
  if (creation === undefined) throw new Error('manager_create produced no result')
  expect(creation.isError).toBe(false)
  const worker = host.agent(z.object({ workerSessionId: z.string() }).parse(creation.value).workerSessionId)
  await worker.whenIdle()
  await manager.whenIdle()
  const before = host.adapter.requests.filter(request => request.sessionId === worker.id).length
  await expect(host.ctx.sessionController.cancel({ sessionId: worker.id })).resolves.toEqual({ accepted: true })
  expect(host.state().links[worker.id]).toMatchObject({ paused: true, detached: false })
  expect(await host.execute(manager, 'manager_send', {
    workerSessionId: worker.id, message: 'A late instruction must not wake stopped work.', idempotencyKey: 'late',
  })).toMatchObject({ isError: true })
  expect(host.adapter.requests.filter(request => request.sessionId === worker.id)).toHaveLength(before)
  await host.ctx.sessionController.cancel({ sessionId: unrelated.id })
  expect(host.state().links[unrelated.id]).toBeUndefined()
  await host.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(host.ctx), 1)

  const restored = await bootManagementHost(root, ctx => contexts.push(ctx))
  expect(restored.state().links[worker.id]).toMatchObject({ paused: true })
  expect(restored.ctx.agents.get(worker.id)).toBeUndefined()
})
