---
description: "Skill filter surfaces: a Conversation view holding the catalog beside both rule layers, the Settings page for the same lists, and the right-Sidebar tab for the merged rules."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-filter

English | [中文](README.zh.md)

## Summary

Browser surfaces for the skill-filter rules: a Conversation view with the Session's catalog beside the personal and project allow lists, a Settings page offering the same lists, and a right-Sidebar tab showing the merged rules in force plus the project override.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## Use this package

The shipped Web composition mounts this package. Open the **Skills** tab in the Conversation view header for the full page while a Session is open, open **Skills** in Settings for the same lists, or open **Skills** from the right-Sidebar guide for the merged view and the project panel.

### When to choose it

Choose this package when the question is how a user edits the rules. The rule engine and the config files belong to `dsh-skill-filter`, and the transport to the controller.

### What each surface shows

The Conversation tab sets the catalog beside both layers: a header counts the skills and how many are visible, the catalog's switches write the project draft, and two cards hold the project and personal lists with a Save each. The Settings page lists the personal allow patterns as editable rows, mounts the same project panel for the Session's working directory, groups the Session's catalog by name prefix so a whole family can be allowed at once, and lists every skill with its current visibility and an allow switch per name — that switch writes the personal layer here. The Sidebar tab shows the merged rules the Host reports for the project, marks which layer exists, and edits the project lists through the same panel; without a project config the project draft starts from the rules in force.

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

Each layer is one hook — `usePersonalLayer` for the personal file, `useProjectLayer` for one project's — plus the panel that renders it, so every seat mounts the same draft model. The rule rows are drafts the surface owns. A save writes the whole layer — the files are not merged field by field — and republishes the accepted copy so the rows show what the Host kept. The project panel is one component — `useProjectLayer` plus `ProjectRulesPanel` — mounted by both seats, so its draft, its seeding rule and its save path are written once. That draft starts from the project config when one exists and from the merged config when none does, because the two layers union and the draft edits the project layer.

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

- The layers union, so a project cannot hide a skill the personal config allows; that skill comes off the personal list instead.
- Neither surface explains a hidden skill beyond its current state: a skill hidden by its own frontmatter and one hidden by the merged rules read the same here.
- The catalog is the Session's, so a Settings page opened before any Session exists shows no skill list.
- The project panel addresses itself by the Session's working directory, so the Settings page and the Conversation tab render it only once a Session exists.
- The catalog's switches write the project layer in the Conversation tab and the personal layer in Settings: which page you are on decides the file you edit.
- The catalog lists hidden skills too, so a skill can be allowed again from the page; the `/name` gesture and the model catalog are where a hidden skill disappears.
- An empty allow list cannot be saved: the file format requires at least one pattern, so both panels disable Save and say why. A refusal for any other cause repeats the Host's own reason.

**Runtime invariant:** No companion is published. Both surfaces read and write through the `skillFilter` Remote namespace, and the apply and component suites cover registration, disposal, and each surface's behavior.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
