/** Input stamps that let a build replace unchanged gates with a no-op. */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STAMP_DIRECTORY = '.cache/build-gates'
const STAMP_VERSION = 1

interface StampFile {
  readonly version: number
  readonly hash: string
}

/**
 * Append one path's identity to the stamp lines: path, modification time, size.
 * @param path - file or directory, relative to the repository root.
 * @param lines - accumulator receiving one line per file.
 */
function collect(path: string, lines: string[]): void {
  if (!existsSync(path)) return
  const stats = statSync(path)
  if (!stats.isDirectory()) {
    lines.push(`${path}\t${stats.mtimeMs}\t${stats.size}`)
    return
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    // Symlinks are skipped: the stamped trees are source, and following a
    // link into node_modules would make the walk unbounded.
    if (entry.isDirectory() || entry.isFile()) collect(join(path, entry.name), lines)
  }
}

/**
 * Hash the current identity of every file below the given trees.
 * @param root - repository root the input paths are relative to.
 * @param inputs - file and directory paths relative to the repository root.
 * @returns A stable digest; a missing path contributes nothing.
 */
export function gateInputHash(root: string, inputs: readonly string[]): string {
  const lines: string[] = []
  for (const input of inputs) collect(join(root, input), lines)
  lines.sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/**
 * Read the stamp a previous successful run of one gate left behind.
 * @param root - repository root holding the stamp directory.
 * @param id - gate id.
 * @returns The stamped hash, or undefined when no usable stamp exists.
 */
export function readGateStamp(root: string, id: string): string | undefined {
  const path = join(root, STAMP_DIRECTORY, `${id}.json`)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StampFile
    return parsed.version === STAMP_VERSION ? parsed.hash : undefined
  } catch {
    // A torn or hand-edited stamp is a miss, never a failure.
    return undefined
  }
}

/**
 * Record the input hash of one gate after it succeeded.
 * @param root - repository root holding the stamp directory.
 * @param id - gate id.
 * @param hash - {@link gateInputHash} of the gate's inputs.
 */
export function writeGateStamp(root: string, id: string, hash: string): void {
  const directory = join(root, STAMP_DIRECTORY)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${id}.json`), JSON.stringify({ version: STAMP_VERSION, hash } satisfies StampFile))
}
