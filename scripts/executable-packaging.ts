/** Shared production-deploy preparation for the SDK and SSH executable carriers. */
import { existsSync, statSync } from 'node:fs'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'

/**
 * Resolve the pinned pnpm entrypoint without a command shell or a PATH lookup.
 * nub has no deploy: the executable carriers stage production closures with the pinned pnpm, and that is the only
 * remaining pnpm call in the tree.
 * @param args - pnpm arguments.
 * @returns the Node executable and the pinned pnpm entrypoint plus arguments.
 */
export function pnpmCommand(args: readonly string[]): readonly [command: string, ...args: string[]] {
  const manifest = createRequire(import.meta.url).resolve('pnpm')
  return [process.execPath, join(dirname(manifest), 'bin', 'pnpm.mjs'), ...args]
}

/**
 * Restore direct dependencies omitted by pnpm's legacy hoister, excluding nested module trees.
 * @param staging - deployed runtime root.
 * @param sourceNodeModules - deploy source's installed dependencies.
 * @returns names restored from the source installation.
 */
export async function restoreLegacyHoists(staging: string, sourceNodeModules: string): Promise<string[]> {
  const manifestPath = join(staging, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const restored: string[] = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(
        `executable-packaging: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    restored.push(dependency)
  }
  await verifyStagedDependencies(staging)
  return restored
}

/**
 * Reject a deployed payload whose manifest names missing direct dependency directories.
 * @param staging - Deployed payload root containing package.json and node_modules.
 * @returns Resolves when every declared direct dependency has a directory.
 */
export async function verifyStagedDependencies(staging: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const missing = Object.keys(manifest.dependencies ?? {}).sort()
    .filter(dependency => !statSync(join(staging, 'node_modules', dependency), { throwIfNoEntry: false })?.isDirectory())
  if (missing.length > 0) {
    throw new Error(`executable-packaging: staged dependencies remain missing: ${missing.join(', ')}.`)
  }
}
