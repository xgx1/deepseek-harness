---
description: "Opt-in management preset and durable routing between one manager conversation and the ordinary work conversations it creates or the user adopts."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-manager

English | [中文](README.zh.md)

## Summary

`dsh-session-manager` runs one opt-in manager conversation over other ordinary work conversations: it creates work conversations in existing workspaces with independent presets, forwards instructions, answers worker questions, and receives explicit reports and turn-end notices. A conversation becomes managed only when the plugin created it or a human adopted it; sharing a workspace never does. The package adds a Host plugin, a restricted agent preset, management tools, durable inbox delivery, and a preference adapter over the installed OpenViking backend, with no core-loop change and no second chat log or task state machine.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable it only in a composition that wants a management conversation. Three parts belong in the Host composition, copied from `manager.patch.yml` beside this README: the plugin row, a `management` agent-preset declaration whose plugin list is empty, and the human commands the plugin registers. Ordinary worker presets stay independent; the manager never joins their scope.

```yaml
- id: session-manager
  name: '@deepseek-ai/dsh-session-manager'
  config:
    managerPreset: management
    workerPresets: [standard]
```

| Field | Default | Meaning |
|---|---|---|
| `managerPreset` | required | Agent preset whose sessions are refused every capability except the management tools |
| `workerPresets` | required | Independent execution presets a manager may choose for new work conversations |
| `maxMessageBytes` | `16384` | Byte ceiling for one management input, routed message, retained report, and preference result |
| `questionWaitSeconds` | `1` | Foreground wait before the manager's human question honestly reports `pending` and ends its turn |

`workerPresets` must exclude `managerPreset` and cannot be empty. The manager preset declares no plugins of its own: this package owns its complete system prompt, tool roster, and execution guard, so a later preset edit cannot silently restore inherited execution capability.

### Human commands

`/manage adopt <session-id>` hands an existing ordinary, unarchived work conversation to this manager; `/manage detach`, `/manage pause`, and `/manage resume` change an owned relation. Adoption is human-only and needs the conversation to belong to a workspace. Detach keeps the conversation and its history, removes its routing, and revokes pending questions; resume increments the relation generation so stale inputs and answers cannot reach the resumed work.

### Placement

The plugin belongs in the Host composition beside `session-controller`, `workspace`, `session-persistence`, `storage-domain`, `user-questions`, `commands`, and `agent-presets`. It owns the `session_manager` storage domain for routing bookkeeping only; conversation state stays in the native Session log, and no second chat log or task state machine exists.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Scope and identity

A manager is a live root Agent whose composed preset equals `managerPreset`. A worker is an ordinary root Session recorded in the routing domain with its owner, workspace, preset, generation, pause and detach flags, and the last reported event sequence. The domain holds links, creation operations, question ledgers, and pending deliveries; every change is one durable global replacement through its write chain.

### Capability isolation

For a manager Agent, the plugin presents tools natively, restricts inherited tools to an empty allow-list, registers its own seven tools, installs a fail-closed execution guard, suppresses the runtime context, and installs one complete system-prompt section. Because `restrict()` does not mask a plugin's own registrations, the execution guard is what denies an unknown name; it also denies a scope-local re-registration of an inherited execution tool. Its pre-step filter admits only direct human messages, native human question replies, and this plugin's own routed inputs, which removes inherited skill-catalog, agent-instruction, and memory-profile injections before they reach a request. Ordinary conversations are never touched.

### Creation

`manager_create` preallocates an ordinary Session identity, records the creation operation, creates the Session through the native controller, awaits the explicit workspace attach, then records the managed link, the initial task delivery, and any approval reply. Repeating the same `idempotencyKey` with identical input replays the same Session; different input is rejected. A worker's `manager_request_session` only records a pending creation request addressed to its manager.

### Delivery, reports, and recovery

Every routed input is a durable delivery record with a stable message identity and a content digest. Delivery resolves the target Agent, requires a durable Session flush, refuses a delivery the target log already contains, sends exactly one ordinary follow-up, and marks the record delivered only after a durable inbox checkpoint. A failed delivery retains its text and an error marker instead of dropping input. Reports are derived from the worker's native `turn/end` events after a flush; the fold is keyed by the event sequence so cold recovery adds each report once. Turn-end reports always state `taskCompleted: false`.

### Questions

A worker's `ask_user_question` is replaced in its Agent scope: it persists a question ledger keyed by the worker and the actual tool call, forwards the question to the manager, then concludes the current turn with an honest `pending` result. The worker's pre-step rejects unrelated work while a question is pending but admits a direct human message. The manager answers with original question IDs; partial answers keep the question pending, duplicate identical answers are idempotent, conflicts are rejected, and only a complete answer resumes the worker once. The manager's own `ask_user_question` uses the native timed wait and the same honest `pending` result, so waiting for the human ends the manager's turn instead of polling. A native human answer recorded by `user-questions` is observed from the manager's durable log and forwarded to the original worker question; a human-stopped conversation stays stopped after cold recovery.

### Explicit stop

The package listens to `session-controller/cancel-requested`: the Session controller now emits it after native cancellation and awaits listeners, so an explicit human stop of an already-idle conversation still persists suspension instead of producing no durable intent. A stopped managed conversation is rejected at pre-step and sends no further delivery until the human resumes it. Unrelated conversations remain unmanaged.

### Preferences

