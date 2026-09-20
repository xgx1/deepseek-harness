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
    expect(rules.allow[0]?.matcher('dotnet-architecture')).toBe(true)
    expect(rules.allow[0]?.matcher('unreal-ai-navigation')).toBe(false)
  })

  it('treats patterns without glob metacharacters as specific names', () => {
    const rules = compileConfig({ allow: ['teach'] })
    expect(rules.allow[0]?.isSpecific).toBe(true)
    expect(rules.allow[0]?.matcher('teach')).toBe(true)
    expect(rules.allow[0]?.matcher('teach-advanced')).toBe(false)
  })

  it('compiles empty allow list to empty rule set', () => {
    const rules = compileConfig({ allow: [] })
    expect(rules.allow.length).toBe(0)
  })
})

describe('evalRuleSet', () => {
  it('returns allow when only allow matches', () => {
    const rules = compileConfig({ allow: ['dotnet-*'] })
    expect(evalRuleSet(rules, 'dotnet-architecture')).toBe('allow')
  })

  it('returns deny when only deny matches', () => {
    const rules = compileConfig({ allow: ['dotnet-*'], deny: ['unreal-*'] })
    expect(evalRuleSet(rules, 'unreal-ai-navigation')).toBe('deny')
  })

  it('returns no-match when neither matches', () => {
    const rules = compileConfig({ allow: ['dotnet-*'], deny: ['unreal-*'] })
    expect(evalRuleSet(rules, 'self-dsh')).toBe('no-match')
  })

  it('specific deny wins over glob allow', () => {
    const rules = compileConfig({ allow: ['dotnet-*'], deny: ['dotnet-architecture'] })
    expect(evalRuleSet(rules, 'dotnet-architecture')).toBe('deny')
  })

  it('specific allow wins over glob deny', () => {
    const rules = compileConfig({ allow: ['dotnet-architecture'], deny: ['dotnet-*'] })
    expect(evalRuleSet(rules, 'dotnet-architecture')).toBe('allow')
  })

  it('glob tie resolves to deny (conservative)', () => {
    const rules = compileConfig({ allow: ['*'], deny: ['dotnet-*'] })
    expect(evalRuleSet(rules, 'dotnet-architecture')).toBe('deny')
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

  it('project deny overrides personal allow', () => {
    const personalRules = compileConfig({ allow: ['dotnet-*'] })
    const projectRules = compileConfig({ allow: [], deny: ['dotnet-*'] })
    const result = filterSkill('dotnet-architecture', projectRules, personalRules, false)
    expect(result.visible).toBe(false)
    expect(result.reason).toBe('project-deny')
  })

  it('project allow overrides personal deny', () => {
    const personalRules = compileConfig({ allow: [], deny: ['dotnet-*'] })
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

  it('parses a valid config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-filter-'))
    try {
      const file = join(dir, 'config.yaml')
      await writeFile(file, 'allow:\n  - "self-*"\ndeny:\n  - "dotnet-*"\n', 'utf-8')
      const config = await readConfigFile(file)
      expect(config).toEqual({ allow: ['self-*'], deny: ['dotnet-*'] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('accepts allow without deny', async () => {
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

  it('throws when allow is missing (Q12: allow required)', async () => {
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
  it('no filtering when personal config is missing', () => {
    const merged = mergeConfigs(undefined, undefined)
    expect(merged.config).toBeUndefined()
    expect(merged.personalExists).toBe(false)
  })

  it('project replaces personal when present', () => {
    const personal: SkillFilterConfig = { allow: ['*'] }
    const project: SkillFilterConfig = { allow: [], deny: ['dotnet-*'] }
    const merged = mergeConfigs(personal, project)
    expect(merged.config).toEqual(project)
  })

  it('personal is used when project is missing', () => {
    const personal: SkillFilterConfig = { allow: ['self-*'] }
    const merged = mergeConfigs(personal, undefined)
    expect(merged.config).toEqual(personal)
    expect(merged.projectExists).toBe(false)
  })
})
