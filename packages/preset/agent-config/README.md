---
description: "Named agent configurations: one document selects the skill globs, MCP servers, and tools each project's sessions may use."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-config

English | [中文](README.zh.md)

## Summary

Names configurations in `$DSH_HOME/agent-configs.yaml` and records which of them each project selects. The skill filter unions the selected configurations' globs into the project allow list, and this service masks every tool the selection does not name — an MCP tool whose server the selection omits is masked with it — so a session sees only the skills and tools its project's configurations name.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## Use this package

### The document

```yaml
configs:
  general:
    skills: ["git-*", "cbm-graph-first"]
    mcp: [cbm]
    tools: [read, write, edit, bash, run_code]
  unreal:
    skills: ["unreal-*", "ue*"]
    mcp: [unity, ue]
    tools: [read, bash, "mcp__unity__*"]
projects:
  /home/me/game: [general, unreal]
```

`configs` maps a name to its definition: `skills` holds the allow globs the skill filter evaluates, `mcp` holds MCP `serverName` values, and `tools` holds globs over model-facing tool names. The tool list is a whitelist: a tool matching none of the selection's globs is denied, and an MCP tool is allowed by its own glob or by its server. `projects` maps an absolute working directory to the configuration names it selects; a project absent from that map selects nothing, so it allows no tool, no MCP server, and the skill filter falls back to its own YAML layers. A project that selects no configuration is governed by empty rules.

A document with an unknown top-level key, a selection that is not a string array, or a definition that is not a mapping is a parse error naming the offending location.

### Enforcement

- Skills: the skill filter reads `skillGlobs(cwd)` and compiles the union into its project rule layer, so the selected globs allow skills exactly as that layer does.
- Tools: this service masks every tool the selection's `tools` globs do not match, and every `mcp__<server>__*` tool whose server the selection omits. A server that registers tools later is masked on the next `tools/change`.

### Minimal composition

```yaml
- id: agent-configs
  name: '@deepseek-ai/dsh-agent-config'
```

The package owns no plugin configuration: the document path is fixed at `$DSH_HOME/agent-configs.yaml`.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Governance is opt-in per project

`selectionOf` returns `undefined` for a working directory the document does not list, and both gates read that as the empty selection: no tool and no server is allowed, so an unlisted checkout sees neither. The skill filter instead adds no configuration layer, leaving its personal and project YAML files as the only source of skill visibility. Selecting a configuration is therefore the only way to grant a project tools.

### Masking, not disconnecting

This half intersects with the tools registry rather than the MCP manager: the selected servers stay connected, and the agent's tool view drops the unselected ones — and any tool the whitelist does not name — through the scoped restriction `tools.restrict()` installs. That restriction sets `includeScoped`, so an MCP client a preset mounts inside the agent scope is masked with the host-level rows. The mask is lifted and recomputed on every `tools/change`, so a server still connecting at the first step cannot leak its tools.

### Last-good parse

The service keeps the last successfully parsed document, so a broken write logs a warning instead of silently removing every restriction; the next successful read replaces it.

</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Skill filter](../../skill/skill-filter/README.md) — the provider that consumes the selected globs.
- [Tools registry](../../core/tools/README.md) — the scoped restriction this package uses.
- [MCP client](../../mcp/mcp-client/README.md) — the `mcp__<server>__` tool names the mask matches.

-----

<a id="model-experience"></a>

## Model Experience

### Governed request inputs

#### What the model sees

The `<available_skills>` catalog lists the skills the selected configurations' globs allow, and the tool schemas list only the tools the selection names. Nothing else about either input changes: a surviving skill or tool keeps its name, description, and order.

#### Token effect

Both inputs shrink to what the project selected. A session opened where the catalog carried 300 installed skills and the tool list carried every mounted MCP server pays only for the configured subset, on every request.

#### KV Cache effect

The catalog and the tool block are request prefixes. A document edit shows up as a one-time prefix replacement when the next session publishes its catalog; a running session keeps the catalog it already published, so its prefix stays stable.

## Known Limitations and Deferred Work

- **An absent `tools` list allows no non-MCP tool.** That is the whitelist read literally: a configuration that names servers but no tools grants no built-in tool either.
- **Unselected MCP servers stay connected.** The mask hides their tools; it does not stop the client instances the composition mounts. Refcounted lazy mounting is deferred, since a connection is process-global while sessions are concurrent.
- **No client surface.** The document is edited by hand; a configuration picker beside the agent-preset chip is deferred.
- **A selection is resolved per step, not per session.** Editing the document while a session runs changes the next catalog read and the next tool refresh, not the catalog the running session already published.

-----

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Tests cover the document grammar and the resolution rules alone (`tests/config.spec.ts`); the two enforcement points are covered by their own packages' suites plus the shipped compositions. A real-composition test for the MCP mask is the first gap to close, since only it proves the mask lands before a request.

</details>
