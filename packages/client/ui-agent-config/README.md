---
description: "Project agent-configuration chip on the new-session screen: tick the configurations a project's sessions run with."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-config

English | [中文](README.zh.md)

## Summary

Adds a project-configuration chip to the new-session row, right after the agent-preset chip. The menu lists every configuration the Host declares, each row naming what it contributes, and ticking one persists the project's complete selection. The selection is project-level, so it applies to every later session in that working directory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside `ui-conversation`; the blank-session row then shows the chip next to the agent-preset chip.

The chip reads the current project's roster and selection when it mounts and whenever the working directory changes. Its label shows how many configurations the project carries (`Configs: none` before any), the menu marks each selected row with a check, and the menu stays open across ticks so several configurations can be chosen in one visit. Each tick writes the complete replacement selection; clearing the last one leaves the project ungoverned.

The chip renders nothing when the project has no working directory, when the Host declares no configuration, or when the document cannot be read (a parse error or a failed call). A failed write puts the previous selection back. Registering a contribution requires the `conversation.hero.agentConfig` slot, declared by [ui-conversation](../ui-conversation/README.md) and mounted by the shell.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The chip is one `single`/`session-maybe` slot contribution registered through `ctx.slots.inject('conversation.hero.agentConfig', …)`, so it appears only while `ui-conversation` declares the seat. Owner props carry the project working directory; the chip keeps the fetched view in component-local state because nothing else reads it.

The registration's inject face owns every call: `read(cwd)` and `save(cwd, selected)` call `ctx.remote.agentConfigs.getSelection` and `.setSelection` and collapse both a refused `RemoteResult` and a thrown transport failure to `undefined`, which is the same "nothing to show" answer for the chip. The Host namespace belongs to [dsh-agent-config](../../preset/agent-config/README.md); this package neither reads nor writes the configuration document.

A tick updates the local view immediately and lets the Host's persisted view replace it when the call settles, so the menu answers the click without waiting for the round trip; a write that fails restores the selection the tick started from.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Slots reference](../../../docs/subsystems/slots.md) — declaration, scope, and the inject face behind this contribution.
- [Web client architecture](../../../docs/subsystems/web-client.md) — where a browser plugin of this shape belongs.
- [dsh-agent-config](../../preset/agent-config/README.md) — the Host side that owns the roster and enforces the selection.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the configurations the project selects, whose skill and MCP contributions own model-visible capabilities.

#### KV Cache effect

A selection change affects only sessions started afterwards; a running session keeps the tools it started with, and its prompt and system context stay unchanged.

## Known Limitations and Deferred Work

- The only surface is the new-session row: a running session shows nothing about the configurations it runs with, and changing a project's selection has no effect on a session already started.
- The chrome keeps the roster on the last successful read for the lifetime of the chip: an external edit to the configuration document reaches this control only after it remounts, and the plugin subscribes to no forwarded Host event.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

One tick at a time: a second tick while a write is in flight is dropped, because two overlapping replacements can reach the Host out of order and leave the project on the older selection (`tests/agent-config-chip.client.spec.tsx`). The seat receives `cwd` from the conversation skeleton rather than reading the session itself, so the chip must keep working for a project that has no session yet.

</details>
