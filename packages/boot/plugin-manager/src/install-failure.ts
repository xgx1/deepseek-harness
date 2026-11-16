/**
 * What a failed package-manager run was, read off how it ended and what it printed:
 * a run names its failures with stable `ERR_NUB_*` codes, Node's errno names, and
 * a few fixed sentences, which its captured tail carries whatever the locale.
 * @module @deepseek-ai/dsh-plugin-manager/install-failure
 */

import type { PluginInstallFailureKind } from './types.ts'

/** How a run ended, beyond its exit code. */
export interface InstallFailureFacts {
  /** The output tail the failure reports. */
  readonly log: string
  /** The spawn error, when the child never ran. */
  readonly cause?: unknown
  /** Whether the run outlived its bound. */
  readonly timedOut?: boolean
}

/**
 * Patterns in the order they decide: a specific code before the generic network family.
 * `ERR_PNPM_` codes are matched too, because a deployment may configure pnpm as its launcher.
 */
const LOG_KINDS: readonly [PluginInstallFailureKind, RegExp][] = [
  ['build-blocked', /ERR_(?:PNPM|NUB)_IGNORED_BUILDS|Ignored build scripts|ERR_(?:PNPM|NUB)_GIT_DEP_PREPARE_NOT_ALLOWED/],
  ['not-found', /ERR_(?:PNPM|NUB)_FETCH_404|\bE404\b|404 Not Found|Not Found - GET|package not found/],
  ['no-matching-version', /ERR_(?:PNPM|NUB)_NO_MATCHING_VERSION|\bETARGET\b|[Nn]o matching version/],
  ['disk-full', /\bENOSPC\b|no space left on device/i],
  ['permission', /\bEACCES\b|\bEPERM\b|permission denied/i],
  ['integrity', /ERR_PNPM_TARBALL_INTEGRITY|ERR_PNPM_BAD_TARBALL_SIZE|\bEINTEGRITY\b/],
  ['unknown', /The requested URL returned error: 40[134]\b/],
  ['network', /\bENOTFOUND\b|\bECONNRESET\b|\bETIMEDOUT\b|\bECONNREFUSED\b|\bEAI_AGAIN\b|ERR_(?:PNPM|NUB)_(?:META_)?FETCH_(?:FAIL|5\d\d|TIMEOUT)|\bFETCH_ERROR\b|socket hang up|Could not resolve host|unable to access|Connection refused|failed to fetch/],
]

/**
 * Classify a failed run.
 * @param facts - how the run ended and what it printed.
 * @returns the kind, `unknown` when nothing in the facts names one.
 */
export function classifyInstallFailure(facts: InstallFailureFacts): PluginInstallFailureKind {
  if (facts.timedOut === true) return 'timeout'
  // The kind keeps its published name; it now reports the package manager the profile configures.
  if ((facts.cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return 'pnpm-missing'
  for (const [kind, pattern] of LOG_KINDS) {
    if (pattern.test(facts.log)) return kind
  }
  return 'unknown'
}
