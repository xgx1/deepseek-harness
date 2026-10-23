/**
 * Orphaned-range classification for Linux systemd scopes.
 *
 * A `systemd-run --scope` unit lives as long as its cgroup holds any process, so
 * a payload that exits while a child it launched keeps running leaves the scope
 * (and its bookkeeping) behind forever. `systemd` only collects a scope on the
 * populated→empty transition, and nothing else in the seam ever empties it.
 *
 * Reaping every straggler would break an intentional survivor: `setsid nohup
 * UnrealEditor … &` is exactly how this deployment keeps a GUI alive across
 * commands (see `~/.dsh/AGENTS.md`). A `setsid` child leads its own session, so
 * its session id equals its pid. An inherited straggler — the MSBuild
 * `/nodeReuse:true` node that `dotnet build` forks, an SSH master, a leaked
 * worker — keeps its parent's session, so `session !== pid`. That difference is
 * the whole rule: reap inherited leftovers, keep deliberately detached ones.
 *
 * @module @deepseek-ai/dsh-subprocess-local/orphan-range
 */

/** Grace period after the payload exits before stragglers are judged. */
export const ORPHAN_GRACE_MS = 3_000

/** One task left in a finished payload's cgroup, as read from `/proc/<pid>/stat`. */
export interface LeftoverTask {
  /** Task pid, which `/proc/<pid>/stat` reports as field 1. */
  pid: number
  /** Session id (field 6). A `setsid` child reports its own pid here. */
  session: number
  /** Parent pid (field 4); `1`/`0` means the launcher is gone. */
  parent: number
}

/**
 * Parse the three `/proc/<pid>/stat` fields the rule needs.
 *
 * The comm field is parenthesized and may contain spaces, digits and `)`, so the
 * numeric tail is parsed from after the LAST `)`, never by splitting the whole
 * line.
 * @param text - Raw `/proc/<pid>/stat` contents, or `undefined` when unreadable.
 * @returns The task, or `undefined` when the line is absent or truncated.
 */
export function parseProcStat(text: string | undefined): LeftoverTask | undefined {
  if (text === undefined) return undefined
  const close = text.lastIndexOf(')')
  if (close < 0) return undefined
  // After "<pid> (<comm>)" the fields are: state ppid pgrp session …
  const fields = text.slice(close + 2).trim().split(/\s+/)
  if (fields.length < 4) return undefined
  const parent = Number(fields[1])
  const session = Number(fields[3])
  const pid = Number(text.slice(0, text.indexOf(' ')))
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent) || !Number.isSafeInteger(session)) return undefined
  return { pid, session, parent }
}

/**
 * Decide whether a finished payload's remaining tasks may be reaped.
 *
 * - No readable task at all (empty cgroup, or every `/proc` read failed): `keep`
 *   — an unreadable range is not evidence of anything, and stopping the scope
 *   would kill a survivor whose intent was never inspected.
 * - At least one detached task (`session === pid`): `keep` — the payload left a
 *   deliberately detached daemon, e.g. a `setsid`-launched editor or server.
 * - Otherwise: `reap` — every remaining task inherited the payload's session and
 *   is an orphan nobody owns (the MSBuild node-reuse shape).
 * @param tasks - Tasks still inside the scope's cgroup.
 * @returns The verdict for {@link reapDecisionReason}.
 */
export function classifyLeftovers(tasks: readonly LeftoverTask[]): 'empty' | 'reap' | 'keep' {
  if (tasks.length === 0) return 'empty'
  const detached = tasks.filter(task => task.session === task.pid)
  return detached.length > 0 ? 'keep' : 'reap'
}

/**
 * Operator-readable reason for one verdict, used in the reap log line.
 * @param tasks - Tasks still inside the scope's cgroup.
 * @returns A short sentence naming the pids that decided the verdict.
 */
export function reapDecisionReason(tasks: readonly LeftoverTask[]): string {
  if (tasks.length === 0) return 'range empty'
  const detached = tasks.filter(task => task.session === task.pid)
  if (detached.length > 0) {
    return `kept detached survivor pid=${detached.map(task => String(task.pid)).join(',')} (own session)`
  }
  return `reaped inherited stragglers pid=${tasks.map(task => String(task.pid)).join(',')} (payload session, nobody owns them)`
}
