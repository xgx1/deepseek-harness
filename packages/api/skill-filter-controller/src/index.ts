/**
 * Host Remote owner for the skill-filter configuration surfaces.
 *
 * Reads and writes the personal and project YAML configs through the same
 * functions the provider plugin reads them with, and publishes a
 * config-change notification that the provider subscribes to for catalog
 * invalidation. The notification is a plain listener registration, not a
 * `@Remote` method: it ships on the wire to no consumer.
 *
 * @module @deepseek-ai/dsh-api-skill-filter-controller
 * @see ADR-0001 (whitelist model), ADR-0002 (frontmatter merge)
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  readPersonalConfig, readProjectConfig, writePersonalConfig, writeProjectConfig,
} from '@deepseek-ai/dsh-skill-filter/config'
import type { SkillFilterConfig } from '@deepseek-ai/dsh-skill-filter/config'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SkillFilterConfigRequest, SkillFilterConfigView, SkillFilterConfigWrite, SkillFilterEffectiveView,
  SkillFilterPersonalView, SkillFilterProjectView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `skillFilter` Remote namespace. */
    skillFilter: SkillFilterRemote
  }
}

/** Listener invoked after a config write is persisted. */
type ConfigListener = () => void

/** Host service backing the generated `ctx.remote.skillFilter` namespace. */
export class SkillFilterRemote extends TypertRemoteService {
  static inject = ['typert']

  private readonly listeners = new Set<ConfigListener>()

  /** @param ctx - Host context carrying the Typert Gateway binding. */
  constructor(ctx: Context) {
    super(ctx, 'skillFilter', { namespace: 'skillFilter' })
  }

  /**
   * Subscribe to persisted config writes.
   * @param listener - invoked once per successful write, without arguments.
   * @returns disposer removing the listener.
   */
  onConfigUpdated(listener: ConfigListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Read the personal (user-level) filter config.
   * @returns the parsed config, or `exists: false` when the file is absent.
   */
  @Remote
  async getPersonal(): Promise<SkillFilterPersonalView> {
    const layer = await readPersonalConfig()
    return {
      exists: layer.config !== undefined,
      ...layer.error === undefined ? {} : { error: layer.error.message },
      ...layer.config === undefined ? {} : { config: configView(layer.config) },
    }
  }

  /**
   * Replace the personal (user-level) filter config.
   * @param config - the complete replacement; `allow` is required, `deny` optional.
   * @returns the persisted config as re-read from disk.
   * @throws RemoteError `skill-filter/rejected` when the config is invalid or unwritable.
   */
  @Remote
  async setPersonal(config: SkillFilterConfigView): Promise<SkillFilterPersonalView> {
    const validated = await this.write(() => writePersonalConfig(config), config)
    return { exists: true, config: configView(validated) }
  }

  /**
   * Read the project filter config for one working directory.
   * @param request - the project working directory.
   * @returns the parsed config, or `exists: false` when the file is absent.
   */
  @Remote
  async getProject(request: SkillFilterConfigRequest): Promise<SkillFilterProjectView> {
    const layer = await readProjectConfig(request.cwd)
    return {
      exists: layer.config !== undefined,
      ...layer.error === undefined ? {} : { error: layer.error.message },
      ...layer.config === undefined ? {} : { config: configView(layer.config) },
    }
  }

  /**
   * Replace the project filter config for one working directory.
   * @param write - the working directory and the complete replacement config.
   * @returns the persisted config as re-read from disk.
   * @throws RemoteError `skill-filter/rejected` when the config is invalid or unwritable.
   */
  @Remote
  async setProject(write: SkillFilterConfigWrite): Promise<SkillFilterProjectView> {
    const validated = await this.write(
      () => writeProjectConfig(write.cwd, write.config),
      write.config,
    )
    return { exists: true, config: configView(validated) }
  }

  /**
   * Read the merged effective config for one working directory.
   * @param request - the project working directory.
   * @returns which layers exist and the merged config; `config` is undefined only when no personal config exists.
   */
  @Remote
  async getEffective(request: SkillFilterConfigRequest): Promise<SkillFilterEffectiveView> {
    const [personal, project] = await Promise.all([
      readPersonalConfig(),
      readProjectConfig(request.cwd),
    ])
    return effectiveView(
      personal.config !== undefined,
      project.config !== undefined,
      project.config ?? personal.config,
    )
  }

  /**
   * Persist one config layer, then notify subscribers.
   * @param write - the persisting call.
   * @param config - the config the write receives.
   * @returns the config as persisted.
   * @throws RemoteError `skill-filter/rejected` when validation or the write fails.
   */
  private async write(
    write: () => Promise<void>,
    config: SkillFilterConfigView,
  ): Promise<SkillFilterConfig> {
    const reason = rejectionOf(config)
    if (reason !== undefined) throw new RemoteError('skill-filter/rejected', reason, { reason })
    try {
      await write()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RemoteError('skill-filter/rejected', message, { reason: message })
    }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error: unknown) {
        this.ctx.logger.warn(`skill-filter config listener failed: ${String(error)}`)
      }
    }
    return { allow: [...config.allow], ...config.deny === undefined ? {} : { deny: [...config.deny] } }
  }
}

/** Validate the wire config against the file format's requirements. */
function rejectionOf(config: SkillFilterConfigView): string | undefined {
  if (!Array.isArray(config.allow) || config.allow.length === 0) {
    return '"allow" is required and must not be empty'
  }
  if (config.allow.some(pattern => typeof pattern !== 'string' || pattern.length === 0)) {
    return '"allow" must contain non-empty strings'
  }
  if (config.deny !== undefined) {
    if (!Array.isArray(config.deny) || config.deny.some(pattern => typeof pattern !== 'string')) {
      return '"deny" must be an array of strings'
    }
  }
  return undefined
}

/** Project one parsed config onto its wire view. */
function configView(config: SkillFilterConfig): SkillFilterConfigView {
  return {
    allow: [...config.allow],
    ...config.deny === undefined ? {} : { deny: [...config.deny] },
  }
}

/** Project the merge result onto its wire view. */
function effectiveView(
  personalExists: boolean,
  projectExists: boolean,
  config: SkillFilterConfig | undefined,
): SkillFilterEffectiveView {
  return {
    personalExists,
    projectExists,
    ...config === undefined ? {} : { config: configView(config) },
  }
}

export default SkillFilterRemote
