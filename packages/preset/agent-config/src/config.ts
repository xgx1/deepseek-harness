/**
 * Reader, validator, and resolver for `$DSH_HOME/agent-configs.yaml`.
 *
 * One named configuration bundles the skill allow globs and the MCP server
 * names a session may use. `projects` maps a project working directory to the
 * configurations it selects, so a project owns one default selection and every
 * session started there resolves the same document. The skill filter and the
 * MCP tool gate both read through this module, keeping one file authoritative.
 *
 * @module @deepseek-ai/dsh-agent-config/src/config
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** One named configuration. */
export interface AgentConfiguration {
  /** Glob patterns that make a skill model-visible to a session selecting this configuration. */
  readonly skills: readonly string[]
  /** MCP `serverName` values a session selecting this configuration may call. */
  readonly mcp: readonly string[]
}

/** The whole document: the definitions plus every project's selection. */
export interface AgentConfigsDocument {
  /** Configuration name to its definition. */
  readonly configs: Readonly<Record<string, AgentConfiguration>>
  /** Absolute project working directory to the configuration names it selects. */
  readonly projects: Readonly<Record<string, readonly string[]>>
}

/** Document used when nothing has been configured yet. */
export const EMPTY_DOCUMENT: AgentConfigsDocument = { configs: {}, projects: {} }

const DOCUMENT_FILE = 'agent-configs.yaml'
const TOP_LEVEL_KEYS = ['configs', 'projects']

/** Absolute path to the document.
 * @returns the absolute path of `$DSH_HOME/agent-configs.yaml`.
 */
export function agentConfigsPath(): string {
  return dshHomePath(DOCUMENT_FILE)
}

/**
 * Read one string array, rejecting anything else.
 * @param value - the parsed YAML value.
 * @param where - location named in the error, e.g. `configs.ue.skills`.
 * @returns the string entries, or an empty array when the value is absent.
 * @throws when the value is present but is not an array of strings.
 */
function stringArray(value: unknown, where: string): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry === '')) {
    throw new Error(`agent-configs: "${where}" must be an array of non-empty strings`)
  }
  return value as readonly string[]
}

/**
 * Read one configuration definition.
 * @param value - the parsed YAML value for one name.
 * @param name - configuration name, used in the error.
 * @returns the definition with both lists materialized.
 * @throws when the entry is not a mapping.
 */
function parseConfiguration(value: unknown, name: string): AgentConfiguration {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`agent-configs: configuration "${name}" must be a mapping with "skills" and/or "mcp"`)
  }
  const record = value as Record<string, unknown>
  return { skills: stringArray(record.skills, `configs.${name}.skills`), mcp: stringArray(record.mcp, `configs.${name}.mcp`) }
}

/**
 * Parse a raw document.
 * @param raw - YAML text.
 * @param filePath - source path, used in error messages.
 * @returns the validated document.
 * @throws when the text is not a mapping, has an unknown top-level key, or a malformed entry.
 */
export function parseAgentConfigs(raw: string, filePath = agentConfigsPath()): AgentConfigsDocument {
  const parsed: unknown = parseYaml(raw)
  if (parsed === null || parsed === undefined) return EMPTY_DOCUMENT
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid agent-configs at ${filePath}: expected a YAML mapping`)
  }
  const record = parsed as Record<string, unknown>
  const unknownKeys = Object.keys(record).filter(key => !TOP_LEVEL_KEYS.includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid agent-configs at ${filePath}: unknown key(s) ${unknownKeys.join(', ')}; expected ${TOP_LEVEL_KEYS.join(' and ')}`)
  }

  const configs: Record<string, AgentConfiguration> = {}
  const configEntries = record.configs ?? {}
  if (configEntries === null || typeof configEntries !== 'object' || Array.isArray(configEntries)) {
    throw new Error(`Invalid agent-configs at ${filePath}: "configs" must be a mapping of name to definition`)
  }
  for (const [name, value] of Object.entries(configEntries as Record<string, unknown>)) {
    configs[name] = parseConfiguration(value, name)
  }

  const projects: Record<string, readonly string[]> = {}
  const projectEntries = record.projects ?? {}
  if (projectEntries === null || typeof projectEntries !== 'object' || Array.isArray(projectEntries)) {
    throw new Error(`Invalid agent-configs at ${filePath}: "projects" must be a mapping of working directory to selected names`)
  }
  for (const [cwd, value] of Object.entries(projectEntries as Record<string, unknown>)) {
    projects[cwd] = stringArray(value, `projects.${cwd}`)
  }

  return { configs, projects }
}

/**
 * Read and parse the document.
 * @param filePath - path to read; defaults to {@link agentConfigsPath}.
 * @returns the document, or {@link EMPTY_DOCUMENT} when the file is absent.
 * @throws when the file exists but does not parse or validate.
 */
export async function readAgentConfigs(filePath = agentConfigsPath()): Promise<AgentConfigsDocument> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_DOCUMENT
    throw error
  }
  return parseAgentConfigs(raw, filePath)
}

/**
 * Replace the document atomically.
 * @param document - the complete replacement.
 * @param filePath - path to write; defaults to {@link agentConfigsPath}.
 */
export async function writeAgentConfigs(document: AgentConfigsDocument, filePath = agentConfigsPath()): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  await writeFile(temporary, stringifyYaml(document), 'utf-8')
  await rename(temporary, filePath)
}

/**
 * Resolve a project's selected configuration names.
 * @param document - the document to resolve against.
 * @param cwd - absolute project working directory.
 * @returns the selected names, or undefined when the project selects nothing and is therefore not governed.
 */
export function selectionOf(document: AgentConfigsDocument, cwd: string | undefined): readonly string[] | undefined {
  if (cwd === undefined) return undefined
  return document.projects[cwd]
}

/**
 * Union the skill allow globs of the selected configurations.
 * @param document - the document to resolve against.
 * @param cwd - absolute project working directory.
 * @returns the globs, or undefined when the project is not governed.
 */
export function skillGlobsOf(document: AgentConfigsDocument, cwd: string | undefined): readonly string[] | undefined {
  const selection = selectionOf(document, cwd)
  if (selection === undefined) return undefined
  const globs: string[] = []
  for (const name of selection) globs.push(...document.configs[name]?.skills ?? [])
  return globs
}

/**
 * Union the MCP server names of the selected configurations.
 * @param document - the document to resolve against.
 * @param cwd - absolute project working directory.
 * @returns the server names; empty when the project selects no configuration,
 * undefined when the project is not governed, which allows no server.
 */
export function mcpServersOf(document: AgentConfigsDocument, cwd: string | undefined): ReadonlySet<string> | undefined {
  const selection = selectionOf(document, cwd)
  if (selection === undefined) return undefined
  const servers = new Set<string>()
  for (const name of selection) for (const server of document.configs[name]?.mcp ?? []) servers.add(server)
  return servers
}
