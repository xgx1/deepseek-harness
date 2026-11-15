# Agent Note: A thin Turso Session-persistence provider beside JSONL

Status: implemented

English | [中文](2026-11-15-turso-session-persistence.zh.md)

## Problem

The shipped product stores every Session as a compressed JSONL log, and 2026-08-30 removed the SQLite provider to keep exactly one authoritative physical format ([`2026-08-30`](../simplification/2026-08-30-jsonl-only-session-persistence.md)). A deployment that wants Session data in the database it already backs up and queries therefore has no supported store, and the removed provider cannot simply return: the handle seam was replaced afterwards (−2266/+554 lines), so the removed package targets an interface that no longer exists, and its packed-row zstd layout contradicts a requirement for uncompressed, independently readable rows.

## Decision

`@deepseek-ai/dsh-session-persistence-turso` implements `ctx.sessionPersistence` over one Turso database with one row per stored event written as plain JSON text, and no packing or compression layer. Turso keeps SQLite file-format compatibility but ships an asynchronous driver, so the provider serializes its own writes and awaits every transaction. `SessionPersistence` stays backend-neutral, so this provider satisfies the same `runPersistenceContract` suite as the JSONL provider and ships beside it rather than replacing it: the base bundle keeps `session-persistence-jsonl`, and a deployment selects this provider in its own profile patch.

## Alternatives considered

- **Restore the removed provider from history.** Rejected: 1843 source lines written against `PersistenceBackend`/`prepare()`/`BorrowedSessionSource`, a seam that no longer exists, plus a zstd dictionary whose bytes are part of a physical format nobody currently stores. The port would be larger than a fresh implementation against today's seam.
- **Make it the only first-party provider and delete JSONL.** Rejected for now: 59 recorded-session expectations and the format-migration chain read JSONL artifacts, so a default switch rewrites the test corpus and every upstream Session change would then disagree with this branch.
- **Keep a read-only JSONL importer in the provider.** Rejected: the JSONL package owns format decoding and migration, and importing through it would couple two providers; a retained deployment can export with a build that still selects JSONL.

## Consequences

Two first-party providers now have to satisfy one shared handle contract, and this one carries no compression, so its database is larger and larger on disk than an equivalent compressed log. Write ownership is tracked per backend instance only, so one host per database file is an operational requirement rather than an enforced one. Sessions stored by JSONL are not readable by this provider: switching is a one-way move made by export, not a migration path.
