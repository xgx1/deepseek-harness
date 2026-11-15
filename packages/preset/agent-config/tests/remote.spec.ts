/**
 * The `agentConfigs` Remote namespace the configuration surface calls. Every
 * case points `$DSH_HOME` and the project cwd at temporary directories.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AgentConfigsService from '../src/index.ts'

let home: string
let cwd: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'agent-config-home-'))
  cwd = await mkdtemp(join(tmpdir(), 'agent-config-project-'))
  vi.stubEnv('DSH_HOME', home)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
  await rm(cwd, { recursive: true, force: true })
})

/** Boot the service against a stub Typert gateway and an empty tool registry. */
function boot(): AgentConfigsService {
  const ctx = new Context()
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('tools', { schemas: () => [] } as never)
  return new AgentConfigsService(ctx)
}

/** Write the home document the service reads. */
async function document(body: string): Promise<void> {
  await writeFile(join(home, 'agent-configs.yaml'), body, 'utf-8')
}

const roster = 'configs:\n  mini:\n    skills: ["cbm-graph-first"]\n    mcp: [cbm]\n'

describe('the agentConfigs Remote namespace', () => {
  it('publishes its methods under the agentConfigs namespace', () => {
    const service = boot()
    expect(service.typertRemote.namespace).toBe('agentConfigs')
    expect(remoteMethods(service).map(entry => entry.method).sort()).toEqual(['getSelection', 'overview', 'setSelection'])
  })

  it('overviews every config and every project selection for the settings page', async () => {
    await document(`${roster}projects:\n  "${cwd}":\n    - mini\n`)
    const overview = await boot().overview()
    expect(overview.path).toBe(join(home, 'agent-configs.yaml'))
    expect(overview.configs).toEqual([{ name: 'mini', skills: ['cbm-graph-first'], mcp: ['cbm'], tools: [] }])
    expect(overview.projects).toEqual([{ cwd, selected: ['mini'] }])
  })

  it('reports the overview parse error instead of throwing', async () => {
    await document('configs: [')
    const overview = await boot().overview()
    expect(overview.configs).toEqual([])
    expect(overview.error).toBeDefined()
  })

  it('reports the roster with no selection for a project the document does not list', async () => {
    await document(roster)
    const view = await boot().getSelection({ cwd })
    expect(view).toEqual({
      configs: [{ name: 'mini', skills: ['cbm-graph-first'], mcp: ['cbm'], tools: [] }],
      selected: [],
    })
  })

  it('persists a selection and reads it back', async () => {
    await document(roster)
    const service = boot()
    const saved = await service.setSelection({ cwd, selected: ['mini'] })
    expect(saved.selected).toEqual(['mini'])
    expect(await readFile(join(home, 'agent-configs.yaml'), 'utf-8')).toContain(cwd)
    expect((await service.getSelection({ cwd })).selected).toEqual(['mini'])
  })

  it('drops the project entry when the selection becomes empty', async () => {
    await document(roster)
    const service = boot()
    await service.setSelection({ cwd, selected: ['mini'] })
    const cleared = await service.setSelection({ cwd, selected: [] })
    expect(cleared.selected).toEqual([])
    expect(await readFile(join(home, 'agent-configs.yaml'), 'utf-8')).not.toContain(cwd)
  })

  it('refuses an undeclared config name', async () => {
    await document(roster)
    const failure = await boot().setSelection({ cwd, selected: ['nope'] }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'agent-configs/rejected',
      details: { reason: 'undeclared config: nope' },
    })
  })

  it('surfaces a parse failure instead of a roster', async () => {
    await document('unknown: true\n')
    const view = await boot().getSelection({ cwd })
    expect(view.configs).toEqual([])
    expect(view.selected).toEqual([])
    expect(view.error).toContain('unknown')
  })
})
