/**
 * Whitelist-based skill visibility filter plugin.
 *
 * Wraps a `FileSystemSkillProvider` with personal + project allow rules, so the
 * allow lists are the whole catalogue: a skill no layer allows is hidden.
 * The verdict is one gate for both surfaces: a hidden skill has BOTH invocation
 * flags cleared, so it leaves the model catalog, leaves the `/name` gesture, and
 * is never injected as instructions context. An allowed skill restores
 * `modelInvocable` even when its own frontmatter denied it (ADR-0002).
 *
 * The wrapped provider's candidates carry this plugin's own provider name, so
 * the registry resolves loads back to this provider (`get()` delegates to the
 * inner filesystem provider).
 *
 * @module @deepseek-ai/dsh-skill-filter
 * @see ADR-0001 (whitelist model), ADR-0002 (frontmatter merge)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
  SkillSource,
} from '@deepseek-ai/dsh-skill'
import { compileConfig, filterSkill, type RuleSet } from './filter.js'
import { readPersonalConfig, readProjectConfig } from './config.js'

export const name = 'skill-filter'
export const inject = ['skills']

/** Skill filter plugin configuration. */
export interface Config {
  /** Provider name registered in `ctx.skills`. Defaults to `skill-filter`. */
  readonly providerName?: string
  /** Additional custom skill directories (forwarded to the internal FileSystemSkillProvider). */
  readonly customSkillDirs?: string[]
  /** Whether host-local skill roots are watched for catalog changes. */
  readonly watch?: boolean
}

export const Config: Schema<Config> = z.object({
  providerName: z.string().min(1).default('skill-filter'),
  customSkillDirs: z.array(z.string()).default([]),
  watch: z.boolean().default(true),
})

/**
 * The host-plane config owner this plugin subscribes to, read through the
 * shared service store. Declared structurally here so the preset-plane plugin
 * needs no project reference on the Remote owner package.
 */
interface SkillFilterConfigOwner {
  onConfigUpdated(listener: () => void): () => void
}

/** Plugin entry: register the filtered provider and dispose it with the fiber. */
export function apply(ctx: Context, config: Config = {}): void {
  const providerName = config.providerName ?? 'skill-filter'
  let provider: FilteredSkillProvider | undefined

  ctx.skills.registerProvider((control) => {
    const inner = new FileSystemSkillProvider(ctx, control, {
      includeDefaultRoots: true,
      customSkillDirs: [...(config.customSkillDirs ?? [])],
      watch: config.watch ?? true,
    })
    provider = new FilteredSkillProvider(inner, control, providerName)
    return provider
  })

  // A config write through the Remote must invalidate the registry's completed
  // catalogs, or the next catalog read keeps the rules loaded when the file
  // changed. The Remote owner is host-plane and this plugin runs in a preset
  // fiber, so the subscription reads the owner service through the shared
  // store instead of a context event.
  const owner = ctx.get('skillFilter') as SkillFilterConfigOwner | undefined
  ctx.effect(function* () {
    if (owner === undefined) return
    yield owner.onConfigUpdated(() => {
      provider?.control.invalidate()
    })
  }, 'skill-filter config invalidation')

  ctx.effect(function* () {
    yield async () => {
      await provider?.dispose()
    }
  }, 'skill-filter lifecycle')
}

/**
 * SkillProvider that wraps an internal filesystem provider with whitelist filtering.
 */
class FilteredSkillProvider implements SkillProvider {
  readonly name: string
  /** This registration's lifecycle and invalidation capability. */
  readonly control: SkillProviderControl

  constructor(
    private readonly inner: FileSystemSkillProvider,
    control: SkillProviderControl,
    name: string,
  ) {
    this.name = name
    this.control = control
  }

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    const result = await this.inner.list(options)
    const candidates: readonly SkillCandidate[] = Array.isArray(result) ? result : result.candidates
    const complete = Array.isArray(result) ? true : result.complete

    // Incomplete discovery: return unfiltered to avoid data loss.
    if (!complete) {
      return { candidates: candidates.map(candidate => this.own(candidate)), complete }
    }

    const rules = await this.loadRules(options.cwd)

    // No personal config: no filtering applied, but candidates must still carry this provider's name.
    if (rules === undefined) {
      return candidates.map(candidate => this.own(candidate))
    }

