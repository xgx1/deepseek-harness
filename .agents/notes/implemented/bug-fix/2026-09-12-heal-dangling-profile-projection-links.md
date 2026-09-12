# Agent Note: Heal dangling profile module-fallback projections

Status: implemented

English | [中文](2026-09-12-heal-dangling-profile-projection-links.zh.md)

## Problem

A profile directory copied or migrated to another path keeps the absolute links of its module fallback: projections under `<profile>/node_modules` still point at the old `<old-profile>/.dsh-module-fallback/node_modules/<package>`. Once the old tree disappears, every projection dangles and package names carried only by the profile's selected bundles become unresolvable; the shared [`profiles/node_modules`](../../../../packages/boot/app-boot/README.md) fallback covers only the installation closure. The previous `ensureProfileSymlink` treated any existing directory entry as authoritative (a successful `lstat` returned early), so boot never repaired them; `removeProfileSymlink` likewise unlinked a projection only while it still pointed at the current owned link, leaving obsolete stale projections behind.

## Decision

[`ensureProfileSymlink`](../../../../packages/boot/app-boot/src/profile.ts) inspects the existing entry: a non-symlink stays untouched (pnpm-managed entries win); a symlink is rebuilt only when it is dsh-owned — its target contains `/.dsh-module-fallback/node_modules/` — and does not already point at the requested owned link. Foreign user symlinks stay untouched. [`removeProfileSymlink`](../../../../packages/boot/app-boot/src/profile.ts) unlinks a projection when it points at the current owned link or when it is a dangling dsh-owned projection, so a moved profile's obsolete projections disappear with their owned targets. `isModuleFallbackTarget` reads the ownership signature from the link text with Windows separators normalized.

## Alternatives considered

**Heal every symlink whose target does not resolve.** Not selected: a user-managed symlink that currently dangles is not dsh's entry to replace, and rewriting it would silently repoint a foreign package.

**Rely on the shared `profiles/node_modules` healing.** Not selected: that pass heals package names in the current installation closure, which does not include bundle-only packages projected into one profile.

**Remove any symlink pointing into a `.dsh-module-fallback` path during discovery.** Not selected: ownership has to be judged in the reconcile path where a package left the bundle closure, not while the closure is being recomputed.

## Consequences

Boot after a profile copy or move repoints dangling projections and drops obsolete owned ones; foreign entries remain authoritative. The shared `profiles/node_modules` fallback still does not prune resolvable entries that left the installation closure, because that directory can serve several installations; stale shared links remain until a later installation generation reuses the name.

## Testing

[Profile tests](../../../../packages/boot/app-boot/tests/profile.spec.ts) cover a copied profile whose projection is healed, a preserved foreign symlink, a preserved pnpm-managed directory, and removal of an obsolete dangling projection. `packages/boot/app-boot/src/profile.ts` keeps 100% statement, branch, function, and line coverage.
