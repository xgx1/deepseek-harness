/**
 * Mask enforcement must converge. Every mutation it installs emits
 * `tools/change`, so a selection that never compares equal to what is already
 * installed makes the service recompute forever and starve the host event loop.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentConfigsService from '../src/index.ts'

let home: string
let cwd: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'agent-config-home-'))
  cwd = await mkdtemp(join(tmpdir(), 'agent-config-project-'))
  vi.stubEnv('DSH_HOME', home)
  await writeFile(join(home, 'agent-configs.yaml'), [
    'configs:',
    '  mini:',
    '    skills: []',
    '    mcp: [cbm]',
    '',
  ].join('\n'), 'utf-8')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
  await rm(cwd, { recursive: true, force: true })
})

/** Drain the serialized refresh queue so a non-converging recompute shows up as repeated calls. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 200; tick++) await new Promise(resolve => setTimeout(resolve, 2))
}

it('converges when a governed agent has servers to hide but no tools to deny', async () => {
  const ctx = new Context()
  const counts = { suppress: 0, restrict: 0, change: 0 }
  // Every installed mask emits the very event that schedules the next recompute.
  const change = (): void => { counts.change += 1; ctx.emit('tools/change') }
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('tools', { schemas: () => [] } as never)
  ctx.provide('mcpResources', {
    servers: () => ['cbm', 'other'],
    suppress: () => { counts.suppress += 1; change(); return () => {} },
  } as never)
  const service = new AgentConfigsService(ctx)
  // Select through the service so the document is written in its own format.
  await service.setSelection({ cwd, selected: ['mini'] })
  const agentCtx = {
    tools: { schemas: () => [], restrict: () => { counts.restrict += 1; change(); return () => {} } },
  }
  ctx.emit('agent/created', {
    agent: { session: { id: 'session-unsettled', header: { cwd } }, ctx: agentCtx },
  } as never)
  await settle()
  // One installation per governed agent, and the emitted change does not reschedule it.
  expect(counts.suppress).toBe(1)
  expect(counts.restrict).toBe(0)
  expect(counts.change).toBe(1)
})

it('reinstalls once per real selection change and then settles again', async () => {
  const ctx = new Context()
  const hide: string[][] = []
  const counts = { change: 0 }
  const change = (): void => { counts.change += 1; ctx.emit('tools/change') }
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('tools', { schemas: () => [] } as never)
  ctx.provide('mcpResources', {
    servers: () => ['cbm', 'other'],
    suppress: (names: string[]) => { hide.push([...names]); change(); return () => {} },
  } as never)
  const service = new AgentConfigsService(ctx)
  await service.setSelection({ cwd, selected: ['mini'] })
  const agentCtx = { tools: { schemas: () => [], restrict: () => change() } }
  ctx.emit('agent/created', {
    agent: { session: { id: 'session-change', header: { cwd } }, ctx: agentCtx },
  } as never)
  await settle()
  expect(hide).toEqual([['other']])
  // Dropping the server the document keeps forces exactly one new installation.
  // Dropping the only server the selected configuration allows forces one new installation.
  await writeFile(join(home, 'agent-configs.yaml'), [
    'configs:',
    '  mini:',
    '    skills: []',
    '    mcp: []',
    'projects:',
    `  ${JSON.stringify(cwd)}: [mini]`,
    '',
  ].join('\n'), 'utf-8')
  void service
  ctx.emit('tools/change')
  await settle()
  expect(hide).toEqual([['other'], ['cbm', 'other']])
})
