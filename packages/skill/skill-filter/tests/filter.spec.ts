/**
 * Unit tests for the skill filter engine and config merge.
 */

import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compileConfig, evalRuleSet, filterSkill } from '../src/filter.js'
import { readConfigFile, mergeConfigs } from '../src/config.js'
import type { SkillFilterConfig } from '../src/config.js'

describe('compileConfig', () => {
  it('compiles glob patterns to matchers', () => {
    const rules = compileConfig({ allow: ['dotnet-*'] })
    expect(rules.allow.length).toBe(1)
    expect(rules.allow[0]?.('dotnet-architecture')).toBe(true)
    expect(rules.allow[0]?.('unreal-ai-navigation')).toBe(false)
  })

  it('matches a pattern without glob metacharacters against itself only', () => {
    const rules = compileConfig({ allow: ['teach'] })
    expect(rules.allow[0]?.('teach')).toBe(true)
    expect(rules.allow[0]?.('teach-advanced')).toBe(false)
  })

  it('compiles empty allow list to empty rule set', () => {
    const rules = compileConfig({ allow: [] })
    expect(rules.allow.length).toBe(0)
  })
})

describe('evalRuleSet', () => {
  it('returns allow when an allow rule matches', () => {
    const rules = compileConfig({ allow: ['dotnet-*'] })
    expect(evalRuleSet(rules, 'dotnet-architecture')).toBe('allow')
  })

  it('returns no-match when no allow rule matches', () => {
    const rules = compileConfig({ allow: ['dotnet-*'] })
    expect(evalRuleSet(rules, 'unreal-ai-navigation')).toBe('no-match')
  })
})

describe('filterSkill', () => {
  it('returns visible when no config exists at all', () => {
    expect(filterSkill('any-skill', undefined, undefined, false).visible).toBe(true)
  })

  it('returns hidden when no allow rule matches (whitelist model)', () => {
    const rules = compileConfig({ allow: ['self-*'] })
    const result = filterSkill('dotnet-architecture', undefined, rules, false)
    expect(result.visible).toBe(false)
    expect(result.reason).toBe('no-allow-rule')
  })

  it('returns visible when allow rule matches', () => {
    const rules = compileConfig({ allow: ['dotnet-*'] })
    const result = filterSkill('dotnet-architecture', undefined, rules, false)
    expect(result.visible).toBe(true)
    expect(result.reason).toBe('personal-allow')
  })

  it('skill-own deny hides when no config overrides it', () => {
    const result = filterSkill('some-skill', undefined, undefined, true)
    expect(result.visible).toBe(false)
    expect(result.reason).toBe('skill-own-deny')
  })

  it('personal allow overrides skill-own deny (ADR-0002)', () => {
    const rules = compileConfig({ allow: ['some-skill'] })
    const result = filterSkill('some-skill', undefined, rules, true)
    expect(result.visible).toBe(true)
    expect(result.reason).toBe('personal-allow')
  })

  it('project allow overrides skill-own deny (ADR-0002)', () => {
    const projectRules = compileConfig({ allow: ['some-skill'] })
    const result = filterSkill('some-skill', projectRules, undefined, true)
    expect(result.visible).toBe(true)
    expect(result.reason).toBe('project-allow')
  })

  it('personal allow survives a project list that does not match (the layers union)', () => {
    const personalRules = compileConfig({ allow: ['dotnet-*'] })
    const projectRules = compileConfig({ allow: ['git-*'] })
    const result = filterSkill('dotnet-architecture', projectRules, personalRules, false)
    expect(result.visible).toBe(true)
    expect(result.reason).toBe('personal-allow')
  })

  it('project allow makes a name visible when the personal list does not match', () => {
    const personalRules = compileConfig({ allow: ['self-*'] })
    const projectRules = compileConfig({ allow: ['dotnet-*'] })
    const result = filterSkill('dotnet-architecture', projectRules, personalRules, false)
    expect(result.visible).toBe(true)
    expect(result.reason).toBe('project-allow')
  })

  it('new skill auto-matches existing allow glob', () => {
    const rules = compileConfig({ allow: ['self-*'] })
    expect(filterSkill('self-new-feature', undefined, rules, false).visible).toBe(true)
  })

  it('new skill without matching allow glob is hidden', () => {
    const rules = compileConfig({ allow: ['self-*', 'mattpocock-*'] })
    expect(filterSkill('unreal-new-skill', undefined, rules, false).visible).toBe(false)
  })

  it('filters on the project layer alone when no personal config exists', () => {
    const projectRules = compileConfig({ allow: ['self-*'] })
    const visible = filterSkill('self-new-feature', projectRules, undefined, false)
    expect(visible.visible).toBe(true)
    expect(visible.reason).toBe('project-allow')
    expect(filterSkill('dotnet-architecture', projectRules, undefined, false).visible).toBe(false)
  })

  it('hides a name no layer allows, naming the whitelist default', () => {
    const personalRules = compileConfig({ allow: ['self-*'] })
    const projectRules = compileConfig({ allow: ['git-*'] })
    const result = filterSkill('dotnet-architecture', projectRules, personalRules, false)
    expect(result.visible).toBe(false)
    expect(result.reason).toBe('no-allow-rule')
  })
})

