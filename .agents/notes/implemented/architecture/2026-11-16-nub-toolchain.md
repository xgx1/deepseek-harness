# Agent Note: The workspace toolchain runs on nub

Status: implemented

English | [中文](2026-11-16-nub-toolchain.zh.md)

## Problem

The repository ran on pnpm: `packageManager` pinned it, `pnpm-workspace.yaml` declared the members, the overrides and the build-script allow list, and every script, gate and workflow invoked `pnpm`. pnpm is a JavaScript package manager, so each command pays a Node bootstrap, and it cannot run a TypeScript file, so 120 script invocations carried `tsx` in front of them.

## Decision

`nub pm use nub` migrates the whole configuration surface at once: `package.json` gains `devEngines.packageManager`, the workspace members, `overrides`, `patchedDependencies` and `allowScripts`; `pnpm-workspace.yaml` disappears; `pnpm-lock.yaml` becomes `nub.lock` with unchanged bytes, because nub writes the pnpm v9 lockfile format. Scripts use `nub run`, `nub <file>` instead of `tsx`, and `nubx` for binaries.

Two settings are load-bearing. `node-linker=hoisted` is required: the vendored loader resolves `node-addon-require-builtin` and its platform package as siblings, which nub's isolated and global-virtual-store layouts do not provide, and HMR refuses to start without the resulting `loader.internal`. `strict-dep-builds=false` keeps the previous deny-by-default policy: `allowScripts` still decides which dependencies run install scripts, but an unapproved script warns instead of failing the install.

Every consumer of the old names moved: the gates that read the workspace declaration and the lockfile (`check-workspace-constraints`, `gen-third-party-notices`, `local-bundle-registry`, `release/bump`, `cua-helper/build-inputs`, the Python SDK exe build), their fixtures, `README` in both languages, and `AGENTS.md`, whose Toolchain section now records why the build-script allow list exists.

CI runs on nub too. The 24 workflows that used `pnpm/action-setup` now use `nubjs/setup-nub@v0` and install with `nub ci`; the store-path steps and every `actions/cache` step keyed on the lockfile are gone, so a lane carries no package-manager cache and the Windows filesystem branch that passed `--package-import-method=clone` on ReFS retired with pnpm's switch. `scripts/ci-workflow.spec.ts` and `scripts/preview-workflow.spec.ts` moved with them, and one guard test now proves that no workflow mentions pnpm and that every job running nub sets it up first.

The build and gate scripts resolve the launcher they inherited instead of looking for pnpm's JavaScript entry: `nubCommand()` in `scripts/release/process.ts` and `pmInvocation()` in `scripts/pm-invocation.ts` prefer `npm_execpath`, then `NUB_BIN`, then nub from `PATH`, and release packing runs `nub pack` once per member in that member's directory because nub has no recursive pack.

The executable carriers are the exception. `nub` has no equivalent of `pnpm deploy`, so the Python-SDK and SSH-helper lanes stage their production closures with the pinned pnpm resolved from its package rather than `PATH` (`pnpmCommand()` in `scripts/executable-packaging.ts`); `pnpm` stays a root `devDependency` for exactly that call. nub also refuses to leave a declared patch unused: the `^1.3.0` and `^2.0.1` ranges had begun resolving past the two patched packages, so `overrides` pin `@earendil-works/pi-ai@1.3.0` and `mdast-util-gfm-autolink-literal@2.0.1`, which keeps both patches in use.

## Alternatives considered

- **Keep pnpm declared and use nub in compat mode.** Rejected: nub then rewrites `pnpm-lock.yaml` into a different shape on every install, leaving a dirty tree, and nothing declares the toolchain the repository actually runs.
- **Keep the isolated layout and hoist the three optional vendor peers to root `devDependencies`.** Rejected once the hoisted layout made the native binding resolvable without new dependencies.

## Consequences

- Docs follow in the same change: 402 Markdown files had their command lines rewritten (`pnpm install` becomes `nub install`, `pnpm run` becomes `nub run`, `pnpm exec tsx` becomes `nub`, `pnpm --filter <pkg> run <script>` becomes `nub run -F <pkg> <script>`, `pnpm-lock.yaml` becomes `nub.lock`), and the operative prose moved too: contributor setup, plugin-publishing guidance and the package READMEs state nub's rules. [`docs/upgrade-guide/v0.2.2-rc.4/nub-toolchain/guide.md`](../../../../docs/upgrade-guide/v0.2.2-rc.4/nub-toolchain/guide.md) carries the user-facing migration, and archived Agent Notes stay frozen by policy. One standing paragraph moved into the root `AGENTS.md`, so its word ceiling moved from 2,080 to 2,140 rather than dropping a rule the file exists to carry.
- The executable-packaging lanes are the one place pnpm still runs; removing that call needs a nub-native staging design for production closures.
- `pnpm` no longer runs in this checkout; `nub pm use pnpm` reverses the switch.
- The lockfile name changed, so anything outside the repository that hardcodes `pnpm-lock.yaml` must follow.
- Upstream merges now conflict on `package.json`, `nub.lock` and the CI workflows, the cost accepted when the repository stopped shipping the upstream package manager.
- `nub` is 0.x: `nub install --force` re-resolves the whole graph, upgrades every range and rewrites the lockfile, so it is not a recovery path for a stale install.