    const filtered = candidates.map((candidate) => {
      // A skill the project itself ships under .dsh/skills or .agents/skills is
      // part of the project, not part of the user's global collection: it is
      // always in force, so the whitelist never governs it.
      if (isProjectLocal(candidate.source)) return this.own(candidate)
      const verdict = filterSkill(
        candidate.name,
        rules.projectRules,
        rules.personalRules,
        !
        candidate.invocation.modelInvocable,
      )
      const invocation = verdictPolicy(verdict.visible, candidate.invocation)
      if (invocation === candidate.invocation) return this.own(candidate)
      return this.own({ ...candidate, invocation })
    })

    return filtered
  }

  async get(
    candidate: SkillCandidate,
    options: SkillLookupOptions,
  ): Promise<SkillDefinition | undefined> {
    // The locator is the inner provider's handle; delegate loading back to it.
    const definition = await this.inner.get(candidate, options)
    if (definition === undefined) return undefined
    if (isProjectLocal(definition.source)) return definition
    // The inner definition carries the frontmatter policy, so a load would
    // bypass the verdict list() published unless it is applied here too — this
    // is the single lookup that decides what a /name gesture injects.
    const rules = await this.loadRules(options.cwd)
    if (rules === undefined) return definition
    const verdict = filterSkill(
      definition.name,
      rules.projectRules,
      rules.personalRules,
      !definition.invocation.modelInvocable,
    )
    const invocation = verdictPolicy(verdict.visible, definition.invocation)
    if (invocation === definition.invocation) return definition
    return { ...definition, invocation }
  }

  /** Dispose the internal watcher-managed provider. */
  async dispose(): Promise<void> {
    await this.inner.dispose()
  }

  /**
   * Rebrand a candidate so the registry resolves it to THIS provider.
   * The inner filesystem provider stamps `provider: 'filesystem'`; a mismatch
   * would route loads to the wrong provider instance.
   */
  private own(candidate: SkillCandidate): SkillCandidate {
    return candidate.provider === this.name ? candidate : { ...candidate, provider: this.name }
  }

  /** Load and compile the filter rules for the current context. */
  private async loadRules(cwd: string | undefined): Promise<{
    personalRules: RuleSet | undefined
    projectRules: RuleSet | undefined
  } | undefined> {
    const personal = await readPersonalConfig()
    const project = await readProjectConfig(cwd)
    const personalRules = personal.config === undefined ? undefined : compileConfig(personal.config)
    const projectRules = project.config === undefined ? undefined : compileConfig(project.config)
    // No config layer at all: no filtering, and every skill keeps the visibility
    // its own frontmatter declares.
    if (personalRules === undefined && projectRules === undefined) return undefined
    return { personalRules, projectRules }
  }
}

/**
 * Whether a discovery source belongs to the current project rather than to the
 * user's global collection. Project skills ride along with the project, so the
 * filter leaves them alone; everything else (user-dsh, user-agents, custom,
 * bundled) is what the whitelist governs.
 * @param source - the candidate's or definition's discovery source.
 * @returns true for skills shipped under the project's own skill roots.
 */
function isProjectLocal(source: SkillSource): boolean {
  return source === 'project-dsh' || source === 'project-agents'
}

/**
 * Project one verdict onto a skill's invocation policy.
 * A hidden verdict clears both flags, so no surface may advertise or load the skill. An
 * allow restores `modelInvocable` (a config allow overrides the skill's own
 * frontmatter deny, ADR-0002) and leaves `userInvocable` as the frontmatter
 * declared it, so the filter never grants an invocation the skill withheld.
 * @param visible - whether the merged rules allow the skill.
 * @param policy - the skill's own frontmatter policy.
 * @returns the same object when the verdict changes nothing.
 */
function verdictPolicy(
  visible: boolean,
  policy: SkillInvocationPolicy,
): SkillInvocationPolicy {
  if (visible) {
    return policy.modelInvocable ? policy : { ...policy, modelInvocable: true }
  }
  return policy.modelInvocable || policy.userInvocable
    ? { ...policy, modelInvocable: false, userInvocable: false }
    : policy
}

/** Re-export the config types for consumers and the settings UI. */
export type { SkillFilterConfig } from './config.js'
