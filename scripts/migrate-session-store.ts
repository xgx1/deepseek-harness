/**
 * One-way Session-store migration: copy every Session stored by the JSONL
 * provider into a SQLite database without changing logical events.
 *
 * ```sh
 * pnpm exec tsx scripts/migrate-session-store.ts <jsonl-root> <sqlite-path> [zstd|none]
 * ```
 *
 * The third argument names the source store's physical file encoding and
 * defaults to `zstd`, the encoding shipped profiles write.
 *
 * The source store is only read. A Session already present in the target keeps
 * its stored copy untouched, so re-running the command resumes rather than
 * duplicating, and each copied Session is verified against its source event
 * count before the command reports success.
 * @module scripts/migrate-session-store
 */

import { Context } from '@deepseek-ai/cordis'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** Events copied per append batch, bounding peak memory on long Sessions. */
const COPY_BATCH = 200

/** One mounted persistence backend plus its teardown. */
interface Mounted {
  readonly persistence: SessionPersistence
  readonly dispose: () => Promise<void>
}

/**
 * Mount one persistence plugin on a private context.
 * @param plugin - the plugin namespace to load.
 * @param config - its validated configuration.
 * @returns the registered service and a disposer.
 */
async function mount(
  plugin: typeof JsonlSessionPersistence | typeof SqliteSessionPersistence,
  config: { root: string; compression: 'zstd' | 'none' } | { path: string },
): Promise<Mounted> {
  const ctx = new Context()
  const fiber = await ctx.plugin(plugin, config)
  return { persistence: ctx.sessionPersistence, dispose: async () => { await fiber.dispose() } }
}

/** What one migration run did. */
export interface MigrationReport {
  /** Sessions stored in the source. */
  readonly found: number
  /** Sessions copied during this run. */
  readonly imported: readonly string[]
  /** Sessions already present in the target. */
  readonly skipped: readonly string[]
}

/**
 * Copy every source Session that the target does not store yet.
 * @param root - JSONL storage root.
 * @param databasePath - SQLite database file to write, created when absent.
 * @param compression - the source store's physical file encoding.
 * @returns the ids copied and skipped.
 * @throws {Error} when a copied Session does not match its source event count.
 */
export async function migrateSessionStore(
  root: string,
  databasePath: string,
  compression: 'zstd' | 'none' = 'zstd',
): Promise<MigrationReport> {
  const from = await mount(JsonlSessionPersistence, { root, compression })
  const to = await mount(SqliteSessionPersistence, { path: databasePath })
  const imported: string[] = []
  const skipped: string[] = []
  let found = 0
  try {
    const snapshots = await from.persistence.list()
    found = snapshots.length
    for (const snapshot of snapshots) {
      const id = snapshot.header.id
      if ((await to.persistence.stat(id)) !== undefined) {
        skipped.push(id)
        continue
      }
      const reader = await from.persistence.open(id, 'read')
      let copied = 0
      try {
        const writer = await to.persistence.create(reader.header, { inheritedEventCount: reader.inheritedEventCount })
        try {
          for (let offset = 0; ; offset += COPY_BATCH) {
            const slice = await reader.read(offset, COPY_BATCH)
            if (slice.events.length === 0) break
            await writer.append(slice.events)
            copied += slice.events.length
          }
          await writer.flush()
        } finally {
          await writer.close()
        }
      } finally {
        await reader.close()
      }
      const stored = await to.persistence.stat(id)
      if (stored?.eventCount !== copied) {
        throw new Error(`session "${id}" stored ${stored?.eventCount ?? 0} of ${copied} copied events`)
      }
      imported.push(id)
    }
  } finally {
    await to.dispose()
    await from.dispose()
  }
  return { found, imported, skipped }
}

/**
 * Run the migration from two positional arguments and report the outcome.
 * @param argv - process arguments after the script path.
 * @returns process exit code.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const [root, databasePath, compression = 'zstd'] = argv
  if (root === undefined || databasePath === undefined || (compression !== 'zstd' && compression !== 'none')) {
    process.stderr.write('usage: tsx scripts/migrate-session-store.ts <jsonl-root> <sqlite-path> [zstd|none]\n')
    return 2
  }
  const report = await migrateSessionStore(resolve(root), resolve(databasePath), compression)
  process.stdout.write(`sessions found: ${report.found}; imported: ${report.imported.length}; already stored: ${report.skipped.length}\n`)
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
