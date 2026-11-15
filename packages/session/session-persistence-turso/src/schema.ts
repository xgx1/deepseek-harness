/**
 * Database open sequence, physical layout version, and session tables for the
 * Turso Session-persistence backend: one row per stored Session header, one row
 * per stored event, no compression.
 * @module @deepseek-ai/dsh-session-persistence-turso/schema
 */

import { connect, type Database } from '@tursodatabase/database'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/**
 * On-disk physical layout version stored in `PRAGMA user_version`. Monotonic
 * by policy: a breaking layout change bumps it. Any other non-zero value
 * rejects rather than being migrated in place.
 */
export const SESSION_TURSO_SCHEMA_VERSION = 1

/**
 * Journal modes this backend runs under. `wal` is the default; the
 * rollback-journal modes exist for filesystems where WAL's shared-memory files
 * do not work (network mounts). `memory`/`off` are excluded because dropping
 * journal durability contradicts the persistence durability clause.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/* jscpd:ignore-start -- deliberately mirrors the storage-sqlite and
   session-query-sqlite open sequences. Each package owns a distinct database
   identity and schema, so a shared helper would couple independent providers. */
/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files keep their modes; every error other than `EEXIST` propagates.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open the database, apply pragmas, and ensure the session tables.
 * @param path - the database file to open, or `:memory:`.
 * @param journalMode - validated journal pragma.
 * @returns the open handle with the session tables ensured.
 */
export async function openDatabase(path: string, journalMode: JournalMode): Promise<Database> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = await connect(actual)
  try {
    await configureDatabase(db, actual, journalMode)
    return db
  } catch (error: unknown) {
    await db.close()
    throw error
  }
}

/**
 * Apply the pragmas and ensure the session tables of an already-open database.
 * @param db - the open connection.
 * @param path - the database identity, for diagnostics.
 * @param journalMode - validated journal pragma.
 */
async function configureDatabase(db: Database, path: string, journalMode: JournalMode): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON')
  // The validated union is safe to interpolate into a non-bindable PRAGMA.
  await db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
  const version = await db.prepare('PRAGMA user_version')
  const row = await version.get() as { user_version?: number } | undefined
  const onDisk = row?.user_version ?? 0
  if (onDisk !== 0 && onDisk !== SESSION_TURSO_SCHEMA_VERSION) {
    throw new Error(
      `session database at "${path}" has schema version ${onDisk}, incompatible with this build (${SESSION_TURSO_SCHEMA_VERSION})`,
    )
  }
  /* jscpd:ignore-end */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                    TEXT PRIMARY KEY,
      header                TEXT NOT NULL,
      inherited_event_count INTEGER NOT NULL,
      revision              INTEGER NOT NULL
    ) STRICT
  `)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq        INTEGER NOT NULL,
      event      TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    ) STRICT
  `)
  if (onDisk === 0) {
    // Stamp fresh databases LAST: the stamp asserts the layout is complete.
    await db.exec(`PRAGMA user_version = ${SESSION_TURSO_SCHEMA_VERSION}`)
  }
}
