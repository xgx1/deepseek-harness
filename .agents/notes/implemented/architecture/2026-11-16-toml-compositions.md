# Agent Note: TOML compositions beside YAML

Status: implemented

English | [中文](2026-11-16-toml-compositions.zh.md)

## Problem

Every composition in this repository is YAML: the bundle patches that ship the product, the experimental bundles, the profile roots and patch layers a deployment writes, and the fixtures that test them. YAML needs a custom tag (`!!js`) to carry an expression, and the toolchain has no second reader that keeps comments, so a configuration file cannot be edited programmatically without losing the reasoning written above its rows. The product also had no supported TOML dialect at all, even though `smol-toml` was already a dependency of the vendored Include plugin.

## Decision

The vendored Include plugin parses and emits a TOML dialect of the same document model ([V29](../../../../vendor/README.md)): the root is a `[[entry]]` array of tables, and a string beginning with `js:` becomes the loader expression node the YAML `!!js` tag produces, so a composition means the same thing in either dialect. A profile or bundle patch resolves to `cordis.toml` / `cordis.patch.toml` when that file exists and to the YAML name otherwise, which lets a profile migrate one file at a time and keeps every existing profile valid.

The shipped compositions now ship as TOML: the ten bundle patches under `packages/bundle` and the nineteen experimental bundle patches, with their manifests pointing at the new files. `scripts/convert-compositions-to-toml.ts` converts a file and moves each contiguous comment block above the node it documents, because the installed `js-yaml` cannot round-trip comments and `yaml` (added as a root devDependency) can. New profiles keep writing YAML until the dialect reaches the production checkout; the dev home's own compositions are TOML, and the profile root is written in whatever dialect its file name selects.

## Alternatives considered

- **JSON compositions.** Rejected: no comments at all, and no place for the expression node without an invented prefix in a second dialect.
- **TOML inline tables in one root key (`entry = [{ ... }]`).** Rejected: a row with a nested `config` becomes one very long line, and no comment can sit above an individual row.
- **Convert with the installed `js-yaml`.** Rejected: it drops every comment, which is most of what the composition files carry. `yaml` as a root devDependency is used only by the one-off converter.
- **Keep YAML and add a reader only.** Rejected: it leaves the configuration surface unchanged, which is what was asked to change.

## Consequences

- 29 shipped composition files are TOML; the YAML siblings are deleted, so anything outside this repository that hardcodes `packages/bundle/<name>/cordis.patch.yml` must follow.
- Two gates learned the extension: the typert analyzer treats `.toml` as a data export (otherwise a bundle export resolving to a TOML file is reported as a missing TypeScript source), and `scripts/verify-product-use.ts` accepts a `.toml` specifier.
- Because the production checkout does not carry the dialect yet, `~/.dsh` keeps YAML while `~/.dsh-dev` runs TOML; the home-sync recipe in `AGENTS.md` converts on the way in.
- Test fixtures and examples stay YAML on purpose: they exercise the fallback, and a conversion there would remove the coverage that says YAML still works.
