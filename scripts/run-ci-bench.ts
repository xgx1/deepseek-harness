/** Build benchmark artifacts with TypeScript diagnostics owned by required full builds. */

import { resolve } from 'node:path'
import { buildLibraryArtifacts, runNubCommand } from './compile-referenced-projects.ts'

/**
 * Build native support, libraries, benchmark workers, and Web assets that benchmark files consume.
 * @param root - Repository root containing all build configurations.
 * @throws If any build fails.
 */
export function buildCiBenchArtifacts(root: string): void {
  runNubCommand(root, ['run', 'build:native-system'])
  buildLibraryArtifacts(root, false, 'benchmark-emit')
  runNubCommand(root, ['exec', 'tsdown', '--config-loader', 'native', '--config', 'benchmarks/tsdown.config.ts'])
  runNubCommand(root, ['run', 'build:web'])
}

/**
 * Build benchmark artifacts, then run the existing benchmark suite.
 * @param root - Repository root containing all build configurations.
 * @throws If any build or the benchmark suite fails.
 */
export function runCiBench(root: string): void {
  buildCiBenchArtifacts(root)
  runNubCommand(root, ['run', 'test:bench:built'])
}

if (import.meta.main) runCiBench(resolve(import.meta.dirname, '..'))
