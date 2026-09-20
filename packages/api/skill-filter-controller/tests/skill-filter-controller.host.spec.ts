/**
 * The skill-filter Remote namespace a configuration surface calls. Every case
 * points `$DSH_HOME` and the project cwd at temporary directories, so no
 * assertion touches the operator's real config files.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SkillFilterRemote from '../src/index.ts'
import type { SkillFilterConfigView } from '../src/types.ts'

let home: string
let cwd: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'skill-filter-home-'))
  cwd = await mkdtemp(join(tmpdir(), 'skill-filter-project-'))
  vi.stubEnv('DSH_HOME', home)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
  await rm(cwd, { recursive: true, force: true })
})

async function boot(): Promise<{ controller: SkillFilterRemote; ctx: Context }> {
  const ctx = new Context()
  // The Typert Gateway binding is the only Typert-side dependency this owner has.
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  const controller = new SkillFilterRemote(ctx)
  expect(ctx.get('skillFilter')).toBeDefined()
  return { controller, ctx }
}

describe('the skillFilter Remote namespace', () => {
  it('publishes its five methods under the skillFilter namespace', async () => {
    const { controller } = await boot()
    expect(controller.typertRemote.serviceKey).toBe('skillFilter')
    expect(controller.typertRemote.namespace).toBe('skillFilter')
    expect(remoteMethods(controller).map(entry => entry.method)).toEqual([
      'getPersonal', 'setPersonal', 'getProject', 'setProject', 'getEffective',
    ])
  })

  it('reports an absent personal config without creating one', async () => {
    const { controller } = await boot()
    expect(await controller.getPersonal()).toEqual({ exists: false })
  })

  it('reports an absent project config, and a parse error with its message', async () => {
    const { controller } = await boot()
    expect(await controller.getProject({ cwd })).toEqual({ exists: false })
    await mkdir(join(cwd, '.dsh'), { recursive: true })
    await writeFile(join(cwd, '.dsh', 'skill-filter.yaml'), 'deny:\n  - "x"\n', 'utf-8')
    const broken = await controller.getProject({ cwd })
    expect(broken.exists).toBe(false)
    expect(broken.error).toContain('Invalid config')
  })

  it('refuses a config whose allow list is missing or empty', async () => {
    const { controller } = await boot()
    const refused = [{ deny: ['x'] }, { allow: [] }] as unknown as SkillFilterConfigView[]
    for (const config of refused) {
      const failure = await Promise.resolve()
        .then(() => controller.setPersonal(config))
        .catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'skill-filter/rejected',
        details: { reason: '"allow" is required and must not be empty' },
      })
    }
  })

  it('refuses a deny entry that is not a string', async () => {
    const { controller } = await boot()
    const failure = await Promise.resolve()
      .then(() => controller.setPersonal({ allow: ['*'], deny: [1] as unknown as string[] }))
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'skill-filter/rejected',
      details: { reason: '"deny" must be an array of strings' },
    })
  })

  it('persists the personal config as YAML and reads it back', async () => {
    const { controller } = await boot()
    const saved = await controller.setPersonal({ allow: ['git-*'], deny: ['git-rebase'] })
    expect(saved).toEqual({ exists: true, config: { allow: ['git-*'], deny: ['git-rebase'] } })
    expect(await readFile(join(home, 'skill-filter.yaml'), 'utf-8')).toBe(
      'allow:\n  - "git-*"\ndeny:\n  - "git-rebase"\n',
    )
    expect(await controller.getPersonal()).toEqual(saved)
  })

  it('notifies subscribers once per persisted write, and stops after disposal', async () => {
    const { controller } = await boot()
    let personal = 0
    let project = 0
    const stopPersonal = controller.onConfigUpdated(() => { personal += 1 })
    const stopProject = controller.onConfigUpdated(() => { project += 1 })
    stopProject()
    await controller.setPersonal({ allow: ['*'] })
    await controller.setProject({ cwd, config: { allow: ['dsh-*'] } })
    expect(personal).toBe(2)
    expect(project).toBe(0)
    stopPersonal()
    await controller.setPersonal({ allow: ['x'] })
    expect(personal).toBe(2)
  })

  it('does not notify subscribers when the write is refused', async () => {
    const { controller } = await boot()
    let notifications = 0
    controller.onConfigUpdated(() => { notifications += 1 })
    await controller.setPersonal({ allow: [] }).catch(() => undefined)
    expect(notifications).toBe(0)
  })

  it('reports the failing write as a Remote rejection', async () => {
    const { controller } = await boot()
    // A home that is a regular file makes the config directory uncreatable.
    await rm(home, { recursive: true, force: true })
    await writeFile(home, 'not a directory\n', 'utf-8')
    const failure = await Promise.resolve()
      .then(() => controller.setPersonal({ allow: ['*'] }))
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.code).toBe('skill-filter/rejected')
    expect(failure).toBeInstanceOf(RemoteError)
  })

  it('merges personal and project configs with the project winning', async () => {
    const { controller } = await boot()
    expect(await controller.getEffective({ cwd })).toEqual({
      personalExists: false, projectExists: false,
    })

    await controller.setPersonal({ allow: ['*'], deny: ['ue-*'] })
    await controller.setProject({ cwd, config: { allow: ['git-*'] } })
    expect(await controller.getEffective({ cwd })).toEqual({
      personalExists: true,
      projectExists: true,
      config: { allow: ['git-*'] },
    })

    await rm(join(cwd, '.dsh'), { recursive: true, force: true })
    expect(await controller.getEffective({ cwd })).toEqual({
      personalExists: true,
      projectExists: false,
      config: { allow: ['*'], deny: ['ue-*'] },
    })
  })
})
