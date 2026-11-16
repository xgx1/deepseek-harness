/** Approve nub's pending dependency scripts in the current profile's manifest. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ManagementFailure } from './failure.ts'

/** nub wraps a long report line onto `│` continuation lines at its own width; joining them restores the value it named. */
function unwrap(report: string): string {
  return report.replace(/\n[ \t]*│[ \t]?/gu, '')
}

/** Where a non-interactive run names the build scripts it skipped. */
const IGNORED_BUILDS = /\bIgnored build scripts: (.+)/

/**
 * The key a run prints for a git-hosted package it refused to prepare. nub prints a `package.json` example, wrapped
 * at its own width, while a project whose policy still lives in `pnpm-workspace.yaml` gets pnpm's YAML example.
 * shortcut: a key that itself contains a space loses it when the wrap is rejoined, upgrade when nub prints keys unwrapped.
 */
const GIT_DEP_PREPARE = /ERR_(?:PNPM|NUB)_GIT_DEP_PREPARE_NOT_ALLOWED[\s\S]*?"allowScripts":\s*\{\s*"([\s\S]*?)"\s*:\s*true\s*\}/
const GIT_DEP_PREPARE_YAML = /ERR_(?:PNPM|NUB)_GIT_DEP_PREPARE_NOT_ALLOWED[\s\S]*?^allowBuilds:\r?\n[ \t]+(.+?): true$/m

/**
 * Whether an `allowScripts` key names a git URL that carries a credential: a password, or any user name over HTTP(S).
 * Such a key is not recorded, so the credential stays out of the profile manifest and the pending list.
 */
function carriesCredential(key: string): boolean {
  const at = key.indexOf('@git+')
  if (at === -1) return false
  const url = URL.parse(key.slice(at + '@git+'.length).replace(/#.*$/s, ''))
  return url !== null && (url.password !== '' || (url.username !== '' && /^https?:$/.test(url.protocol)))
}

/** The profile manifest's fields and the `allowScripts` decisions they record. */
interface BuildPolicy {
  fields: Record<string, unknown>
  decisions: Record<string, boolean>
}

/**
 * Read the profile manifest and its `allowScripts` decisions; an absent manifest or field records none.
 * nub refuses an entry that is not a boolean, so every present key is a decision: `true` allows the scripts, `false` denies them.
 */
async function readManifest(dir: string): Promise<BuildPolicy> {
  let text: string
  try { text = await readFile(join(dir, 'package.json'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '{}\n'
  }
  const manifest: unknown = JSON.parse(text)
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('package.json must hold a JSON object')
  }
  const fields = manifest as Record<string, unknown>
  const scripts = fields.allowScripts
  if (scripts !== undefined && (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts))) {
    throw new Error('allowScripts must be a JSON object')
  }
  return { fields, decisions: (scripts ?? {}) as Record<string, boolean> }
}

/**
 * List the build scripts a failed run reported that the manifest has not decided yet.
 *
 * The run reports an unapproved script because the manager always installs non-interactively, and the manifest records
 * decisions only, so that report is the one record of an undecided name.
 * @param dir Current profile directory.
 * @param output Captured output of the failed run.
 * @returns Exact `allowScripts` keys awaiting a build decision; decided keys and wildcard rules are excluded.
 */
export async function recordPendingBuilds(dir: string, output: string): Promise<string[]> {
  const { decisions } = await readManifest(dir)
  return blockedBuildNames(output).filter(name => !Object.hasOwn(decisions, name))
}

/**
 * Read the keys a run reported as ignored build scripts or as a git-hosted package it refused to prepare.
 * @param output Captured output of the run.
 * @returns Exact keys in report order; wildcard patterns and git keys carrying a credential are excluded.
 */
export function blockedBuildNames(output: string): string[] {
  const report = unwrap(output)
  const ignored = IGNORED_BUILDS.exec(report)?.[1]?.split(',') ?? []
  const git = GIT_DEP_PREPARE.exec(report)?.[1] ?? GIT_DEP_PREPARE_YAML.exec(report)?.[1]
  return [...ignored, ...git === undefined ? [] : [git]]
    .map(name => name.replace(/\s*\n\s*/g, '').trim())
    .filter(name => name !== '' && !/[*?]/.test(name) && !carriesCredential(name))
}

/** Persist approval without running scripts; the caller holds the profile manifest lock.
 * @param dir Current profile directory.
 * @param names Explicit package names from the pending build list.
 * @throws If a name already has an `allowScripts` decision or the manifest holds no JSON object; no approvals are written.
 */
export async function approveBuilds(dir: string, names: readonly string[]): Promise<void> {
  const { fields, decisions } = await readManifest(dir)
  if (names.some(name => Object.hasOwn(decisions, name))) throw new ManagementFailure('stale-approval')
  if (names.length === 0) return
  fields.allowScripts = { ...decisions, ...Object.fromEntries(names.map(name => [name, true])) }
  await writeFileAtomic(join(dir, 'package.json'), JSON.stringify(fields, undefined, 2) + '\n', { mode: 0o600 })
}
