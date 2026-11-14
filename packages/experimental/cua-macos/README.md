---
description: "Inspect and operate native macOS applications through scoped app and window objects."
kind: "package-reference"
---

# @deepseek-ai/dsh-cua-macos

English | [中文](README.zh.md)

## Summary

Inspect macOS permissions, select running applications and windows, read accessibility trees, capture screenshots from a selected window, and send input. Standard and other non-PTC presets use retained objects through `cua_run_code`; PTC uses its existing runtime. The Swift helper uses macOS frameworks directly and adapts selected MIT-licensed Cua Driver behavior. The [shared CUA package](../cua/README.md) owns tool registration and the dedicated runtime; this provider owns native operations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

The helper supplies bounded 64-pixel PNG application icons for permission prompts and saved-application lists. Icon reads do not launch an application or inspect its windows; icons do not determine reusable consent.

The helper runs through LaunchServices as an independent application: `DSH Computer Use.app` for release builds and `DSH Computer Use Dev.app` for source builds. Accessibility and Screen Recording permissions belong to this application. Permission guidance uses the responsible application’s bundle URL, identifier, filename, and system icon captured at startup; unavailable system attribution falls back to the independent helper’s own bundle. Dragging and Finder selection read the current on-disk bundle identifier and executable through the application-discovery reader. The page and guide both display the application’s `.app` filename. Existing connections retain their running application generation when another build updates `current.json`. When bundled inside another `.app`, it starts from a verified standalone copy; see [application storage](native/README.md#build-and-service).

Permission requests open the selected privacy pane and a native floating guide. The guide selects the largest settings window once and follows that window by ID. It uses the normal window level, ordered immediately above the selected window so authentication dialogs remain above it. Placement reads window bounds without requesting Accessibility access. The guide stays hidden until the settings window is identified; a failed settings-open request displays manual navigation instructions independently. A material alpha mask gives the panel and its shadow rounded corners. The latest request replaces the shared guide, and only its owning connection can close it during cleanup. Navigation is attempted even when the application is unavailable, and the page reports that failure. Already-granted permissions open settings without a guide; explicit settings navigation dismisses previous guidance. A rejected settings-open request reports `SETTINGS_UNAVAILABLE`; missing or replaced application targets report `APPLICATION_UNAVAILABLE`. System Settings owns drag acceptance and any relaunch requirement.

The provider resolves guide and recovery copy from the current Client language, with English for unsupported languages. Drag the guide’s application row into the permission list and enable its switch; enable the existing entry when already listed. The guide hides during dragging, closes when a drop is accepted, and returns after a canceled or rejected drag. The back button closes it and returns to the previous application. Right-click the row, or click it for keyboard focus and press Return or Space, to reveal the bundle in Finder. While open, the guide checks permission and window position every `permissionPollIntervalMs` (default 1000 ms), and closes after a confirmed grant, dismissal, disappearance of the settings window, or its owning connection’s cleanup. Dragging does not establish consent. Follow any macOS quit-and-reopen prompt; the shared helper is not automatically terminated.

-----

<a id="use-this-package"></a>
## Use this package

This package is an optional macOS dependency. For local development, run `pnpm --dir packages/experimental/cua-macos run build:native` to generate an ad-hoc-signed application and `current.json` under `native/bin`. Release packaging requires `--identity "Developer ID Application: <name> (<team>)"` and notarization; see [native build and service](native/README.md#build-and-service). Installed packages preserve the distributed signature. A package inside an Electron `app.asar` archive reads its application from the sibling `app.asar.unpacked` directory, which the Desktop installer populates; an installed package without the application fails preparation with an error naming the expected directory. Source preparation requires Swift and Python 3 from Apple Command Line Tools.

For repository Web use, enable [Computer Use](../cua-bundle/README.md) in Plugins. This prepares the local executable on macOS 14 or later. Subsequent builds check it while the existing Web profile keeps the bundle selected. Disabled profiles do not prepare native components. Explicit source composition is also available:

```sh
pnpm dsh headless --patch packages/experimental/cua-macos/examples/macos.cordis.yml --dump-config
```

The dump command checks profile composition without a model request. For a real task, replace `--dump-config` with a prompt and configure the profile’s model credentials. The overlay mounts the computer-use registry and this provider; remove an existing competing provider before using it. The helper needs Accessibility permission for AX/input and Screen Recording permission for capture; use the Computer Use permission page to open System Settings and add the helper. Source builds use the bundle filename `DSH Computer Use Dev.app` and declare `DSH Computer Use Dev` in Info.plist; select the development entry when granting access. `getCapabilities` returns the provider’s declared capabilities with observed permissions and session lock state. Locked or unavailable desktop sessions reject UI observations and input before dispatch; the user must unlock macOS before resuming. `listApps` and `cua.getState` list running applications. `findApps(query)` searches standard macOS application directories by name, bundle ID or absolute path. `getApp` selects a unique name, bundle ID, path or running PID, obtains application consent, and launches a stopped app in the background when needed. A stopped application’s bundle identifier and executable path are read from disk before approval and rechecked before and after launch; applications without a bundle identifier use their canonical executable path for reusable consent. When a selector resolves to an installation, `getApp` matches its executable path to running processes, regardless of their localized names. If launch is needed, macOS opens that installation and can reuse a process started during approval. The helper waits for launch to complete before reporting the running state. A post-launch verification failure expires the pending handle but can leave the process running; inspect running applications before selecting a fresh handle. The returned object does not read AX or activate the app. Launch cancellation may leave the application running. Model guidance starts with background observation and input, without activation during initialization or before each action. For hidden or minimized windows, try `app.show()` or `window.show()` and read fresh state. This requests unhide and unminimize without activation, raising or switching Spaces; app-level restoration selects the focused, main or sole AX window. The result names the selected `windowId`, or null when no window was selected, and reports `foregroundChanged` by comparing the front app and top window before and after the request. Null means foreground evidence was unavailable; later focus changes remain possible. If restoration fails or the window remains unusable, explain the needed foreground step, call `app.activate()` or an observed window’s advertised `AXRaise` action, then observe again. Necessary foreground access takes priority over preserving focus. Applications may change focus after input; background delivery does not guarantee an undisturbed user session.

Source builds default to `sourceSigning: ad-hoc`, without creating certificates or keychains. Changed binaries can require new permission grants. To reduce repeated grants during rebuilds and across worktrees, select an existing certificate and its absolute keychain path in the DSH home’s `cordis.patch.yml`; `cua-macos` is the entry ID loading `@deepseek-ai/dsh-cua-macos`:

```yaml
- id: cua-macos
  config:
    sourceSigning:
      identity: "<certificate SHA-1 fingerprint>"
      keychain: "/Users/<user>/.cua-macos-keys/dev/signing.keychain-db"
```

`identity` is an existing certificate name or SHA-1 fingerprint; `keychain` is a required absolute path. Developers own creating and unlocking the keychain; builds only use the selected certificate. Preserve the entry’s other configuration fields when merging this patch. The repository’s [developer signing skill](../../../.agents/skills/dsh-cua-macos-signing/SKILL.md) guides Agents through creating, reusing, and removing identities under `~/.cua-macos-keys/`, with only their selection stored in DSH home.

| Field | Default | Meaning |
| --- | --- | --- |
| `agentPreset` | `ptc` | Give this preset raw `cua` and every other Agent, with or without a preset, `cua_run_code` while its [program services](../cua/README.md#use-this-package) are available; `false` registers raw `cua` globally. |
| `standaloneRunCode.runtime` / `standaloneRunCode.executor` | shared Node / PTC limits | Resource, launch, and nested-call settings for the dedicated CUA runtime; see [CUA](../cua/README.md). |
| `screenshotTarget` | unset | Fixed `{ longEdge, maxBytes }` request-image target for screenshots. Unset resolves the target from the Agent's model route and refuses capture when that route declares no image input. |
| `allowedApps` | `[]` | Legacy path/signature grants, imported once for removal; they do not authorize new bundle-ID identities. |
| `helperPath` | package-owned executable | Absolute executable inside the signed helper `.app`; a bare binary fails with `NATIVE_APPLICATION_REQUIRED`. |
| `requireSystemPointerApproval` | `true` | Ask once per session before an explicitly requested system-pointer move or drag. |
| `sourceSigning` | `ad-hoc` | Source signing: `ad-hoc`, or `{ identity, keychain }` for an existing certificate and keychain path. Ignored for installed packages and `helperPath`. |
| `buildTimeoutMs` | `300000` | Maximum native preparation time. |
| `timeoutMs` | `30000` | Per-operation deadline; cancellation can leave partial input. |
| `connectTimeoutMs` | `5000` | Deadline for connecting to or starting the shared helper. |
| `permissionPollIntervalMs` | `1000` | Interval in milliseconds between permission and position checks while the native guide is open. |
| `screenshotTimeoutMs` | `5000` | Screenshot deadline including queue time, capped by `timeoutMs`. |
| `axTimeoutMs` | `3000` | Deadline per Accessibility system call, configured independently of the complete operation. |
| `maxRequestBytes` / `maxResponseBytes` | `1048576` / `33554432` | UTF-8 request and response limits. |
| `maxClipboardBytes` | `33554432` | Maximum original clipboard bytes preserved during a paste; oversized contents reject before replacement. |
| `pasteReadTimeoutMs` | `1000` | Clipboard read deadline after the Paste command returns; expiry reports `PASTE_NOT_CONSUMED`. |
| `maxAppMatches` | `20` | Maximum installed-app search matches; broader queries reject and require a narrower name. |
| `maxElements` / `maxDepth` | `5000` / `50` | Defaults for tree reads. Each read can raise or lower either value. Paste menu discovery always uses the configured limits. [Rationale](../../../.agents/notes/implemented/architecture/2026-11-09-cua-ax-traversal-defaults.md) |
| `maxClickHoldMs` | `5000` | Maximum explicit click hold in milliseconds; accepts nonnegative integers. Zero only permits immediate release. |
| `dragDurationMs` / `dragSteps` | `400` / `20` | Duration and movement segments for a drag. |
| `textEventIntervalMs` | `0.25` | Delay after each Unicode down/up event, from 0 to 999 ms. Keystroke timing is independent. |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-cua-macos) lists all fields. Native tool calls use `{method, params}`; the complete method-specific schema is exposed to the model. `getApp` returns the `appHandle` used by every app-targeted operation, and `app.getWindow(windowId)` returns the object that owns screenshots and pointer input.

`pressKey(key, modifiers?)` presses and releases one key. For shortcuts, pass held modifiers separately, as in `pressKey('a', ['command'])`. Pressing a modifier itself, as in `pressKey('shift')`, sets its flag on press and clears it on release. A single `+` or `plus` sends Shift+=. For `pressKey`, `click`, and `drag`, use `command`, `shift`, `option`/`alt`, `control`/`ctrl`, or `fn`. Only `pressKey` accepts `cmd` as a modifier alias for `command`. Key names are platform-defined; keypad names (`KP_0` through `KP_9`, `KP_Enter`, and keypad operators) retain their physical key codes. `typeText` sends literal text, including its line breaks and tabs. Use the App object's `pressKey` for a short press.

For a long press, call `app.sendKeyEvent('w', 'down')` inside `run_code` or `cua_run_code`. The first down holds the key across subsequent tool calls. For an ordinary key already held by this execution, each additional down sends one key-down marked as a repeat to the original process. Choose the interval between calls. A control can filter synthetic repeats, so check its response. One up releases the key. Choose when to send each up: after W down, D down and D up, W stays down. When the program returns, exits with an error, or the user pauses it, the helper releases the remaining keys at the processes that received their downs. A later execution cannot release an earlier execution's keys.

Agent disposal and plugin unload cancel and await the complete tool call, including image admission and attachment storage. An image write already in progress must settle before disposal returns; a canceled call cannot return a successful screenshot.

Application consent is enforced before AX reads, window-title reads, screenshots, activation, and input through the CUA tool. The first selection asks the human for session access, denial, or saved access when profile persistence is available. Session access is stored by conversation and application identity and survives DSH restart and Computer Use disablement. Other conversations require their own consent. Application identities use the case-sensitive bundle identifier, so versions and copies at different paths share consent and revocation regardless of signing. A valid running bundle identifier remains sufficient when the operating system cannot supply an executable path. Available paths are still checked against the selected target; process-instance and window ownership checks remain mandatory. Without a bundle identifier, consent requires the canonical executable path. Restarting or updating at that path retains consent; moving or copying the executable to another path requires a new decision. This policy does not authenticate the publisher: another program declaring the same identifier, or replacing an approved executable at the same fallback path, inherits consent. Denial prevents repeated prompts in that session. Revocation reads and removes saved access in the same queue as grant creation, invalidates each affected Agent connection, and awaits its native cleanup without replaying input. Every app handle on those Agent connections becomes unusable; other applications need fresh selection, but their session and saved grants remain reusable. See the [application consent decision](../../../.agents/notes/implemented/architecture/2026-09-26-cua-application-consent.md). These checks govern CUA calls; persistent PTC and separately authorized shell tools are not an operating-system sandbox.

Raw `getState` exposes validated state fields and the complete text for the requested disclosure options. The native helper also returns structured element diagnostics with opaque string `elementId` values for native checks; the tool projection omits that duplicate array from model text and structured tool values.

AX observations show menu-bar entries by default. Use `app.getAccessibilityTree({ includeMenus: true })` to expand menu contents and `app.getAccessibilityTree({ details: true })` for identifiers, global-point bounds and complete action names. These options also apply to raw `getState`. Every read replaces the application's current snapshot; use element IDs from that read. Pass `maxElements` or `maxDepth` to override either configured limit for one read. Truncation identifies the reached limit. Unreadable children have separate markers in the tree and set the optional raw `hasUnreadableElements` flag. A marker beside an observed control does not prevent acting on that control by its element ID. When an action must search again, macOS recovers readable children using the same range reads as observation.

Values and placeholders are separate. Named, stateful or actionable groups and scroll areas retain their own rows. Repeated names, descriptions and help text on one node are shown once. Values, placeholders and URLs keep their distinct meanings even when their text matches; body text shared by distinct nodes remains intact. Writability is explicit on relevant controls, including `AXIncrementor`; `unknown` means the system did not report it. Missing optional state fields do not imply false. During tree observation, an AXValue or AXSelectedTextRange writability probe returning -25200 leaves that field unknown and preserves the remaining nodes. Actual writes remain strict; permission, communication and invalid-element errors still propagate. UTF-16 ranges outside the observed value are marked unavailable. Compact tree labels can omit AppKit target and selector details. Pass the exact name returned by `listActions(elementId)` to `performAction`.

Call `inspect(await app.getAccessibilityTree())` to display the tree, or filter the returned text and pass the matches to `inspect`. Text inspected before a later screenshot failure remains visible.

Screenshot diagnostics use `[cua-screenshot]` records keyed by the tool request ID. Native phase records return over the originating Agent connection and cover window/AX geometry checks, system capture, PNG/Base64 encoding and response writing. Host debug logs add dispatch, reply and cleanup timings. Each request retains at most 8192 bytes of complete diagnostic records, with explicit truncation; screenshot failures append these records to the error for Session export. Records contain stages, timings and error codes, not window titles, AX text or image bytes.

Native preparation serializes building and signing with a file lock. It retains complete applications under content-addressed `native/.build/prepared` directories and atomically selects a generation through `current.json`. Existing connections retain their application; identical builds reuse its files, and corrupted copies are rejected. Cancellation and failure finish managed process cleanup before releasing the lock.

### Connect an external execution environment

To run through persistent PTC, add `--patch packages/experimental/cua-macos/examples/persistent-ptc.cordis.yml` after the macOS overlay. This provider keeps variables for the live Agent and applies the selected file sandbox policy. The caller imports the bridge and supplies the current authorized `tools.cua` binding. Persistent PTC receives an installation-owned bridge file URL in its CUA instructions, so the project does not need to install this package. The example below is for an external host that resolves the package from its own installation and supplies `tools`. For other Agents, `cua_run_code` already supplies the global object and retains variables through the [shared CUA package](../cua/README.md):

```javascript
import { connectCua } from '@deepseek-ai/dsh-cua/bridge'
const cua = connectCua(() => tools.cua)
const app = await cua.getApp("com.apple.TextEdit")
const windows = await app.getWindows()
if (windows.length === 0) throw new Error("Open a TextEdit window first")
const window = await app.getWindow(windows[0].windowId)
inspect(await window.getScreenshot())
```

An independent floating panel has its own window ID. Select it from `app.getWindows()` to capture or click the panel.

Use the `cua` API to discover and select the application (`listApps`, `getState`, `findApps`, `getApp`); use the selected app to activate it, enumerate its windows, and select one. Window selection is required for screenshots and pointer input, not only when several windows exist. `getApp` and `app.getWindow(windowId)` return without reading AX; choose the window from `getWindows()` by its title and bounds.

`getWindow` sends no native request; screenshots and pointer input reject a closed or foreign window. Read `getAccessibilityTree()` explicitly before element operations. Screenshots do not require a successful AX read. All coordinate input, including relative coordinates, requires a successful AX observation covering the window or a screenshot; absolute pixel coordinates require a delivered screenshot. An owned window without an AX surface returns an empty snapshot only when window and sheet discovery completes without unreadable elements. Within one API instance, the facade keeps one current accessibility snapshot per application handle, shared by every app and window object for that handle, including repeated selections. Reading any window replaces that snapshot; element operations use the latest snapshot ID, so use IDs from the latest tree and do not assume an older ID still identifies the same control. Local invalid AX nodes return a successful partial snapshot with explicit unavailable-branch markers; raw state includes `hasUnreadableElements: true`. These branches have no element IDs and unknown contents; inspect them with a screenshot. Fatal observation errors publish no snapshot. See the [native observation and error semantics](native/README.md#observation-and-input) before handling errors; do not repeat preceding input automatically. Window objects own screenshots and pointer input. Keyboard methods stay on `app` because input follows the app’s current focus.

Ordinary `mouseMove(target)` defaults to AX hover. Without both `AXShowAlternateUI` and `AXShowDefaultUI` on an enabled target or ancestor, it returns `HOVER_UNAVAILABLE` without prompting. Only when the task requires physical movement should the main task call `win.mouseMove(target, { useSystemPointer: true })`. On approval the Host rechecks the window and point and dispatches this move. Pass `useSystemPointer: true` on every physical move. Later explicit moves reuse the decision until the session closes or DSH restarts. Omitting the option or passing `false` uses AX. Refusal sends no input.

By default, drag posts mouse events to the target window. For controls that need system button state, use `win.drag(from, to, { useSystemPointer: true })`. This shares the session permission for system-pointer moves. The start and path must hit the foreground window. Cancellation or loss of the target releases the button at the last posted point.

`paste(text, { format: "text" | "html" })` temporarily publishes the requested clipboard format and invokes the application’s enabled standard Paste menu command. It keeps the temporary format until a pasteboard reader requests its data, then restores every captured original format while it still owns the clipboard, preserving a later copy. Paste operations share a cross-process lock and cancellation joins helper cleanup. A forced process exit can prevent restoration. Unsupported Paste commands fail without typing fallback; `typeText` remains separate key-event input.

`selectText` selects a unique literal occurrence or places the cursor before/after it through writable `AXSelectedTextRange`. Adjacent prefix/suffix disambiguate repeats. Selection preserves the remaining text and formatting, and verifies the resulting UTF-16 range; unsupported, missing, ambiguous or changed text fails without keyboard fallback. AX text includes `selectionWritable`, selection ranges and selected text when available.

Screenshot capture requires an attachment store and a resolved model route declaring image input. The shared attachment admission validates canonical Base64, the raster and its configured capacity, then stores the image once. Native data remains available to programmatic callers; model content carries coordinate metadata and the durable image reference. Response byte limits apply before parsing.

Use `win.click(id)` to send mouse events at the center of an element, or `win.click([x, y])` to click a point. For both `click(id)` and `mouseMove(id)`, the element must belong to the selected window. Prefer `invoke(id)` for a background control’s default action. For mouse input, activate the application and observe the target first. Mouse clicks on system Open and Save sheets are routed to their verified panel-service window. On macOS 14.2 and later, a window screenshot excludes its attached window group so the image uses the selected window’s bounds.

Absolute coordinates for `mouseMove`, `click`, and `drag` use `[x, y]` tuples; `scroll` uses named `x` and `y`. All use pixels in the latest returned screenshot. Pass `relative: true` for integer thousandths of window width and height, from 0 to 999; omission or `false` uses pixels. Relative input can use a successful AX read or screenshot, while absolute input requires a screenshot. The Host maps the delivered image to native points, including attachment and model-request resizing. A value of 999 remains inside the window edge. Coordinate options do not apply to element IDs. A width or height change since the latest observation returns `WINDOW_CHANGED` before input, including raw coordinate calls without a snapshot ID; read fresh AX or take a new screenshot before proceeding. Window movement alone preserves window-local coordinates. Capture and pointer input reject known disagreement between the selected window’s accessibility frame and displayed bounds with `WINDOW_CHANGED`, before posting pointer events. This includes Stage Manager transformations when AX retains the full window frame. Read fresh state; any activation or window raise remains explicit. Advertised AX actions remain available. Missing AX geometry retains the AXless path and does not establish that a transformed window can be operated.

Retained objects resolve the current tool binding on every call. The external runtime owns persistence, imports, cancellation and completion-value serialization. Screenshots return stored `Image` values for explicit display through `inspect`. A caller with another program dispatcher can build objects through `createCuaApi(dispatch)` from `./api`.

An AppKit sheet can appear in its document window’s tree with a separate window ID. For pointer input on the sheet, use `app.getWindow(sheetId)` and an element ID from that window’s tree. Keyboard input follows a system Open/Save panel only when the application’s focused sheet identifies one Apple panel-service window and that service still focuses the same panel. Unrelated or ambiguous remote recipients fail before dispatch.

Element clicks use opaque element IDs from the current snapshot. Left clicks support a single or double click; right and middle clicks support one. Click and drag options accept a button and modifier names. Drags hold that button and carry its modifiers through every movement and release. AX text marks disabled controls, `valueWritable=true`, and available `selected` state. Actions report dispatch, not application success. A visual pointer or click marker can be rendered independently of input; AX actions do not require moving the system cursor. Window-directed mouse input can still change application focus, selection or dialogs. Read state after input. `STALE_APP` requires acquiring the application again; `STALE_SNAPSHOT` requires a fresh AX read. Request timeout/cancellation waits for native acknowledgement and preserves usable handles. Missing cleanup acknowledgement closes that Agent’s connection. A screenshot RPC still awaiting its system callback occupies the single capture slot; further screenshots return `CAPTURE_BUSY`, while AX and input remain available. A late capture result is discarded, and its real completion releases that slot. Only an unresponsive operation or failed cleanup can invalidate the shared process and all its handles. Never retry uncertain input automatically. Closing an Agent releases its connection and AX references, without undoing changes to applications.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Dispatch and resource ownership</summary>

The object facade translates app/window methods into JSON operations. Within one API instance it keeps one current accessibility snapshot per application handle, while the native helper retains its own application and optional-window snapshots behind it. The bridge routes operations through the normal tool pipeline, preserving authorization, nested logs and image admission. Agents and Hosts belonging to one user share a helper for the same native build. Each connection retains independent handles, snapshots, configuration and cancellation state; desktop operations use a global queue. The managed launcher transfers service lifetime to these connections, and the helper exits after the last connection finishes cleanup. Process locks cover both build identity and the real executable path, preventing duplicate startup and path collisions after a running executable is replaced. Native handles bind a process identity to its kernel start time, and snapshots retain native AX references only inside that helper.

[Zod operation definitions](../cua/src/protocol.ts) own model parameters and separately declare Host resource fields and private continuations. Public data types derive from those definitions. `pnpm exec tsx packages/experimental/cua-macos/native/generate-protocol.ts` generates the native JSON Schema and Swift field/enum admission tables; the package test lane checks freshness and rejects Host-only fields at model admission. Native target validation, resource limits and operation behavior remain enforced at execution.

[AX text formatting](native/Sources/CuaNative/AXTextFormatter.swift) consumes already-read node data. The AX walker alone assigns opaque element IDs and retains native references, so formatting owns no second snapshot or target registry.

Native request IDs match the logged tool call IDs. Successful activation results retain foreground request details and immediate before/after focus observations in the raw tool result. An already-frontmost app skips redundant activation. Unknown observations retain the requested operation. These observations do not establish who caused an unrelated focus change or verify completion.

Node roles and metadata share one AX batch per observation. Transparent containers omit their own text and bounds while their children remain traversable. Unsupported batching retains individual attribute reads. AX traversal visits each native identity once, including proxy references that compare equal, so cyclic accessibility children cannot repeat whole subtrees. The [source manifest](native/upstream.json) records adapted upstream behavior and local Swift modules. AppKit runs on the main event loop; a separate serial executor owns AX references and synchronous input. A request retains exclusive execution through capture and response delivery. No invariant companion is published: there is no independently projected registry or durable evaluator state to reconcile. Protocol validation, target identity and resource cleanup are checked by their owning implementations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Computer-use registration](../../computer-use/computer-use/README.md)
- [Native protocol](native/protocol.schema.json)
- [Object interfaces](../cua/src/types.ts)

-----

<a id="model-experience"></a>
## Model Experience

### Native application operations

#### What the model sees

The configured PTC preset receives one `cua` operation tool with method-specific parameters through `run_code`. Other Agents receive `cua_run_code`, with the global `cua` object ready to use and only `tools.cua` bound inside the program. The verbatim block below shows the PTC operation guidance, which uses `tools.write`, `tools.grep`, and `tools.read` for large AX trees. The `cua_run_code` variant uses `node:fs/promises` to save a tree and ordinary session tools outside the program to search it; initialization and program instructions are selected by the [shared CUA package](../cua/README.md#model-experience).

##### PTC operation guidance (verbatim)

```markdown
macOS：无障碍树操作在 app 或 window 层级可用。模拟键盘输入在 app 层级可用。模拟鼠标输入在 window 层级可用。pressKey、click 与 drag 接受 command、control（或 ctrl）、option（或 alt）、shift 与 fn；pressKey 还接受 cmd 表示 command。要操作表单（sheet）上的指针输入，先用 app.getWindow(id) 选择它的窗口 ID。窗口之外的菜单项用 app.invoke(id)。findApps 搜索 /Applications、/System/Applications 与 ~/Applications。用 Computer Use 权限页在系统设置里给辅助应用授予「辅助功能」与「屏幕录制」权限。原生窗口与 AX 边界使用 macOS point，而交付的截图带有自己的像素尺寸。show 不会切换 Space，Stage Manager 也可能呈现被缩减的窗口几何；在调用 app.activate() 或执行元素声明的 AXRaise 动作之前，先说明需要的前台步骤。

用 cua 观察并操作原生应用。始终先用 cua.getCapabilities() 确认当前平台是否提供某个具体 API；它报告的可用性优先于本说明中的可用性表述。所有方法都是异步的。操作只报告「已派发」的证据，不代表效果已被验证。若 sessionLocked 为 true，或某次操作返回 SESSION_LOCKED，立即停止界面操作并请用户解锁桌面会话；返回 null 或未知时，先确认存在可用且已解锁的桌面会话。cua.getApp 会请求用户同意；若访问被拒绝或撤销，在该用户明确允许新请求之前停止使用这个应用，绝不要绕过拒绝，也不要换用其它工具来规避。没有新的观察就不要重放不确定的输入。

调用 inspect(...values) 展示选定的观察结果。

签名展示的是 await 之后解析出的返回值。ActionResult = { dispatched: boolean, foregroundChanged?: boolean | null }；未采样时省略 foregroundChanged，采样不可用时为 null。JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }；数字必须是有限值。App 是应用对象，含只读的 app.appHandle: string（不透明），以及下面列出的 app 层级方法。Window 是窗口对象，含只读的 window.windowId: string，以及下面列出的 window 层级方法。窗口 ID 是提供方发放的不透明字符串，必须原样保留。

支持的修饰键名称取决于平台与操作，见平台指南。

准备与发现：
- cua.getCapabilities() -> { platform: string, permissions: { accessibility: boolean, screenRecording: boolean }, appLevelAccessibility: boolean, systemPointer: boolean, keyboard: ('app' | 'window')[], sessionLocked: boolean | null, methods: string[], coordinateSpace: 'screenshot-pixels', browser: false } — 在不请求任何权限的前提下检查它报告的 permissions、sessionLocked、methods 与 keyboard 作用域。
- cua.listApps() -> { id: string, displayName: string, isRunning: boolean, pid?: number }[] — 列出提供方可选的应用及其当前运行状态；把返回的 id 原样传给 cua.getApp。 每一行代表一个正在运行的进程。要在多个同名或同 bundle ID 的实例中选一个，把 String(row.pid) 传给 cua.getApp。
- cua.findApps(query: string) -> { id: string, displayName: string, path: string, isRunning: boolean, pid?: number }[] — 搜索已安装应用，包含未运行的匹配项。 运行中的已安装匹配项会带进程 ID；未运行的匹配项没有 pid。
- cua.getState() -> { apps: { id: string, displayName: string, isRunning: boolean, pid?: number }[], browsers: [] } — 概述同一份提供方发现结果；这不是无障碍观察。
- cua.getApp(selector: string) -> App — 用提供方发放的发现 ID、名称、bundle ID 或（支持的平台上）绝对路径选择应用，取得用户同意，仅在提供方支持启动时于后台启动已停止的应用；返回时不读取 AX，也不激活该应用。
- app.getWindows() -> { windowId: string, appName: string, title: string, bounds: { x: number, y: number, width: number, height: number }, isOnScreen: boolean, onCurrentSpace: boolean | null }[] — 枚举窗口及其全局原生边界；onCurrentSpace 为 null 表示所属 Space 未知。
- app.getWindow(windowId: string) -> Window — 用 getWindows 返回的 ID 选择窗口，不读取 AX。对已关闭或不属于该应用的窗口执行操作时，提供方会拒绝。
- app.activate() -> ActionResult — 请求显式把应用切到前台；只在确实需要前台访问时使用。
- app.show() -> { dispatched: boolean, windowId: string | null, foregroundChanged: boolean | null } — 取消隐藏该应用，并恢复它被选中、聚焦、主用或唯一的窗口，不激活应用。
- window.show() -> { dispatched: boolean, windowId: string | null, foregroundChanged: boolean | null } — 取消隐藏并恢复指定的这个窗口，不激活它。

## 无障碍树
按平台不同，在 app 或 window 层级可用。

使用元素 ID 之前必须先显式读取 getAccessibilityTree。选择与截图不会读取或替换当前的 AX 快照。元素 ID 是取自最近一次成功树的不透明字符串；对象门面在同一应用的多次 app 与 window 对象之间只保留一份当前快照，新的读取会替换它，读取失败会让上一份失效。不同元素可能出现重复的字符串，所以不要盲目复用旧 ID；元素操作也不会退化为指针输入或键盘输入。
- getAccessibilityTree(options?: { includeMenus?: boolean, details?: boolean, maxElements?: number, maxDepth?: number }) -> string — 为这一次读取设定节点数或深度上限。省略时使用提供方设置。includeMenus 展开菜单内容，details 附加标识符、原生边界与完整动作名。 macOS 接受 maxElements 最大 100000、maxDepth 最大 512。若树被截断，下次读取时选更窄的窗口或提高所报告的上限。在常驻 PTC 中，用 const tree = await win.getAccessibilityTree() 抓取一棵大树。在内存里过滤它的行，或用 await tools.write({ file_path: path, content: tree }) 存成新的工作区文件。用 tools.grep({ path, pattern }) 搜索内容，并用 tools.read 读取匹配行附近。用 inspect 展示你需要的匹配。 只在该次观察仍然有效时使用文件里的元素 ID。
- listActions(elementId: string) -> string[] — 列出元素声明的动作。
- invoke(elementId: string) -> ActionResult — 调用元素的默认动作；元素没有默认动作时 dispatched 为 false。
- performAction(elementId: string, action: string, argument?: JsonValue) -> ActionResult — 执行一个观察到的动作，可带一个直接 JSON 参数。
- setValue(elementId: string, value: JsonValue) -> ActionResult — 写控件的值。
- selectText(elementId: string, text: string, options?: { prefix?: string, suffix?: string, selectionType?: 'text' | 'cursor_before' | 'cursor_after' }) -> ActionResult — 选中某一次字面出现，或把光标放到它旁边，用相邻上下文消除歧义。

## 模拟鼠标
普通的 mouseMove 与 drag 调用请保持 useSystemPointer 不设置，即使已经批准也一样。优先用 selectText 处理受支持的文本区间，用普通的面向窗口的拖动处理可拖动的控件。效果不明确时，先观察窗口再选择下一步动作。只有用户明确要求，或预期效果确实需要时，才请求系统指针。

截图与指针输入都要用显式指定的窗口。在做坐标输入（包括相对坐标）之前，先取得覆盖该窗口的一次成功的 getAccessibilityTree 观察，或截取该窗口的截图。绝对像素坐标要求先有返回的截图。
- getScreenshot() -> Image — 把选定的窗口截成一张存储图片，含只读的 attachmentId、path、width、height。把选中的截图传给 inspect(...values) 展示；窗口 ID 从 window.windowId 取。
- mouseMove(target: string | [number, number], options?: { relative?: boolean }) -> { dispatched: boolean, foregroundChanged?: boolean | null, hoverRoute: 'accessibility' | 'system-pointer', systemPointerMoved: boolean } — 请求把鼠标移到目标处而不按键；检查 hoverRoute 与 systemPointerMoved，并且不要指望指针会自动复位。 省略 useSystemPointer 或传 false 时，macOS 走无障碍悬停，不请求鼠标控制。这要求启用中的元素或其祖先同时支持 AXShowAlternateUI 与 AXShowDefaultUI。没有这条路径时，会在发送输入之前返回 HOVER_UNAVAILABLE。物理移动要求目标在前台且未被遮挡；说明必要的激活步骤，并重新观察目标。
- click(target: string | [number, number], options?: { mouseButton?: 'left' | 'right' | 'middle', clickCount?: 1 | 2, modifiers?: Modifier[], holdMs?: number, relative?: boolean }) -> ActionResult — 点击元素 ID 或坐标点，或做一次左键双击；holdMs 控制每次按压的时长。 click 是 Window 方法：先用 const win = await app.getWindow(windowId) 选择窗口，再调用 win.click(target)。对后台控件的默认动作使用 app.invoke(id)；要对后台应用做鼠标点击，先调用 app.activate() 并重新读取目标。两种目标形式都会发送 mouse-down 与 mouse-up。click(id) 使用元素完整边界的中心；若该中心落在窗口之外，重新取 win.getScreenshot()，用截图像素对控件的可见部分调用 click([x, y])。后台应用即使 dispatched 为 true 也可能忽略这些事件；在输入或重试之前先验证预期效果，例如选中状态是否变化。
- scroll(options: { x: number, y: number, deltaLinesX: number, deltaLinesY: number, relative?: boolean }) -> ActionResult — 在某点滚动；增量为 -10 到 10 的整数且至少一个非零，正值显示上方或左侧的内容。
- drag(from: [number, number], to: [number, number], options?: { mouseButton?: 'left' | 'right' | 'middle', modifiers?: Modifier[], relative?: boolean, useSystemPointer?: boolean }) -> ActionResult — 在同一窗口的两点之间拖动。 省略 useSystemPointer 或传 false 时，拖动直接发往窗口，不请求鼠标控制。显式的系统拖动与 mouseMove 共享同一次会话决策，并在未遮挡的前台窗口里沿路径按住选定的按钮。

字符串目标是元素 ID；坐标目标是 [x, y]，默认是最近一次返回截图上的像素。带 relative: true 时，它们是 0 到 999 的整数千分数，基准是窗口的宽与高，取值来自当前 AX 观察或截图。左键支持一次或两次按压；右键与中键只支持一次。FOREGROUND_REQUIRED 表示先解释为什么需要前台，再显式激活目标并重新观察；激活永远不会自动发生。操作后读取新状态，并把 WINDOW_CHANGED、STALE_SNAPSHOT、SCREENSHOT_REQUIRED 视为必须先做所要求的新观察或新截图，然后才能重试。

## 模拟键盘
按平台不同，在 app 或 window 层级可用。
- typeText(text: string) -> ActionResult — 在应用当前焦点处输入字面文本；行尾会发送 Return，制表符会发送 Tab。
- paste(text: string, options?: { format?: 'text' | 'html' }) -> ActionResult — 通过应用的「粘贴」命令投递文本或 HTML，并在结束后恢复原先的剪贴板内容（除非另一写入方改动了它）；粘贴失败会直接报出，不会改用 typeText 顶替；PASTE_NOT_CONSUMED 表示重试之前先观察。
- pressKey(key: string, modifiers?: Modifier[]) -> ActionResult — 按下并释放一次完整按键。例如 pressKey('Tab', ['shift']) 或 pressKey('+')。按键名是平台定义的字符串。键与修饰键分开传，不要拼成一个和弦字符串。
- sendKeyEvent(key: string, direction: 'down' | 'up') -> ActionResult — 发送一次按下或抬起事件；key 接受单个按键名，修饰键也算。 在一次程序里跨多次工具调用按住某个键时，先发送 'down'。例如 W down、D down、D up、W up。在物理键盘上按住一个键，延迟后会产生重复的按下事件。要给本次运行已经按住的非修饰键补发一次这样的重复，再发一次 'down'。每次调用只投递一个事件。控件可以过滤重复。用应用的响应来判断是否需要重发或松开。当本次程序返回、抛错，或用户暂停它时，macOS 只会把它仍然按住的键在原接收方处释放。

原生工具使用 { method, params }：app 调用要带 appHandle，window 调用要带 windowId，元素路由要用 snapshotId 配 elementId。getAccessibilityTree 对应 getState；getWindow 没有原生方法；getWindows 对应 listWindows；getScreenshot 对应 screenshot；cua.getState 对应 listApps；其余命名操作使用同名方法。
```

#### Token effect

Enabling the plugin adds a fixed schema and guidance. Native `cua` calls send result text and admitted screenshot images to the model. In TypeScript PTC and `cua_run_code`, programs select text and images with `inspect`. Retaining an app or window object in the program adds no prompt content. A higher default or per-read override can return more AX text when the window has more nodes to visit. Each visible auxiliary window, such as a status item, menu or tooltip, adds one window record to `getWindows()` and raw `getState` output; it does not automatically add a screenshot.

#### KV Cache effect

Tool results append to Session history. Changing plugin configuration or tool presentation can change the request prefix; retaining an app object does not change existing history.

## Known Limitations and Deferred Work

The native operation deadline (`timeoutMs`), per-AX-call timeout (`axTimeoutMs`), and response size limit (`maxResponseBytes`) still apply to larger tree reads.

The queue orders individual native requests. Holding an app object does not reserve its application across a Session; [continuous interaction](../../../.agents/notes/implemented/architecture/2026-10-13-cua-continuous-hover.md) grants no cross-call ownership. Capture RPCs that never return occupy the single capture slot; creating new app objects does not reset that system connection.

<a id="known-limitations-and-deferred-work"></a>

- macOS 14 is the minimum supported version; settings navigation, drag acceptance, and permission refresh require qualification on each supported release. If macOS requires quitting and reopening the helper after a Screen Recording change, its preflight check can remain denied until that restart. The guide can be dismissed without terminating other connections.
- The guide closes when its selected settings window leaves the visible-window list, including when a Space switch or minimization removes it. Request permission again after returning to reopen the guide.
- This provider supports macOS. For Windows, see the [Windows provider](../cua-windows/README.md#setup). Browser tabs, AX diffs, unassociated system panels and accessory-only apps are unsupported.
- Element IDs belong to the application's current accessibility snapshot; a later read replaces them. Screenshots and pointer input require an explicit window object.
- Coordinates use the returned screenshot pixels, including the title bar; `relative: true` selects integers from 0 to 999. Native point conversion is Host-owned. Window movement, application changes and other desktop users can race observations and input.
- macOS Stage Manager can reduce background window bounds and screenshots to thumbnails. Full-window observation and coordinate input in this state are not guaranteed; model guidance requires explaining foreground needs and avoiding repeated focus reclamation.
- System drag checks the selected window at every movement. An input-receiving popup can interrupt the gesture even in the same application. Window checks and event delivery add to the requested movement duration. Modifiers are carried on mouse events. Applications that poll system keyboard state may ignore them.
- Background input depends on private SkyLight symbols; macOS updates can make them unavailable. Validate each target OS version.
- Observed failures include dispatched Unicode text not appearing in Blender and background Command+A not selecting all text in AppKit. Inspect application state after input; a successful tool result confirms dispatch only.
- Source builds default to `ad-hoc` and can require new grants after binary changes. The [developer’s fixed identity](../../../.agents/skills/dsh-cua-macos-signing/SKILL.md) lives outside DSH home; deleting DSH home removes its selection, not the certificate or private key. Release distribution needs a stable Developer ID signature and notarization; the build command accepts `--identity`, and installed packages preserve the distributed signature. The [permission page](../cua/README.md) offers helper authorization and target-application revocation.
- Release packaging does not automatically verify GUI startup, helper identity or exit cleanup. Release maintainers can run the [distribution smoke](native/README.md#build-and-service) on a logged-in Mac before publication; a successful package build does not establish those runtime results.
- Saved permission rows show the name, path and icon of one approved copy, not an inventory of every installation sharing its identity. Removing that copy can leave its icon unavailable. Revocation still applies to every copy with the same identity.
- If macOS does not expose a running application’s bundle identifier, the helper checks its reported bundle only when its executable matches the observed process path, then falls back to that path. Consent identity creation fails only when both the bundle identifier and actual executable path are unavailable; process-instance verification can still fail independently.
- The shared CUA package and PTC providers own program execution and retained state; this package owns native operations. Real-model task success requires separate evaluation beyond native and protocol fixtures.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
