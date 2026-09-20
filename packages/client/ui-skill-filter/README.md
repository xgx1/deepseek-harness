---
description: "Skill filter surfaces: the Settings page that owns the personal rule lists and the right-Sidebar tab for the merged rules plus a project override."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-filter

English | [中文](README.zh.md)

## Summary

Browser surfaces for the skill-filter rules: a Settings page for the personal allow and deny lists with the Session's catalog beside them, and a right-Sidebar tab showing the merged rules in force plus the project override lists.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## Use this package

The shipped Web composition mounts this package. Open **Skills** in Settings for the personal rules, or open **Skills** from the right-Sidebar guide for the merged view and the project override.

### When to choose it

Choose this package when the question is how a user edits the rules. The rule engine and the config files belong to `dsh-skill-filter`, and the transport to the controller.

### What each surface shows

The Settings page lists the personal allow and deny patterns as editable rows, groups the Session's catalog by name prefix so a whole family can be allowed at once, and lists every skill with its current visibility and an allow/deny switch per name. The Sidebar tab shows the merged rules the Host reports for the project, marks which layer exists, and edits the project lists; without a project config the override lists start from the rules in force.

### Minimal composition

```yaml
- id: ui-skill-filter
  name: '@deepseek-ai/dsh-client-ui-skill-filter'
```

The catalog half needs a Session: without one the surfaces say so instead of rendering an empty list.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### One Host face

Both surfaces call the same face, bound once to `ctx.remote`. Every call folds a settled `RemoteResult` into component-local state; no component carries subscription machinery, and no store outlives a render.

### Draft ownership

The rule rows are drafts the surface owns. A save writes the whole layer — the files are not merged field by field — and republishes the accepted copy so the rows show what the Host kept. The Sidebar tab seeds its project draft from the project config when one exists and from the merged config when none does, because a project config replaces the personal rules outright.

</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Skill filter controller](../../api/skill-filter-controller/README.md) — the Remote namespace these surfaces call.
- [Right Sidebar](../../../docs/subsystems/sidebar-right.md) — tab composition, navigation, and lifecycle.

-----

<a id="model-experience"></a>

## Model Experience

None, as the package is a browser-side UI plugin layer that registers no tool, prompt section, or Session event; the rules it edits change the catalog through `dsh-skill-filter`.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.


## Known Limitations and Deferred Work

- A save replaces the whole layer, so a project that wants one extra skill restates the personal list rather than adding a single pattern over it.
- Neither surface explains a hidden skill beyond its current state: a skill hidden by its own frontmatter and one hidden by the merged rules read the same here.
- The catalog is the Session's, so a Settings page opened before any Session exists shows no skill list.

**Runtime invariant:** No companion is published. Both surfaces read and write through the `skillFilter` Remote namespace, and the apply and component suites cover registration, disposal, and each surface's behavior.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
