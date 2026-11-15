/** Session-store migration copies logical logs without touching the source. */

import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import { meta, oneTurnLog } from '../packages/session/session-persistence/tests/contract.ts'
import { migrateSessionStore } from './migrate-session-store.ts'

/** Fresh scratch directory removed when the test ends. */
async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

/** Mount one persistence plugin over `config`. */
async function mount(
  plugin: typeof JsonlSessionPersistence | typeof SqliteSessionPersistence,
  config: { root: string; compression: 'zstd' | 'none' } | { path: string },
): Promise<{ persistence: SessionPersistence; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(plugin, config)
  return { persistence: ctx.sessionPersistence, dispose: async () => { await fiber.dispose() } }
}

describe('migrate-session-store', () => {
  it('copies every stored session once and verifies each log', async () => {
    const root = await scratch('dsh-migrate-jsonl-')
    const databasePath = join(await scratch('dsh-migrate-sqlite-'), 'sessions.db')

    const source = await mount(JsonlSessionPersistence, { root, compression: 'none' })
    const writer = await source.persistence.create(meta('copied', '/work'))
    await writer.append(oneTurnLog())
    await writer.flush()
    await writer.close()
    await source.dispose()

    const first = await migrateSessionStore(root, databasePath, 'none')
    expect(first.found).toBe(1)
    expect(first.imported).toEqual(['copied'])
    expect(first.skipped).toEqual([])

    const target = await mount(SqliteSessionPersistence, { path: databasePath })
    try {
      const reader = await target.persistence.open(meta('copied').id, 'read')
      expect((await reader.read()).events).toEqual(oneTurnLog())
      await reader.close()
    } finally {
      await target.dispose()
    }

    const second = await migrateSessionStore(root, databasePath, 'none')
    expect(second.imported).toEqual([])
    expect(second.skipped).toEqual(['copied'])
  })
})
