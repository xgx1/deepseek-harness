/**
 * Whitelist-based skill visibility filter plugin.
 *
 * Wraps a `FileSystemSkillProvider` with personal + project allow/deny rules.
 * Denied skills stay registered (user-invocable via `/name`) but have their
 * `modelInvocable` flag cleared, so the model catalog hides them.
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
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { compileConfig, filterSkill, type RuleSet } from './filter.js'
import { readPersonalConfig, readProjectConfig, mergeConfigs } from './config.js'

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
export class FilteredSkillProvider implements SkillProvider {
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
      const verdict = filterSkill(
        candidate.name,
        rules.projectRules,
        rules.personalRules,
        !
        candidate.invocation.modelInvocable,
      )
      // Denied: keep the candidate (so /name still works) but hide from the model catalog.
      if (!verdict.visible) {
        return this.own({
          ...candidate,
          invocation: { ...candidate.invocation, modelInvocable: false },
        })
      }
      return this.own(candidate)
    })

    return filtered
  }

  async get(
    candidate: SkillCandidate,
    options: SkillLookupOptions,
  ): Promise<SkillDefinition | undefined> {
    // The locator is the inner provider's handle; delegate loading back to it.
    return this.inner.get(candidate, options)
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

  /** Load and compile the merged filter rules for the current context. */
  private async loadRules(cwd: string | undefined): Promise<{
    personalRules: RuleSet | undefined
    projectRules: RuleSet | undefined
  } | undefined> {
    const personal = await readPersonalConfig()
    if (personal.config === undefined) return undefined

    const project = await readProjectConfig(cwd)
    const merged = mergeConfigs(personal.config, project.config)
    if (merged.config === undefined) return undefined

    return {
      personalRules: compileConfig(personal.config),
      projectRules: project.config !== undefined ? compileConfig(project.config) : undefined,
    }
  }
}

/** Re-export the config types for consumers and the settings UI. */
export type { SkillFilterConfig } from './config.js'
