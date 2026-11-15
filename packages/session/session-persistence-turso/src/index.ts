/**
 * Turso Session-persistence backend: one database file holds every stored
 * Session header and every stored event as its own uncompressed JSON row.
 * Sessions stay invisible to other processes until their first append or
 * flush, matching the backend-neutral handle contract.
 * @module @deepseek-ai/dsh-session-persistence-turso
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Database } from '@tursodatabase/database'
import {
  SessionLogOffset,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionSeedEventState,
} from '@deepseek-ai/dsh-session'
import {
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistence,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  type SessionAccess,
  type SessionHandle,
  type SessionHandleAppendOptions,
  type SessionHandleFlushOptions,
  type SessionHandleReadOptions,
  type SessionHandleReadResult,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
  type SessionStorageMetadata,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import { openDatabase, type JournalMode } from './schema.ts'

export type { JournalMode } from './schema.ts'

/** Cordis plugin name. */
export const name = 'session-persistence-turso'

/** Plugin configuration. */
export interface Config {
  /**
   * Path to the Turso database file, or `:memory:` for an in-process
   * database. Missing directories and files are created owner-only.
   */
  path: string
  /** SQLite `journal_mode` pragma; `wal` (the default) suits local disks. */
  journalMode?: JournalMode
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
})

/** One `sessions` row as read back. */
interface SessionRow {
  readonly header: string
  readonly inherited_event_count: number
  readonly revision: number
  readonly event_count: number
}

/** Validate a durable row read back from the session database. */
function storedRow(value: unknown): SessionRow {
  const row = value as Partial<Record<keyof SessionRow, unknown>>
  if (typeof row.header !== 'string' || typeof row.inherited_event_count !== 'number'
    || typeof row.revision !== 'number' || typeof row.event_count !== 'number') {
    throw new Error('session database row does not match the session layout')
  }
  return {
    header: row.header,
    inherited_event_count: row.inherited_event_count,
    revision: row.revision,
    event_count: row.event_count,
  }
}

/** Validate one durable event row read back from the session database. */
function storedEventText(value: unknown): string {
  const row = value as Partial<Record<'event', unknown>>
  if (typeof row.event !== 'string') throw new Error('session database event row does not match the session layout')
  return row.event
}

/** Refuse a read cursor that the database cannot bind. */
function requireCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`session read ${label} must be a non-negative safe integer, got ${value}`)
  }
  return value
}

/**
 * The Turso {@link SessionPersistence} backend. One connection serves every
 * handle; a created Session is process-local state until its first append or
 * flush writes its header row.
 */
export class TursoSessionPersistence extends SessionPersistence {
  /** Backend label for diagnostics and effects. */
  override readonly name = 'session-persistence-turso'

  private readonly ready: Promise<Database>
  /** Created Sessions with no durable row yet, visible to this instance only. */
  private readonly pending = new Map<SessionId, SessionStorageMetadata>()
  /** Ids claimed by a `create` racing another `create` for the same id. */
  private readonly reserved = new Set<SessionId>()
  /** Ids held by an active write handle of this instance. */
  private readonly owned = new Set<SessionId>()
  /** Tail of the write queue: statements of concurrent writers never interleave. */
  private writes: Promise<void> = Promise.resolve()
  private closing: Promise<void> | undefined

