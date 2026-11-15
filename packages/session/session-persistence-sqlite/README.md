---
description: "SQLite Session-persistence backend for hosts and maintainers choosing, configuring, or debugging a single-database Session store."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-session-persistence-sqlite` implements `ctx.sessionPersistence` over one SQLite database: every stored Session is one `sessions` row holding its header, and every stored event is one `events` row holding the event's JSON text. It compresses nothing and packs nothing, so stored rows stay readable with any SQLite client. Choose it when a deployment wants one queryable database instead of per-Session files; choose `dsh-session-persistence-jsonl` when operators inspect Session logs as plain files. The backend contributes no prompt, tool, or schema.

## Table of Contents

- [Use this package](#use-this-package)
  - [When to choose it](#when-to-choose-it)
  - [Configuration](#configuration)
  - [Observable behavior](#observable-behavior)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Use this package

<a id="use-this-package"></a>

Mount it as the provider of `ctx.sessionPersistence`; consumers that inject the Session-persistence service keep working unchanged because the handle contract is backend-neutral.

### When to choose it

Choose it when Session data belongs in one database the operator already backs up and queries. The synchronous `node:sqlite` driver blocks the JavaScript thread for each append, including the transaction that publishes a batch; account for this at high append rates. Stored rows are uncompressed, so a database is larger than an equivalent compressed log.

### Configuration

Two fields: the database path and the journal mode.

```yaml
- id: session-persistence-sqlite
  name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /var/lib/dsh/sessions.db
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | SQLite database file path, or `:memory:` |
| `journalMode` | `wal` | Journal mode: `wal`, `delete`, `truncate`, or `persist` |

`wal` suits local disks; a rollback-journal mode fits filesystems where WAL's shared-memory files do not work, such as network mounts.

### Observable behavior

Missing directories and database files are created owner-only (`0o700`/`0o600`); an existing database keeps its modes. A database stamped with a physical layout version other than the current one refuses the mount. A created Session stays process-local until its first append or flush, so a Session that never wrote anything did not exist after a crash. A resolved `append` is already durable; `flush` only publishes an otherwise empty created Session. Reads and write opens refuse a log whose event vocabulary this build does not know, naming the refused event type.

-----

## Understand the implementation

<a id="understand-the-implementation"></a>

<details>
<summary>Implementation internals — click to expand</summary>

The backend is one `node:sqlite` connection and two STRICT tables; the handle contract lives in `@deepseek-ai/dsh-session-persistence`.

### Design concept

- **Header row per Session.** `sessions (id, header, inherited_event_count, revision)` holds the losslessly snapshotted header, the fork-inherited prefix length, and a counter every append advances.
- **One row per event.** `events (session_id, seq, event)` holds the event's own JSON text, so a read is one ordered `SELECT` and no decode layer exists.
- **One transaction per batch.** An append materializes the header row if needed, inserts the batch, and advances the revision inside one `BEGIN IMMEDIATE`, so a rejected batch leaves no rows behind.
- **Process-local visibility.** `create` records the header in memory; `close` without an append discards it, which is why a created Session is visible to this instance and unknown to another process until it writes.

### Open sequence

Opening creates the parent as `0o700`, exclusively creates a missing file as `0o600`, applies `PRAGMA foreign_keys = ON` and the journal mode, checks `user_version`, creates both tables, and stamps fresh databases last so a failure leaves the medium unstamped.

### Source map

- `src/index.ts` — service, open/create/flush/stat/list, append transactions, handle.
- `src/schema.ts` — open sequence, layout version, table DDL.
- `tests/sqlite.spec.ts` — the shared `runPersistenceContract` suite plus the physical layout.

</details>

-----

## Further Exploration

<a id="further-exploration"></a>

- [Session persistence seam](../session-persistence/README.md) — the handle contract every backend satisfies.
- [JSONL backend](../session-persistence-jsonl/README.md) — the file-per-Session alternative.
- [Repository architecture](../../../docs/architecture.md) — where durable Session state sits in the runtime.

-----

<a id="model-experience"></a>
## Model Experience

### Stored Session logs

#### What the model sees

SQLite storage registers `ctx.sessionPersistence` and contributes no live prompt, tool schema, or result. It stores the events the agent loop already produced and returns them to a resumed loop through `SessionHandle.read`, so a model sees exactly the history its Session recorded, with no reordering, merging, or injected text from this backend.

#### Token effect

Zero tokens on a live request. A resumed agent pays only for the history it already owns, because this backend neither adds a context line nor spends tokens rewriting one.

#### KV Cache effect

No effect on a live request prefix. A resumed loop can reuse the provider cache when its restored history and current envelope match what it sent before, and this backend changes neither.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single-writer ownership is in-process.** The backend tracks write ownership per instance; two processes opening the same database for write are not refused. Run one host per database file.
- **No JSONL import.** Sessions stored by `dsh-session-persistence-jsonl` are not read; export them with a build that still ships that provider before switching.
- **No per-Session artifact location.** Snapshots report `eventCount` only, so diagnostics cannot point at a per-Session file.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
