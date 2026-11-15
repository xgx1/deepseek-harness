import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { meta, oneTurnLog, runPersistenceContract } from '../../session-persistence/tests/contract.ts'
import * as SqliteSessionPersistence from '../src/index.ts'
import { SESSION_SQLITE_SCHEMA_VERSION } from '../src/schema.ts'

/** One backend instance over `path`, plus its teardown. */
async function instance(path: string): Promise<{ persistence: SessionPersistence; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(SqliteSessionPersistence, { path })
  return {
    persistence: ctx.sessionPersistence,
    dispose: async () => { await fiber.dispose() },
  }
}

/** Validate the two physical columns this spec reads back. */
function eventRows(rows: unknown[]): Array<{ seq: number; event: string }> {
  return rows.map((row) => {
    const value = row as { seq?: unknown; event?: unknown }
    if (typeof value.seq !== 'number' || typeof value.event !== 'string') throw new Error('unexpected event row')
    return { seq: value.seq, event: value.event }
  })
}

runPersistenceContract('sqlite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sqlite-persistence-'))
  const dbPath = join(dir, 'sessions.db')
  const primary = await instance(dbPath)
  return {
    persistence: primary.persistence,
    dispose: async () => {
      await primary.dispose()
      await rm(dir, { recursive: true, force: true })
    },
    reopen: async () => instance(dbPath),
  }
})

describe('sqlite physical layout', () => {
  it('stores one uncompressed JSON row per event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-sqlite-layout-'))
    try {
      const dbPath = join(dir, 'sessions.db')
      const backend = await instance(dbPath)
      const handle = await backend.persistence.create(meta('layout'))
      await handle.append(oneTurnLog())
      await handle.close()
      await backend.dispose()

      const db = new DatabaseSync(dbPath)
      try {
        const rows = eventRows(db.prepare('SELECT seq, event FROM events ORDER BY seq').all())
        expect(rows).toHaveLength(oneTurnLog().length)
        // No compression layer: the stored text is the event itself.
        expect(JSON.parse(rows.at(0)?.event ?? 'null')).toEqual(oneTurnLog().at(0))
      } finally {
        db.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a database stamped by another schema version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-sqlite-version-'))
    try {
      const dbPath = join(dir, 'sessions.db')
      const db = new DatabaseSync(dbPath)
      db.exec(`PRAGMA user_version = ${SESSION_SQLITE_SCHEMA_VERSION + 1}`)
      db.close()
      await expect(instance(dbPath)).rejects.toThrow(/incompatible with this build/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