  /**
   * @param ctx - the owning plugin context.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.ready = openDatabase(config.path, config.journalMode ?? 'wal')
    // Mark the rejection handled: every operation re-awaits `ready`, so an open
    // failure still surfaces to each caller instead of crashing the process.
    this.ready.catch(() => {})
  }

  /**
   * Create a new stored Session and take its write ownership.
   * @param header - the immutable header to store.
   * @param options - optional cancellation and the fork-inherited prefix length.
   * @returns the owned write handle.
   * @throws {SessionAlreadyExistsError} when the id is live or already stored.
   */
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    const inheritedEventCount = requireInheritedCut(snapshot, options?.inheritedEventCount)
    if (this.pending.has(snapshot.id) || this.reserved.has(snapshot.id)) {
      throw new SessionAlreadyExistsError(snapshot.id)
    }
    // Reserve synchronously so a concurrent create for the same id loses here
    // rather than after interleaving with the await below.
    this.reserved.add(snapshot.id)
    try {
      const db = await this.ready
      options?.signal?.throwIfAborted()
      if (await this.selectSession(db, snapshot.id) !== undefined) throw new SessionAlreadyExistsError(snapshot.id)
      this.pending.set(snapshot.id, { meta: snapshot, inheritedEventCount })
      this.owned.add(snapshot.id)
      return new TursoSessionHandle(this, snapshot.id, snapshot, inheritedEventCount, 'write', 0, false)
    } finally {
      this.reserved.delete(snapshot.id)
    }
  }

  /**
   * Open an existing stored Session for `read` or single-writer `write`.
   * @param id - the stored Session to open.
   * @param access - `read` (no ownership) or `write` (in-process claim).
   * @param options - optional cancellation.
   * @returns the open handle.
   * @throws {SessionPersistenceNotFoundError} when the id is not stored.
   * @throws {SessionAlreadyOwnedError} for `write` when ownership is taken.
   */
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const db = await this.ready
    options?.signal?.throwIfAborted()
    const pending = this.pending.get(id)
    if (pending !== undefined) {
      if (access === 'write') this.claim(id)
      return new TursoSessionHandle(this, id, pending.meta, pending.inheritedEventCount, access, 0, false)
    }
    const row = await this.selectSession(db, id)
    if (row === undefined) throw new SessionPersistenceNotFoundError(id)
    const header = decodeHeader(row.header)
    assertStoredId(id, header)
    assertVersion(header)
    if (access !== 'write') {
      return new TursoSessionHandle(this, id, header, SessionLogOffset(row.inherited_event_count), access, row.event_count, true)
    }
    this.claim(id)
    try {
      // A write open over a log this build cannot interpret refuses and leaves
      // no ownership behind, so a retry sees the same refusal.
      await this.readEvents(db, id, header, 0, undefined)
    } catch (error: unknown) {
      this.owned.delete(id)
      throw error
    }
    return new TursoSessionHandle(this, id, header, SessionLogOffset(row.inherited_event_count), 'write', row.event_count, true)
  }

  /**
   * Materialize every Session created on this instance and not yet written.
   * @returns resolution once each pending Session has a durable header row.
   */
  async flush(): Promise<void> {
    const db = await this.ready
    for (const [id, stored] of [...this.pending]) {
      await this.materializeSession(db, id, stored)
    }
  }

  /**
   * Observe one stored Session without opening it.
   * @param id - the stored Session to observe.
   * @param options - optional cancellation.
   * @returns the snapshot, or `undefined` when the Session is unknown here.
   */
  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const db = await this.ready
    options?.signal?.throwIfAborted()
    const pending = this.pending.get(id)
    if (pending !== undefined) return { header: pending.meta, revision: pendingRevision(id) }
    const row = await this.selectSession(db, id)
    if (row === undefined) return undefined
    return snapshotOf(id, row)
  }

  /**
   * List every Session stored on this instance, in no promised order.
   * @param options - optional cancellation.
   * @returns one snapshot per Session, including Sessions not yet materialized.
   */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    options?.signal?.throwIfAborted()
    const db = await this.ready
    options?.signal?.throwIfAborted()
    const statement = await db.prepare(`${SESSION_SELECT} ORDER BY id`)
    const rows = (await statement.all()).map(storedRow)
    const snapshots = rows.map(row => snapshotOf(decodeHeader(row.header).id, row))
    for (const [id, stored] of this.pending) {
      snapshots.push({ header: stored.meta, revision: pendingRevision(id) })
    }
    return snapshots
  }

  /**
   * Release the database. Idempotent.
   * @returns resolution after the connection is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let db: Database
    try {
      db = await this.ready
    } catch {
      // The database never opened; every operation already rejected through it.
      return
    }
    await this.writes
    await db.close()
  }

  /**
   * The open connection, awaited by every handle operation.
   * @returns the connection once the open sequence has finished.
   */
  database(): Promise<Database> {
    return this.ready
  }

  /** Claim write ownership, or refuse because another handle holds it. */
  private claim(id: SessionId): void {
    if (this.owned.has(id)) throw new SessionAlreadyOwnedError(id)
    this.owned.add(id)
  }

  /**
   * Release write ownership taken by a `create` or a write `open`.
   * @param id - the Session whose ownership is released.
   */
  release(id: SessionId): void {
    this.owned.delete(id)
  }

  /**
   * Drop a created Session that never wrote anything; the id becomes free.
   * @param id - the created Session to forget.
   */
  discardPending(id: SessionId): void {
    this.pending.delete(id)
  }

  /**
   * Run one write past every other write, so an open transaction never
   * interleaves with another writer's statements on the single connection.
   * @param work - the write to run once the queue reaches it.
   * @returns the write's own result.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writes.then(work, work)
    this.writes = run.then(() => {}, () => {})
    return run
  }

  private async selectSession(db: Database, id: SessionId): Promise<SessionRow | undefined> {
    const statement = await db.prepare(`SELECT header, inherited_event_count, revision,
      (SELECT COUNT(*) FROM events WHERE session_id = sessions.id) AS event_count
      FROM sessions WHERE id = ?`)
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- the driver types every row as any.
    const row = await statement.get(id)
    return row === undefined ? undefined : storedRow(row)
  }

  /**
   * Durability barrier for one handle: write the header row of a created
   * Session that has no events yet.
   * @param db - the open connection.
   * @param id - the Session to materialize.
   * @param stored - the header and inherited cut to store.
   */
  async flushSession(db: Database, id: SessionId, stored: SessionStorageMetadata): Promise<void> {
    await this.materializeSession(db, id, stored)
  }

  /** Write the header row of a created Session and retire its pending entry. */
  private async materializeSession(db: Database, id: SessionId, stored: SessionStorageMetadata): Promise<void> {
    await this.serialize(async () => {
      const statement = await db.prepare('INSERT OR IGNORE INTO sessions (id, header, inherited_event_count, revision) VALUES (?, ?, ?, 0)')
      await statement.run(id, JSON.stringify(stored.meta), stored.inheritedEventCount)
    })
    this.pending.delete(id)
  }

  /**
   * Read one contiguous slice of a stored log, validating the vocabulary this
   * build understands.
   * @param db - the open connection.
   * @param id - the Session to read.
   * @param header - the stored header owning the log.
   * @param offset - first event seq to include.
   * @param length - maximum number of events, or `undefined` for the rest.
   * @returns validated, frozen events in seq order.
   */
  async readEvents(
    db: Database,
    id: SessionId,
    header: SessionHeader,
    offset: number,
    length: number | undefined,
  ): Promise<SessionEvent[]> {
    const statement = await db.prepare('SELECT event FROM events WHERE session_id = ? AND seq >= ? ORDER BY seq LIMIT ?')
    const rows = await statement.all(id, offset, length ?? -1)
    const events = rows.map(row => JSON.parse(storedEventText(row)) as SessionEvent)
    return validateStoredEvents(header, events)
  }

  /**
   * Append one validated contiguous batch and its header row in one transaction.
   * @param db - the open connection.
   * @param id - the Session the batch belongs to.
   * @param stored - the header and inherited cut to materialize alongside it.
   * @param batch - contiguous events, already snapshot-validated.
   */
  async appendEvents(db: Database, id: SessionId, stored: SessionStorageMetadata, batch: readonly SessionEvent[]): Promise<void> {
    await this.serialize(async () => {
      await db.exec('BEGIN IMMEDIATE')
      try {
        const header = await db.prepare('INSERT OR IGNORE INTO sessions (id, header, inherited_event_count, revision) VALUES (?, ?, ?, 0)')
        await header.run(id, JSON.stringify(stored.meta), stored.inheritedEventCount)
        const insert = await db.prepare('INSERT INTO events (session_id, seq, event) VALUES (?, ?, ?)')
        for (const event of batch) await insert.run(id, event.seq, JSON.stringify(event))
        const bump = await db.prepare('UPDATE sessions SET revision = revision + 1 WHERE id = ?')
        await bump.run(id)
        await db.exec('COMMIT')
      } catch (error: unknown) {
        await db.exec('ROLLBACK')
        throw error
      }
    })
    this.pending.delete(id)
  }
}

