/**
 * Glob-based skill filter engine.
 *
 * Merges three rule sources (skill's own frontmatter deny, personal config, project config).
 * The personal and project layers union: a skill either layer allows is visible, so a
 * project adds to the personal allow list instead of replacing it. The skill's own
 * frontmatter deny is the weakest source: an allow in either config layer overrides it.
 *
 * @module @deepseek-ai/dsh-skill-filter/src/filter
 * @see ADR-0002 (frontmatter merge)
 */

import picomatch from 'picomatch'
import type { SkillFilterConfig } from './config.js'

/** A compiled rule: a matcher over skill names, built from one glob pattern. */
type CompiledRule = (name: string) => boolean

/** A full set of compiled rules for one config layer. */
export interface RuleSet {
  readonly allow: readonly CompiledRule[]
}

/**
 * Compile a list of glob patterns into matchers.
 * A pattern containing no glob metacharacters (`*`, `?`, `**`, `[`, `+`, `(`) matches only itself.
 */
function compilePatterns(patterns: readonly string[]): CompiledRule[] {
  return patterns.map(pattern => picomatch(pattern, { dot: true }))
}

/**
 * Compile a SkillFilterConfig into a RuleSet.
 * @param config - the parsed config layer.
 * @returns the compiled allow matchers.
 */
export function compileConfig(config: SkillFilterConfig): RuleSet {
  return { allow: compilePatterns(config.allow) }
}

/**
 * Evaluate whether a single rule set allows a skill name.
 * @param ruleSet - compiled rules for one config layer.
 * @param name - the skill name to check.
 * @returns 'allow' when any allow rule matches, otherwise 'no-match'.
 */
export function evalRuleSet(ruleSet: RuleSet, name: string): 'allow' | 'no-match' {
  return ruleSet.allow.some(rule => rule(name)) ? 'allow' : 'no-match'
}

/** Full filter result with source tracking for debugging. */
export interface FilterResult {
  readonly visible: boolean
  readonly reason: 'skill-own-deny' | 'personal-allow' | 'project-allow' | 'no-allow-rule'
}

/**
 * Evaluate whether a skill should be model-visible across both config layers.
 *
 * The two layers union: an allow from either layer makes the skill visible. When
 * neither layer allows the name, the reported reason names the skill's own
 * frontmatter deny if it has one, then the whitelist default.
 *
 * @param name - the skill name.
 * @param projectRules - compiled project config rules, or undefined if no project config.
 * @param personalRules - compiled personal config rules, or undefined if no personal config.
 * @param skillOwnDeny - whether the skill's frontmatter has `disable-model-invocation: true`.
 * @returns the filter result.
 */
export function filterSkill(
  name: string,
  projectRules: RuleSet | undefined,
  personalRules: RuleSet | undefined,
  skillOwnDeny: boolean,
): FilterResult {
  // No config at all: frontmatter deny still applies (ADR-0002 backward compat),
  // otherwise the skill is visible.
  if (personalRules === undefined && projectRules === undefined) {
    return skillOwnDeny
      ? { visible: false, reason: 'skill-own-deny' }
      : { visible: true, reason: 'personal-allow' }
  }

  // The layers union: either allow makes the skill visible.
  if (projectRules !== undefined && evalRuleSet(projectRules, name) === 'allow') {
    return { visible: true, reason: 'project-allow' }
  }
  if (personalRules !== undefined && evalRuleSet(personalRules, name) === 'allow') {
    return { visible: true, reason: 'personal-allow' }
  }

  // Skill's own frontmatter deny.
  if (skillOwnDeny) {
    return { visible: false, reason: 'skill-own-deny' }
  }

  // No allow rule matched: the whitelist hides every other skill.
  return { visible: false, reason: 'no-allow-rule' }
}
