# Agent Note: The Ende runtime is not adopted

Status: rejected — the Ende runtime swap is declined; TypeScript strictness, TOML compositions and a Turso Session store land instead

English | [中文](2026-11-15-full-ende-runtime-swap.zh.md)

## Problem

A request to "migrate the whole codebase to the ende environment" asked for DSH to run on [Ende](https://github.com/theende/ende) — a Deno fork ("the modern runtime for TypeScript", V8 + Rust + Tokio, installed by `curl ende.sh/install.sh`, run as `ende run --allow-net`), where the `Deno` global stays a permanent alias and `ende.json`/`ende.lock`/`ENDE_*` replace `deno.json`/`deno.lock`/`DENO_*` with deprecation warnings. Its README states the limits directly: unlike Deno it supports **no npm packages, no `node:*` builtins, and no CommonJS**.

## Proposal

Run every DSH process — CLI, web server, desktop shell, plugins, tests — on Ende, keeping the TypeScript sources as they are and letting the runtime own module loading and the standard library.

## Decision

DSH does not adopt Ende as its runtime. The request is satisfied by the three parts that are compatible with it — TypeScript tightened to erasable syntax only, configuration moved to TOML, and Session bulk data moved to a Turso database — and the runtime swap is recorded here as rejected instead.

## Alternatives considered

- **Swap the runtime and port the graph.** Rejected on measurement, not taste: 8540 references to 58 distinct `node:*` specifiers (`node:fs`, `node:path`, `node:child_process`, `node:sqlite`, `node:zlib`, …) across 21818 tracked files, 427 `package.json` manifests, 7474 TypeScript files (~119k lines), an Electron desktop app and a React + Playwright web app. Ende rejects npm packages and `node:*` by design, so a port means replacing Node itself rather than adapting DSH to Ende.
- **Adopt Ende only for the CLI.** Rejected: the CLI loads the same plugin graph, and that graph is where the `node:*` references live, so the boundary does not exist.
- **Keep an Ende-compatible entry point that still runs on Node.** Rejected: it would be a rename with no runtime change, while claiming a migration that did not happen.

## Consequences

- The cost that decides it is mergeability: DSH is maintained against an upstream repository that ships a Node-based runtime, and a runtime swap turns every future upstream merge into a port. A migration that cannot be merged is not a migration of this codebase.
- Nothing named Ende is part of the product. In this user's setup the string survives only as a skills-preset name in `~/.dsh/agent-configs.yaml`, which selects skill bundles and is unrelated to the runtime.
- The compatible parts shipped: `erasableSyntaxOnly` in `tsconfig.base.json` with the parameter properties rewritten ([TOML note](../../implemented/architecture/2026-11-16-toml-compositions.md)), TOML compositions, and the Turso Session store ([2026-11-15](../../implemented/architecture/2026-11-15-turso-session-persistence.md)).
- If Ende ever gains npm and `node:*` compatibility, this note stops applying; until then, re-running the measurement above is the cheap way to reopen it.