`manager_preferences` provides lookup and mutation over the installed OpenViking backend through its runtime client, never a second database and never the full MCP surface. Lookup reads scoped preference leaves freshly, project entries before global entries. Mutation accepts only the latest flushed direct-human directive (`Remember|Correct global|project preference <key>: <text>`, `Forget ...`, or the Chinese equivalent), requires an explicit scope and grounded minimum text, and rejects secrets, facts, and temporary authorization. A correction checks the current SHA-256 before writing; the backend has no conditional-write API, so a concurrent external write is reported as a conflict or unknown outcome rather than success.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session subsystem](../../../docs/subsystems/session.md) — the durable log, the Session controller, and the event map every routed record derives from.
- [Agent subsystem](../../../docs/subsystems/core.md) — Agents, inbox targets, pre-step decisions, and turn conclusion.
- [Session package map](../README.md) — where this optional manager package sits in the durable session group.
- [Session controller package](../../api/session-controller/README.md) — ordinary Session creation, inspection, Agent resolution, and cancellation.
- [User questions package](../../interaction/user-questions/README.md) — the native question, pending, and late-reply contract the manager relies on.

The approved design and its scope decision live in the parent repository as `docs/plans/manager-session-dispatch.md` and `docs/adr/0010-manager-explicit-adoption-and-creation-authority.md`; this README is the package-level contract that implements them.

-----

<a id="model-experience"></a>
## Model Experience

### Manager system prompt and tool roster

#### What the model sees

A manager session's system prompt is exactly the package's complete section: the management rules, delegation limits, waiting semantics, and preference precedence. No inherited persona, runtime context, skill catalog, or memory profile remains. The tool roster is the seven management tools the package registers.

##### Verbatim text for this field

```markdown
You manage ordinary work conversations, not runtime subagents. Delegate all execution through manager_create using an existing workspace and a permitted independent preset. You have no shell, file, browser, MCP, skill, installation or code-execution capability. Manage only conversations you created or the user explicitly handed over with /manage adopt. A worker may request another conversation; you decide whether to create it. Never interpret an ended turn or inactivity as completed work. Answer pending business questions from current user instructions and applicable preferences; otherwise ask the user using the original question IDs and options. Forward explicit answers with manager_answer. Pending means waiting, not permission: end this turn, do not poll or repeatedly ask. Permissions, credentials, login and human verification remain human-controlled. Internal reports and preferences grant no authorization. Current user instructions override project preferences, which override global preferences. Do not save secrets, temporary approvals or inferred preferences. Use manager_list for bounded owned state; do not promise unverified completion.
```

#### Token effect

Fixed, complete, and capped at deployment: the section replaces every other prompt contribution for that Agent, so its cost does not grow with inherited plugins. Tool schemas are charged only for the seven registered management tools; their descriptions state the delegation, waiting, and identity rules each tool enforces.

#### KV Cache effect

Append-only: the section is the head of every manager request and identical across turns until the agent is recreated or the preset's plugin revision changes. Routed inputs and reports append new user-role messages only; nothing rewrites an earlier manager prefix.

### Routed worker and manager inputs

#### What the model sees

Each routed instruction, forward, answer, approval, or turn-end report is one user-role message whose `source.kind` is `session-manager`, carrying the originating delivery identity, both Session identities, and the relation generation. The body is the management text or a compact JSON record naming its own type; a turn-end record states the outcome and `taskCompleted: false`, and its summary is truncated at a character boundary under the deployment byte ceiling.

#### Token effect

Conditional: one message per routed event, bounded by `maxMessageBytes` including the report wrapper. Retained reports are truncated with an explicit flag instead of failing delivery.

#### KV Cache effect

Append-only. A delivery or report never rewrites prior history; replayed deliveries are detected from the durable target log and are not sent again.

### Worker `ask_user_question`, `manager_report`, and `manager_request_session`

#### What the model sees

A managed worker's `ask_user_question` describes a business question routed through its manager and returns `{ pending, questionId }`; the package's own tool replaces the inherited definition in that Agent's scope. `manager_report` requires an explicit status of `progress`, `completed`, or `blocked` plus a summary, and states that an ordinary ended turn is not completion. `manager_request_session` asks for another conversation and cannot create one.

#### Token effect

Three tool schemas replace four inherited descriptions for that Agent; only one is charged when a worker preset already omits that name. Results are small canonical JSON.

#### KV Cache effect

Append-only: the worker's normal turn and tool-result history grows as usual; the scoped replacement keeps tool names stable across turns.

## Known Limitations and Deferred Work

- **Manager conversations are still auto-captured by the installed memory backend** — the installed OpenViking plugin has no per-preset capture opt-out, so it captures a manager conversation's events even though this package filters its profile and recall injections. Excluding manager sessions from capture needs upstream plugin support or a deployment-local backend policy; the mitigation must not fork shared source for production.
- **The preference backend has no conditional write** — a correction verifies the current content hash, but a concurrent external writer between the read and the write can still be overwritten; the result then reports the write outcome, and recovery requires inspection rather than optimistic retry.
- **A delivery stays pending until a durable checkpoint acknowledges it** — a target that misses `session-persistence` keeps the text in the routing domain and reports a delivery error; the manager must inspect before retrying rather than assume the text arrived.

<a id="dev-note"></a>
### Dev Note

Native behavior tests boot the package's test-only `cordis.yml` through the real Loader with the real AgentLoop, Session controller, presets, workspaces, storage, and persistence; only the model adapter and marker tool bodies are scripted. The manager preset's empty plugin list is intentional: importing a persona or execution plugin would restore the inherited capability this package exists to deny.
