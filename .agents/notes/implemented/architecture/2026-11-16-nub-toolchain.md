# Agent Note: The workspace toolchain runs on nub

Status: implemented

English | [中文](2026-11-16-nub-toolchain.zh.md)

## Problem

The repository ran on pnpm: `packageManager` pinned it, `pnpm-workspace.yaml` declared the members, the overrides and the build-script allow list, and every script, gate and workflow invoked `pnpm`. pnpm is a JavaScript package manager, so each command pays a Node bootstrap, and it cannot run a TypeScript file, so 120 script invocations carried `tsx` in front of them.

## Decision

`nub pm use nub` migrates the whole configuration surface at once: `package.json` gains `devEngines.packageManager`, the workspace members, `overrides`, `patchedDependencies` and `allowScripts`; `pnpm-workspace.yaml` disappears; `pnpm-lock.yaml` becomes `nub.lock` with unchanged bytes, because nub writes the pnpm v9 lockfile format. Scripts use `nub run`, `nub <file>` instead of `tsx`, and `nubx` for binaries.

Two settings are load-bearing. `node-linker=hoisted` is required: the vendored loader resolves `node-addon-require-builtin` and its platform package as siblings, which nub's isolated and global-virtual-store layouts do not provide, and HMR refuses to start without the resulting `loader.internal`. `strict-dep-builds=false` keeps the previous deny-by-default policy: `allowScripts` still decides which dependencies run install scripts, but an unapproved script warns instead of failing the install.

Every consumer of the old names moved: the gates that read the workspace declaration and the lockfile (`check-workspace-constraints`, `gen-third-party-notices`, `local-bundle-registry`, `release/bump`, `cua-helper/build-inputs`, the Python SDK exe build), their fixtures, `README` in both languages, and `AGENTS.md`, whose Toolchain section now records why the build-script allow list exists.

## Alternatives considered

- **Keep pnpm declared and use nub in compat mode.** Rejected: nub then rewrites `pnpm-lock.yaml` into a different shape on every install, leaving a dirty tree, and nothing declares the toolchain the repository actually runs.
- **Keep the isolated layout and hoist the three optional vendor peers to root `devDependencies`.** Rejected once the hoisted layout made the native binding resolvable without new dependencies.
- **Migrate the CI workflows in the same change.** Deferred: `pnpm` refuses to run in a project that declares another package manager (`ERR_PNPM_OTHER_PM_EXPECTED`), so the 24 workflows that use `pnpm/action-setup` and `pnpm install --frozen-lockfile` must move to `nubjs/setup-nub` and `nub ci` before this branch is pushed; that rewrite cannot be verified outside GitHub.

## Consequences

- `pnpm` no longer runs in this checkout; `nub pm use pnpm` reverses the switch.
- The lockfile name changed, so anything outside the repository that hardcodes `pnpm-lock.yaml` must follow.
- Upstream merges now conflict on `package.json`, `nub.lock` and the CI workflows, the cost accepted when the repository stopped shipping the upstream package manager.
- `nub` is 0.x and its resolver rejects a forced re-resolution of this graph (`ERR_NUB_UNUSED_PATCH` for two patched packages), so `nub install --force` is not a recovery path yet.
