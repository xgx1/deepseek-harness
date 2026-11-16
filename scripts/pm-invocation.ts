/** Resolve shell-free child-process invocations for the package manager that launched a package script. */

/**
 * Resolve the launcher executable and arguments from the lifecycle environment.
 * @param args - Arguments to pass to the launcher (nub).
 * @param environment - Lifecycle environment containing `npm_execpath`.
 * @returns A command and argument array suitable for `spawn` or `spawnSync` without a shell.
 */
export function pmInvocation(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  const entrypoint = environment.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    return { command: environment.NUB_BIN ?? 'nub', args: [...args] }
  }
  if (/\.[cm]?js$/iu.test(entrypoint)) {
    return { command: process.execPath, args: [entrypoint, ...args] }
  }
  return { command: entrypoint, args: [...args] }
}
