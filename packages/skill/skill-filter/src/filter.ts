/**
 * Glob-based skill filter engine.
 *
 * Merges three rule sources (skill's own frontmatter deny, personal config, project config).
 * The personal and project layers union: a skill either layer allows is visible, so a
 * project adds to the personal allow list instead of replacing it. Within a single config,
 * specific skill names override glob patterns. The skill's own frontmatter deny is the
 * weakest source: an allow in either config layer overrides it.
 *
 * A denied skill is NOT removed: its `modelInvocable` flag is cleared so it
 * disappears from the model catalog while remaining user-invocable via `/name`.
 *
 * @module @deepseek-ai/dsh-skill-filter/src/filter
 * @see ADR-0002 (frontmatter merge)
 */

import picomatch from 'picomatch'
import type { SkillFilterConfig } from './config.js'

/**
 * A compiled rule with its specificity level.
 * Specificity: 0 = glob pattern, 1 = specific skill name.
 */
interface CompiledRule {
  readonly matcher: (name: string) => boolean
  readonly isSpecific: boolean
}

/** A full set of compiled rules for one config layer. */
export interface RuleSet {
  readonly allow: readonly CompiledRule[]
  readonly deny: readonly CompiledRule[]
}

/**
 * Compile a list of glob patterns into matchers.
 * A pattern containing no glob metacharacters (`*`, `?`, `**`, `[`, `+`, `(`) is treated as a specific name.
 */
function compilePatterns(patterns: readonly string[]): CompiledRule[] {
  return patterns.map((pattern) => {
    const isSpecific = !/[*?+\[(]/.test(pattern)
    return {
      matcher: picomatch(pattern, { dot: true }),
      isSpecific: isSpecific && pattern.length > 0,
    }
  })
}

/**
 * Compile a SkillFilterConfig into a RuleSet.
 * @param config - the parsed config layer.
 * @returns the compiled allow and deny matchers.
 */
export function compileConfig(config: SkillFilterConfig): RuleSet {
  return {
    allow: compilePatterns(config.allow),
    deny: compilePatterns(config.deny ?? []),
  }
}

/**
 * Evaluate whether a single rule set allows or denies a skill name.
 *
 * Within one rule set:
 * - If both allow and deny match, the specific name wins over the glob.
 * - If only one matches, that match wins.
 * - If neither matches, falls through to the next layer.
 *
 * @param ruleSet - compiled rules for one config layer.
 * @param name - the skill name to check.
 * @returns 'allow' | 'deny' | 'no-match'
 */
export function evalRuleSet(ruleSet: RuleSet, name: string): 'allow' | 'deny' | 'no-match' {
  let allowSpecific = false
  let allowMatched = false
  for (const rule of ruleSet.allow) {
    if (rule.matcher(name)) {
      allowMatched = true
      allowSpecific = rule.isSpecific
      break
    }
  }

  let denySpecific = false
  let denyMatched = false
  for (const rule of ruleSet.deny) {
    if (rule.matcher(name)) {
      denyMatched = true
      denySpecific = rule.isSpecific
      break
    }
  }

  if (!allowMatched && !denyMatched) return 'no-match'
  if (allowMatched && !denyMatched) return 'allow'
  if (!allowMatched && denyMatched) return 'deny'

  // Both match: specific wins over glob; tie goes to deny (conservative).
  if (allowSpecific && !denySpecific) return 'allow'
  return 'deny'
}

/** Full filter result with source tracking for debugging. */
export interface FilterResult {
  readonly visible: boolean
  readonly reason: 'skill-own-deny' | 'personal-deny' | 'project-deny' | 'personal-allow' | 'project-allow' | 'no-allow-rule'
}

/**
 * Evaluate whether a skill should be model-visible across both config layers.
 *
 * The two layers union: an allow from either layer makes the skill visible, and a
 * deny in one layer cannot veto an allow in the other. When neither layer allows
 * the name, the reported reason names the layer that denied it, then the skill's
 * own frontmatter deny, then the whitelist default.
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
  const projectVerdict = projectRules === undefined ? 'no-match' : evalRuleSet(projectRules, name)
  const personalVerdict = personalRules === undefined ? 'no-match' : evalRuleSet(personalRules, name)
  if (projectVerdict === 'allow') return { visible: true, reason: 'project-allow' }
  if (personalVerdict === 'allow') return { visible: true, reason: 'personal-allow' }

  // Neither layer allows: report the denial for debugging.
  if (projectVerdict === 'deny') return { visible: false, reason: 'project-deny' }
  if (personalVerdict === 'deny') return { visible: false, reason: 'personal-deny' }

  // Skill's own frontmatter deny.
  if (skillOwnDeny) {
    return { visible: false, reason: 'skill-own-deny' }
  }

  // No rules matched: whitelist model means deny by default.
  return { visible: false, reason: 'no-allow-rule' }
}
