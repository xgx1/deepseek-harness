# Agent Note: Non-disruptive self-development via a developer worktree and second instance

Status: implemented
Archived: 2026-09-13

English | [中文](2026-09-08-developer-worktree-non-disruptive-self-development.zh.md)

## Problem

This host runs a production `dsh web` instance that serves live agent work while DSH itself is under active development. The global `dsh` symlink resolves to the main checkout's built `apps/cli/lib/bin.js`, so source edits or rebuilds in the main worktree silently become the code the production process adopts on its next restart, and any second instance sharing `~/.dsh` would contend for the same sessions and locks. Development needs a lane that cannot reach the production process or its state.

## Decision

All self-development on this host happens in a separate git worktree (`developer`, branch `dev`); the main worktree (`master`) is reserved for production and changes only by merges. A second `dsh web` instance runs from the dev worktree's artifacts on a dedicated port with an isolated `DSH_HOME`, reusing the production API key through `~/.dsh/dsh-env.sh`.

Browser-side changes iterate without restarts: `pnpm dev:web` ([`scripts/dev-web.ts`](../../../../scripts/dev-web.ts)) watches source and rebuilds the client bundles and `apps/web/dist`, and the dev server stat-polls those artifacts and broadcasts `rebuilt` to the browser. Host-side changes restart only the dev instance; a tsx source launch (`node --import tsx/esm apps/cli/src/bin.ts web`) picks up host source without a rebuild.

Shipping verified dev work merges `dev` into `master` in the main worktree, rebuilds the main worktree (safe while the old process serves from memory), and restarts `dsh-web.service` — the only step that interrupts production. The watcher must never run concurrently with `pnpm run build` in the same tree; both write `lib/` and `apps/web/dist`.

## Alternatives considered

- **Built-run only for the dev instance.** Faithful to the production shape, but every client edit costs a rebuild and a restart. Rejected as the daily loop; the one bootstrap `pnpm run build` before the watcher starts remains required.
- **A shared state directory for both instances.** Rejected: sessions, locks, and caches collide across processes.
- **Source launch for everything.** Rejected as the default: tsx pays a transpile cost on every start and browser bundles still need the watcher; kept for host-side iteration.

## Consequences

- The host-specific realization (paths, ports, `dsh-web.service`) is marked "this host only" in root `AGENTS.md`; the terms live in the root `CONTEXT.md` glossary.
- Operating procedures live in the project skills `dsh-dev-loop`, `dsh-merge-deploy-master`, and `dsh-master-hotfix-sync` (`.agents/skills/`).
- A healthy setup verifies as: both ports answer 200, the watcher reports its watched package set, and a production restart lands within seconds with the dev instance untouched.