const SESSION_SELECT = `SELECT header, inherited_event_count, revision,
  (SELECT COUNT(*) FROM events WHERE session_id = sessions.id) AS event_count
  FROM sessions`

/** Refuse a header/cut pair that cannot be stored faithfully. */
function requireInheritedCut(header: SessionHeader, inheritedEventCount: number | undefined): SessionLogOffset {
  if (header.isSeeded && inheritedEventCount === undefined) {
    throw new Error('seeded session header requires an inherited event count')
  }
  const cut = SessionLogOffset(inheritedEventCount ?? 0)
  if (!header.isSeeded && cut !== 0) {
    throw new Error('unseeded session header inherited event count must be 0')
  }
  return cut
}

/** Parse a stored header column. */
function decodeHeader(text: string): SessionHeader {
  return JSON.parse(text) as SessionHeader
}

/** Revision token of a Session with no durable row yet. */
function pendingRevision(id: SessionId): SessionPersistenceRevision {
  return SessionPersistenceRevision(`${id}:pending`)
}

/** Snapshot for one stored row. */
function snapshotOf(id: SessionId, row: SessionRow): SessionPersistenceSnapshot {
  return {
    header: decodeHeader(row.header),
    revision: SessionPersistenceRevision(`${id}:${row.revision}`),
    eventCount: row.event_count,
  }
}

