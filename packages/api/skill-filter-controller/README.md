---
description: "Remote owner for the skill-filter configuration surfaces: reads and writes the personal and project YAML config files."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-skill-filter-controller

English | [中文](README.zh.md)

## Summary

Host Remote owner for the `skillFilter` namespace. It reads and writes the personal and project skill-filter YAML files through the same functions the provider plugin reads them with, and publishes every persisted write so the provider invalidates its catalog.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## Use this package

The shipped Web composition mounts this package beside the settings controller. A client reaches it through the assembled `ctx.remote.skillFilter` namespace.

### When to choose it

Choose this package when a surface must read or persist the skill-filter rules. Choose the plugin package when the question is how the rules filter a catalog.

### Remote surface

| Method | Request | Result |
| --- | --- | --- |
| `getPersonal` | — | The personal layer, with `exists`, a parse `error`, and its `config` |
| `setPersonal` | The complete replacement config | The persisted config as re-read from disk |
| `getProject` | `{ cwd }` | The project layer for that working directory |
| `setProject` | `{ cwd, config }` | The persisted project config |
| `getEffective` | `{ cwd }` | Which layers exist and the merged config |

`allow` is required on every write and must be a non-empty array of strings; `deny` is optional. A refused write reports the Remote failure code `skill-filter/rejected` with the reason, and no file is touched.

### Minimal composition

```yaml
- id: skill-filter-controller
  name: '@deepseek-ai/dsh-api-skill-filter-controller'
```

The Client assembly mounts the generated namespace contribution; Host compositions without the skill-filter plugin still serve config reads and writes, because the files are the whole state.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Validation before the write

`setPersonal` and `setProject` validate the wire config against the file format before opening any file. The check mirrors `readConfigFile` in the plugin package, so a value the provider would refuse never reaches disk.

### Publication after the write

The owner keeps a listener set. Every successful write notifies it, and the plugin package subscribes through the shared service store — the provider runs in a preset fiber while the owner is host-plane, so a context event cannot cross that boundary. A listener failure is contained and logged, never propagated to the caller.

</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Skill filter](../../skill/skill-filter/README.md) — the provider that applies the rules.
- [Skill filter UI](../../client/ui-skill-filter/README.md) — the settings page and Sidebar tab.
- [Typert protocol](../../typert/protocol/README.md) — Remote owners, methods, and failure codes.

-----

<a id="model-experience"></a>

## Model Experience

None, as the package only reads, validates, and persists configuration files and registers no tool, prompt section, or Session event; the filtering the stored rules produce belongs to `dsh-skill-filter`.

#### KV Cache effect

None; a write changes no request prefix by itself, and the provider's catalog invalidation owns the resulting replacement catalog.


## Known Limitations and Deferred Work

- The namespace carries no per-skill verdict view: a surface that must explain why one skill is hidden reads the merged config and the Session catalog separately.
- A write is not transactional across layers. Replacing the personal config never touches a project config, and a caller that wants both keeps two calls.

**Runtime invariant:** No companion is published. The config files are the single authoritative state, and the namespace suite covers every read, write, and rejection the Owner exposes.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
