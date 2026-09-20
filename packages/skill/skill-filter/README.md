---
description: "Whitelist skill visibility filter for the DeepSeek Harness: personal and project YAML rules decide which skills the model catalog lists."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-filter

English | [中文](README.zh.md)

## Summary

Filters the skill catalog with personal and project allow/deny glob rules. Denied skills stay registered and callable with `/name` but leave the model catalog, which cuts the catalog each request carries to the skills the current project actually needs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## Use this package

The shipped compositions mount this package as a preset plugin. It owns no configuration of its own: the rules live in two YAML files that the Owner Remote reads and writes.

### When to choose it

Choose this package when a project's agent should see a subset of the installed skills. Choose `dsh-skill-filesystem` when the question is where skills are discovered from, and `dsh-tool-skill` when the question is how the catalog reaches a request.

### Configuration files

The personal config lives at `$DSH_HOME/skill-filter.yaml` and applies to every project. The project config lives at `<cwd>/.dsh/skill-filter.yaml` and, when present, replaces the personal rules for that working directory. Both files take the same shape:

```yaml
allow:
  - "git-*"
  - "cbm-graph-first"
deny:
  - "git-rebase"
```

`allow` is required; a config with no `allow` key is a parse error. `deny` is optional. A pattern with no glob metacharacters is a specific skill name, and a specific name wins over a glob inside the same file. A skill denied by either file stays user-invocable: only its model-visible flag is cleared.

### Minimal composition

```yaml
- id: skill-filter
  name: '@deepseek-ai/dsh-skill-filter'
```

The mounted preset must disable the default filesystem provider so discovery runs through this package once. `providerName` overrides the registered provider name, `customSkillDirs` adds skill roots, and `watch` keeps host-local skill roots watched.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Provider wrapping

`FilteredSkillProvider` wraps an internal `FileSystemSkillProvider`. Every candidate the inner provider returns is rebranded with this plugin's provider name, because the registry resolves a candidate's later loads through that name. `get()` delegates to the inner provider unchanged.

### Rule merging

`filter.ts` compiles each config layer into allow and deny matchers and resolves one skill name across three sources: the project config, the personal config, and the skill's own frontmatter deny. Project rules win over personal rules, personal rules win over frontmatter, and within one file a specific name wins over a glob with ties going to deny. A name no rule allows is denied, because the model is default-deny.

### Catalog invalidation

The rules are re-read on every catalog collection, but the registry caches completed collections. The Owner Remote publishes every persisted write, and this plugin subscribes to that publication to invalidate its registration, so the next read re-applies the new rules.

</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Skill registry](../skill/README.md) — provider registration, layering, and catalog caching.
- [Skill filter controller](../../api/skill-filter-controller/README.md) — the Remote owner that reads and writes the config files.
- [ADR-0001](../../../docs/adr/0001-whitelist-skill-filter.md) — why the model is default-deny.
- [ADR-0002](../../../docs/adr/0002-merge-frontmatter-into-filter.md) — frontmatter deny as the weakest rule.

-----

<a id="model-experience"></a>

## Model Experience

### Filtered catalog

#### What the model sees

`dsh-tool-skill` renders the surviving invocable names and capped descriptions into the catalog: skills whose name matches an allow rule, minus those a deny rule or the skill's own frontmatter removes. A denied skill stays invocable as a plain `/name` reference, and a skill with no matching allow rule is absent from the catalog.

#### Token effect

The catalog shrinks to the allowed set. A workspace that denies half of its installed skills removes roughly that share of catalog bytes from every request that carries a catalog.

#### KV Cache effect

A config write invalidates the provider's catalog, and the next request appends a replacement catalog. No request-level prefix changes otherwise.


## Known Limitations and Deferred Work

- Both files are one flat allow/deny pair. A per-tool, per-directory, or conditional rule needs a schema this package does not define.
- The project config replaces the personal rules entirely rather than layering pattern by pattern, so a project that wants one extra skill restates the personal list.
- A personal config that fails to parse falls back to the last valid copy, which is cached beside the config file; the project config has no cache and reads as absent.

**Runtime invariant:** No companion is published. The skill registry owns the provider relationship this package contributes to, and the composition and filter suites cover the wrapped provider's catalog and invalidation directly.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