/**
 * One open channel onto a stored Session. An append commits before it resolves,
 * so `flush` only materializes an otherwise empty created Session.
 */
class TursoSessionHandle implements SessionHandle {
  private closed = false
  private materialized: boolean
  private cursor: number

  /**
   * @param backend - the owning backend.
   * @param id - the stored Session this handle addresses.
   * @param header - the immutable stored header.
   * @param inheritedEventCount - the fork-inherited prefix length stored with the log.
   * @param access - whether this handle may mutate the log.
   * @param cursor - next logical seq to be appended.
   * @param materialized - whether the header row exists on the medium.
   */
  constructor(
    private readonly backend: TursoSessionPersistence,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly inheritedEventCount: SessionLogOffset,
    readonly access: SessionAccess,
    cursor: number,
    materialized: boolean,
  ) {
    this.cursor = cursor
    this.materialized = materialized
  }

  /**
   * Read a slice of the stored log.
   * @param offset - first logical seq to include; defaults to `0`.
   * @param length - maximum events to return; defaults to the rest of the log.
   * @param options - optional cancellation.
   * @returns the slice plus the ownership state of its event values.
   */
  async read(offset = 0, length?: number, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    const from = requireCount(offset, 'offset')
    const take = length === undefined ? undefined : requireCount(length, 'length')
    const db = await this.backend.database()
    options?.signal?.throwIfAborted()
    // Every read parses its own rows, so the returned values are caller-owned.
    const eventState: SessionSeedEventState = 'detached'
    return { eventState, events: await this.backend.readEvents(db, this.id, this.header, from, take) }
  }

  /**
   * Append a contiguous batch continuing this log.
   * @param events - the batch, in seq order.
   * @param options - optional cancellation.
   */
  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertWritable('append')
    options?.signal?.throwIfAborted()
    if (events.length === 0) return
    const batch = materializeAppendBatch(events)
    assertContiguous(this.id, batch, this.cursor)
    const db = await this.backend.database()
    options?.signal?.throwIfAborted()
    await this.backend.appendEvents(db, this.id, { meta: this.header, inheritedEventCount: this.inheritedEventCount }, batch)
    this.materialized = true
    this.cursor += batch.length
  }

  /**
   * Durability barrier: materialize this Session's header row. Appends are
   * already durable when they resolve, so this only writes an empty Session.
   * @param options - optional cancellation.
   */
  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    this.assertWritable('flush')
    options?.signal?.throwIfAborted()
    if (this.materialized) return
    const db = await this.backend.database()
    options?.signal?.throwIfAborted()
    await this.backend.flushSession(db, this.id, { meta: this.header, inheritedEventCount: this.inheritedEventCount })
    this.materialized = true
  }

  /**
   * Release this handle: a write handle that never appended discards its
   * created Session; every write handle releases ownership. Idempotent.
   * @returns resolution after release.
   */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.closed = true
    if (this.access === 'write') {
      if (!this.materialized) this.backend.discardPending(this.id)
      this.backend.release(this.id)
    }
    return Promise.resolve()
  }

  /** Delegate to {@link close}. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private assertOpen(operation: string): void {
    if (this.closed) throw new SessionHandleClosedError(this.id, operation)
  }

  private assertWritable(operation: string): void {
    this.assertOpen(operation)
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, operation)
  }
}

/**
 * Mount the Turso Session-persistence backend as `ctx.sessionPersistence`.
 * @param ctx - the owning plugin context.
 * @param config - the database path and journal mode.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const backend = new TursoSessionPersistence(ctx, config)
  ctx.effect(() => () => backend.close(), 'session-persistence-turso.close')
  // An unusable database (foreign schema version, unwritable path) fails the
  // mount rather than every later session operation.
  await backend.database()
}
