---
kind: upgrade-guide
description: The workspace toolchain is nub; pnpm no longer runs in this checkout, workspaces and build approvals live in package.json, and the lockfile is nub.lock.
---

# The workspace toolchain is nub

English | [中文](guide.zh.md)

## Change

This checkout runs on [nub](https://nubjs.com), not pnpm. `nub install` replaces `pnpm install`, `nub run <script>` replaces `pnpm run <script>`, and `nubx <bin>` replaces `pnpm exec <bin>`. nub declares itself in `package.json#devEngines.packageManager`; pnpm refuses to run here at all, failing with `ERR_PNPM_OTHER_PM_EXPECTED`.

Three files move or disappear:

- `pnpm-workspace.yaml` is gone. `workspaces`, `overrides`, `patchedDependencies` and `allowScripts` now live in the root `package.json`. Per-package manifests are unchanged.
- `pnpm-lock.yaml` is renamed to `nub.lock`. It keeps the pnpm v9 lockfile format, so a lockfile diff is readable.
- `.npmrc` keeps the workspace's linker settings — `node-linker=hoisted`, `auto-install-peers=true`, `strict-dep-builds=false` — and now carries `minimum-release-age-exclude` for the packages published inside nub's default 24-hour minimum age.

Install scripts are denied by default. `package.json#allowScripts` lists the ones that must run (`esbuild`, `lefthook`, `node-pty`); a new dependency that needs one is reported by nub and stays blocked until you allow it.

Consumers of the published SDKs are unaffected, and two carriers still use pnpm deliberately: `apps/desktop` bundles it, and the Python-SDK and SSH-helper executable lanes stage their production closures with `pnpm deploy`, which nub has no equivalent of.

## Migration

1. Install nub: `curl -fsSL https://nubjs.com/install.sh | bash`, then `nub install` in the checkout. Use `nub ci` where CI used `pnpm install --frozen-lockfile`.
2. Rewrite local commands: `nub run build`, `nub run test`, `nubx vitest run <path>`, `nub run -F <package> <script>`. Read `nub --help` for `--cwd`, `-F`, and `-P` before translating a compound pnpm invocation.
3. Move repository-level settings you keep locally into `package.json` (`workspaces`, `overrides`, `patchedDependencies`, `allowScripts`) and keep package-manager knobs in `.npmrc`. Do not restore `pnpm-workspace.yaml`.
4. Confirm: `nub ci` succeeds, `nub run build:check` reports no errors, `nub --version` prints 0.11.1 or later, and `git status` shows no rewritten `nub.lock`.

To go back, run `nub pm use pnpm`; it restores the pnpm declarations this migration replaced, but keep the branch that did it, because the two layouts are not merge-friendly.
