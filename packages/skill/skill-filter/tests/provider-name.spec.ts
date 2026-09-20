/**
 * Regression: `ctx.skills` validates every candidate's `provider` against the
 * registered provider name. The wrapper must hand the inner filesystem
 * provider its own name, or the whole catalog throws
 * `skill provider "skill-filter" returned skill "..." for provider "filesystem"`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

let home: string

/** Build an isolated home so the personal `~/.dsh/skill-filter.yaml` is absent. */
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'skill-filter-home-'))
  mkdirSync(join(home, '.dsh'), { recursive: true })
  vi.stubEnv('HOME', home)
  vi.stubEnv('DSH_HOME', join(home, '.dsh'))
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

describe('FilteredSkillProvider provider identity', () => {
  it('stamps discovered candidates with the registered provider name', async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), 'skill-filter-dir-'))
    try {
      mkdirSync(join(skillsDir, 'add-software-feature'))
      writeFileSync(
        join(skillsDir, 'add-software-feature', 'SKILL.md'),
        '---\nname: add-software-feature\ndescription: Regression fixture skill.\n---\nBody.\n',
      )
      vi.resetModules()
      const SkillRegistry = (await import('@deepseek-ai/dsh-skill')).default
      const skillFilter = await import('../src/index.js')
      const ctx = new Context()
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(skillFilter, { customSkillDirs: [skillsDir], watch: false })
      const skills = await ctx.skills.list({})
      const skill = skills.find(entry => entry.name === 'add-software-feature')
      expect(skill?.provider).toBe('skill-filter')
    } finally {
      rmSync(skillsDir, { recursive: true, force: true })
    }
  })
})