describe('readConfigFile', () => {
  it('returns undefined for a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-filter-'))
    try {
      expect(await readConfigFile(join(dir, 'nope.yaml'))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('parses an allow-only config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-filter-'))
    try {
      const file = join(dir, 'config.yaml')
      await writeFile(file, 'allow:\n  - "self-*"\n', 'utf-8')
      const config = await readConfigFile(file)
      expect(config).toEqual({ allow: ['self-*'] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws on a removed deny key instead of ignoring it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-filter-'))
    try {
      const file = join(dir, 'config.yaml')
      await writeFile(file, 'allow:\n  - "self-*"\ndeny:\n  - "dotnet-*"\n', 'utf-8')
      await expect(readConfigFile(file)).rejects.toThrow(/"deny" was removed/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws when allow is missing (allow required)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-filter-'))
    try {
      const file = join(dir, 'config.yaml')
      await writeFile(file, 'deny:\n  - "dotnet-*"\n', 'utf-8')
      await expect(readConfigFile(file)).rejects.toThrow(/allow/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws when allow is not an array of strings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-filter-'))
    try {
      const file = join(dir, 'config.yaml')
      await writeFile(file, 'allow: "self-*"\n', 'utf-8')
      await expect(readConfigFile(file)).rejects.toThrow(/allow/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('mergeConfigs', () => {
  it('no filtering when neither config exists', () => {
    const merged = mergeConfigs(undefined, undefined)
    expect(merged.config).toBeUndefined()
    expect(merged.personalExists).toBe(false)
    expect(merged.projectExists).toBe(false)
  })

  it('unions both layers when present', () => {
    const personal: SkillFilterConfig = { allow: ['self-*'] }
    const project: SkillFilterConfig = { allow: ['git-*'] }
    const merged = mergeConfigs(personal, project)
    expect(merged.config).toEqual({ allow: ['self-*', 'git-*'] })
    expect(merged.personalExists).toBe(true)
    expect(merged.projectExists).toBe(true)
  })

  it('filters on the project layer alone when personal config is missing', () => {
    const project: SkillFilterConfig = { allow: ['self-*'] }
    const merged = mergeConfigs(undefined, project)
    expect(merged.config).toEqual(project)
    expect(merged.personalExists).toBe(false)
    expect(merged.projectExists).toBe(true)
  })

  it('personal is used when project is missing', () => {
    const personal: SkillFilterConfig = { allow: ['self-*'] }
    const merged = mergeConfigs(personal, undefined)
    expect(merged.config).toEqual(personal)
    expect(merged.projectExists).toBe(false)
  })
})
