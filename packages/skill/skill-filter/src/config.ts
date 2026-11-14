/**
 * YAML configuration reader for skill filter rules.
 *
 * Reads personal (`$DSH_HOME/skill-filter.yaml`) and project (`<cwd>/.dsh/skill-filter.yaml`)
 * configs, merges them as the union of both layers' allow patterns, and caches
 * the last valid parse to survive transient YAML corruption.
 *
 * @module @deepseek-ai/dsh-skill-filter/src/config
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Parsed skill filter configuration. */
export interface SkillFilterConfig {
  /** Glob patterns that allow skills to be visible. Required. */
  readonly allow: readonly string[]
}

/** One config layer with its parse status. */
export interface ConfigLayer {
  readonly config: SkillFilterConfig | undefined
  readonly error: Error | undefined
}

/** Merge result: the union of both layers. */
export interface MergedFilterConfig {
  /** Whether the personal config exists. */
  readonly personalExists: boolean
  /** Whether the project config exists. */
  readonly projectExists: boolean
  /** The merged effective config, or undefined when neither layer exists. */
  readonly config: SkillFilterConfig | undefined
}

const PROJECT_CONFIG_DIR = '.dsh'
const PROJECT_CONFIG_FILE = 'skill-filter.yaml'
const CACHE_FILE = '.skill-filter-cache.json'

/** Absolute path to the personal config file.
 * @returns the absolute path of `$DSH_HOME/skill-filter.yaml`.
 */
export function personalConfigPath(): string {
  return dshHomePath('skill-filter.yaml')
}

/** Absolute path to the last-valid personal config cache. */
function personalCachePath(): string {
  return dshHomePath(CACHE_FILE)
}

/**
 * Read and parse a single YAML filter config file.
 * @param filePath - absolute path to the YAML file.
 * @returns parsed config, or undefined if the file is missing.
 * @throws if the file exists but contains invalid YAML, a missing `allow` field, or a removed `deny` key.
 */
export async function readConfigFile(filePath: string): Promise<SkillFilterConfig | undefined> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }

  const parsed = parseYaml(raw) as Record<string, unknown> | null
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Invalid config at ${filePath}: expected a YAML object`)
  }

  const allow = parsed.allow
  if (!Array.isArray(allow) || allow.some(entry => typeof entry !== 'string')) {
    throw new Error(`Invalid config at ${filePath}: "allow" is required and must be an array of strings`)
  }

  // The filter is an allow list only; a leftover deny key is an error rather
  // than a silently ignored entry, so the file says what actually applies.
  if (parsed.deny !== undefined) {
    throw new Error(`Invalid config at ${filePath}: "deny" was removed — every skill outside "allow" is already hidden`)
  }

  return { allow: allow as readonly string[] }
}

/**
 * Read the personal (user-level) filter config, falling back to the last valid cache.
 * @returns parsed config (or cached fallback), plus any parse error.
 */
export async function readPersonalConfig(): Promise<ConfigLayer> {
  const filePath = personalConfigPath()
  try {
    const config = await readConfigFile(filePath)
    if (config !== undefined) {
      // Fresh parse succeeded: refresh the fallback cache.
      await writePersonalCache(config)
    }
    return { config, error: undefined }
  } catch (error) {
    const cached = await readCache()
    return { config: cached, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

/**
 * Read the project-level filter config for a given working directory.
 * @param cwd - the working directory of the current project.
 * @returns parsed config (no cache fallback), plus any parse error.
 */
export async function readProjectConfig(cwd: string | undefined): Promise<ConfigLayer> {
  if (cwd === undefined) return { config: undefined, error: undefined }
  try {
    const config = await readConfigFile(join(cwd, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE))
    return { config, error: undefined }
  } catch (error) {
    return { config: undefined, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

/**
 * Merge personal and project configs into the effective rule set.
 *
 * The layers union: the effective allow list carries every pattern either layer
 * allows. A project therefore adds to the personal rules instead of replacing
 * them, and either layer alone still filters.
 *
 * @param personal - the personal config, or undefined.
 * @param project - the project config, or undefined.
 * @returns the merged effective config and metadata; `config` is undefined only when neither layer exists.
 */
export function mergeConfigs(
  personal: SkillFilterConfig | undefined,
  project: SkillFilterConfig | undefined,
): MergedFilterConfig {
  if (personal === undefined && project === undefined) {
    return { personalExists: false, projectExists: false, config: undefined }
  }
  const allow = [...new Set([...(personal?.allow ?? []), ...(project?.allow ?? [])])]
  return {
    personalExists: personal !== undefined,
    projectExists: project !== undefined,
    config: { allow },
  }
}

/**
 * Persist the personal config as the last-valid fallback cache.
 * @param config - the successfully parsed config to cache.
 */
export async function writePersonalCache(config: SkillFilterConfig): Promise<void> {
  try {
    const cachePath = personalCachePath()
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify(config), 'utf-8')
  } catch {
    // Cache write failure is non-fatal; the primary file is still readable.
  }
}

/**
 * Read the cached personal config as a fallback.
 * @returns the last successfully cached config, or undefined.
 */
export async function readCache(): Promise<SkillFilterConfig | undefined> {
  try {
    return JSON.parse(await readFile(personalCachePath(), 'utf-8')) as SkillFilterConfig
  } catch {
    return undefined
  }
}

/**
 * Serialize a config to YAML and atomically replace the target file.
 * @param filePath - absolute path of the YAML file to write.
 * @param config - the config to persist.
 */
export async function writeConfigFile(filePath: string, config: SkillFilterConfig): Promise<void> {
  const lines = ['allow:']
  for (const pattern of config.allow) lines.push(`  - "${pattern}"`)
  const body = lines.join('\n') + '\n'
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, body, 'utf-8')
}

/**
 * Persist the personal config to its YAML file and refresh the fallback cache.
 * @param config - the config to persist.
 */
export async function writePersonalConfig(config: SkillFilterConfig): Promise<void> {
  await writeConfigFile(personalConfigPath(), config)
  await writePersonalCache(config)
}

/**
 * Persist the project config for a working directory to its YAML file.
 * @param cwd - the working directory of the project.
 * @param config - the config to persist.
 */
export async function writeProjectConfig(cwd: string, config: SkillFilterConfig): Promise<void> {
  await writeConfigFile(join(cwd, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE), config)
}
