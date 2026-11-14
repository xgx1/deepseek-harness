---
description: "Inspect and operate native macOS applications through scoped app and window objects."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-cua-macos

English | [中文](README.zh.md)

## Summary

Inspect macOS permissions, select running applications and windows, read accessibility trees, capture screenshots and send input. The object API can be retained by an external persistent execution environment. The Swift helper uses macOS frameworks directly and adapts selected MIT-licensed Cua Driver behavior. This package owns neither a PTC runtime nor variable persistence.

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

For repository Web use, enable [Computer Use](../cua-bundle/README.md) in Plugins. This prepares the local executable on macOS 14 or later; Windows support is in development. Subsequent builds check it while the existing Web profile keeps the bundle selected. Disabled profiles do not prepare native components. Explicit source composition is also available:

```sh
pnpm dsh headless --patch packages/experimental/cua-macos/examples/macos.cordis.yml --dump-config
```

The dump command checks profile composition without a model request. For a real task, replace `--dump-config` with a prompt and configure the profile’s model credentials. The overlay mounts the computer-use registry and this provider; remove an existing competing provider before using it. The helper needs Accessibility permission for AX/input and Screen Recording permission for capture; use the Computer Use permission page to open System Settings and add the helper. Source builds use the bundle filename `DSH Computer Use Dev.app` and declare `DSH Computer Use Dev` in Info.plist; select the development entry when granting access. `getCapabilities` reports permissions and session lock state without opening a system dialog. Locked or unavailable desktop sessions reject UI observations and input before dispatch; the user must unlock macOS before resuming. `listApps` and `cua.getState` list running applications. `findApps(query)` searches standard macOS application directories by name, bundle ID or absolute path. `getApp` selects a unique name, bundle ID, path or running PID, obtains application consent, and launches a stopped app in the background when needed. A stopped application’s bundle identifier and executable path are read from disk before approval and rechecked before and after launch; applications without a bundle identifier use their canonical executable path for reusable consent. Selecting a stopped installation requests a new instance of that copy. The helper waits for the launched application to finish launching before returning its PID. A post-launch verification failure expires the pending handle but can leave the process running; inspect running applications before selecting a fresh handle. The returned object reads initial AX without activating the app. Launch cancellation may leave the application running. Model guidance starts with background observation and input, without activation during initialization or before each action. For hidden or minimized windows, try `app.show()` or `window.show()` and read fresh state. This requests unhide and unminimize without activation, raising or switching Spaces; app-level restoration selects the focused, main or sole AX window. The result names the selected `windowId`, or null when no window was selected, and reports `foregroundChanged` by comparing the front app and top window before and after the request. Null means foreground evidence was unavailable; later focus changes remain possible. If restoration fails or the window remains unusable, explain the needed foreground step, call `app.activate()` or an observed window’s `raise` action, then observe again. Necessary foreground access takes priority over preserving focus. Applications may change focus after input; background delivery does not guarantee an undisturbed user session.

Source builds default to `sourceSigning: ad-hoc`, without creating certificates or keychains. Changed binaries can require new permission grants. To reduce repeated grants during rebuilds and across worktrees, select an existing certificate and its absolute keychain path in the DSH home’s `cordis.patch.yml`; `cua` is the entry ID loading `@deepseek-ai/dsh-experimental-cua-macos`:

```yaml
- id: cua
  config:
    sourceSigning:
      identity: "<certificate SHA-1 fingerprint>"
      keychain: "/Users/<user>/.cua-macos-keys/dev/signing.keychain-db"
```

`identity` is an existing certificate name or SHA-1 fingerprint; `keychain` is a required absolute path. Developers own creating and unlocking the keychain; builds only use the selected certificate. Preserve the entry’s other configuration fields when merging this patch. The repository’s [developer signing skill](../../../.agents/skills/dsh-cua-macos-signing/SKILL.md) guides Agents through creating, reusing, and removing identities under `~/.cua-macos-keys/`, with only their selection stored in DSH home.

| Field | Default | Meaning |
| --- | --- | --- |
| `agentPreset` | `ptc` | Register tools and guidance only for Agents bound to this preset; `false` registers globally. |
| `allowedApps` | `[]` | Legacy path/signature grants, imported once for removal; they do not authorize new bundle-ID identities. |
| `helperPath` | package-owned executable | Absolute executable inside the signed helper `.app`; a bare binary fails with `NATIVE_APPLICATION_REQUIRED`. |
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
| `maxElements` / `maxDepth` | `2000` / `25` | Accessibility traversal limits. |
| `maxClickHoldMs` | `5000` | Maximum explicit click hold in milliseconds; accepts nonnegative integers. Zero only permits immediate release. |
| `dragDurationMs` / `dragSteps` | `400` / `20` | Duration and movement segments for a drag. |
| `textEventIntervalMs` | `0.25` | Delay after each Unicode down/up event, from 0 to 1000 ms. Chord timing is independent. |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-cua-macos) lists all fields. Native tool calls use `{method, params}`; the complete method-specific schema is exposed to the model. For example, `getApp` returns the `appHandle` needed by `listWindows`, `getState` and input operations.

Keypad names (`KP_0` through `KP_9`, `KP_Enter`, and keypad operators) retain their physical key codes. Key chords use `+` between modifiers and the key. Use `+` for the plus key, `cmd++` for Command-plus, or the key name `plus`; an unfinished chord such as `cmd+` is rejected.

Agent disposal and plugin unload cancel and await the complete tool call, including image admission and attachment storage. An image write already in progress must settle before disposal returns; a canceled call cannot return a successful screenshot.

Application consent is enforced before AX reads, window-title reads, screenshots, activation, and input through the CUA tool. The first selection asks the human for session access, denial, or saved access when profile persistence is available. Session access is stored by conversation and application identity and survives DSH restart and Computer Use disablement. Other conversations require their own consent. Application identities use the case-sensitive bundle identifier, so versions and copies at different paths share consent and revocation regardless of signing. A valid running bundle identifier remains sufficient when the operating system cannot supply an executable path. Available paths are still checked against the selected target; process-instance and window ownership checks remain mandatory. Without a bundle identifier, consent requires the canonical executable path. Restarting or updating at that path retains consent; moving or copying the executable to another path requires a new decision. This policy does not authenticate the publisher: another program declaring the same identifier, or replacing an approved executable at the same fallback path, inherits consent. Denial prevents repeated prompts in that session. Revocation reads and removes saved access in the same queue as grant creation, invalidates each affected Agent connection, and awaits its native cleanup without replaying input. Every app handle on those Agent connections becomes unusable; other applications need fresh selection, but their session and saved grants remain reusable. See the [application consent decision](../../../.agents/notes/implemented/architecture/2026-09-26-cua-application-consent.md). These checks govern CUA calls; persistent PTC and separately authorized shell tools are not an operating-system sandbox.

Raw `getState` exposes validated state fields and the complete text for the requested disclosure options. The native helper also returns structured element diagnostics for native checks; the tool projection omits that duplicate array from model text and structured tool values.

AX observations show menu-bar entries by default. Use `app.getAXState({ includeMenus: true })` to expand menu contents and `app.getAXState({ details: true })` for identifiers, global-point bounds and complete action names. These options also apply to raw `getState` and combined AX/screenshot observations. Every observation replaces that scope's indices; obtain fresh indices from the expanded output. Details do not bypass the configured node and depth limits. Truncation identifies the reached limit.

Values and placeholders are separate. Named, stateful or actionable groups and scroll areas retain their own rows. Repeated names, descriptions and help text on one node are shown once. Values, placeholders and URLs keep their distinct meanings even when their text matches; body text shared by distinct nodes remains intact. Writability is explicit on relevant controls, including `AXIncrementor`; `unknown` means the system did not report it. Missing optional state fields do not imply false. UTF-16 ranges outside the observed value are marked unavailable. Custom action aliases omit AppKit target/selector diagnostics; ambiguous aliases require a complete name from `details:true`.

Observations emit by default and also return their value. In persistent PTC, use `void await app.getAXState()` for one emitted copy, or `emit:false` and one explicit print. Capturing a screenshot after an emitted tree can fail independently; retain the successful AX output.

Screenshot diagnostics use `[cua-screenshot]` records keyed by the tool request ID. Native phase records return over the originating Agent connection and cover window/AX geometry checks, system capture, PNG/Base64 encoding and response writing. Host debug logs add dispatch, reply and cleanup timings. Each request retains at most 8192 bytes of complete diagnostic records, with explicit truncation; screenshot failures append these records to the error for Session export. Records contain stages, timings and error codes, not window titles, AX text or image bytes.

Native preparation serializes building and signing with a file lock. It retains complete applications under content-addressed `native/.build/prepared` directories and atomically selects a generation through `current.json`. Existing connections retain their application; identical builds reuse its files, and corrupted copies are rejected. Cancellation and failure finish managed process cleanup before releasing the lock.

### Connect an external execution environment

To run through persistent PTC, add `--patch packages/experimental/cua-macos/examples/persistent-ptc.cordis.yml` after the macOS overlay. This provider keeps variables for the live Agent and applies the selected file sandbox policy. The caller imports the bridge and supplies the current authorized `tools.cua` binding. Persistent PTC receives an installation-owned bridge file URL in its CUA instructions, so the project does not need to install this package. The example below is for an external host that resolves the package from its own installation and supplies `tools`; the package does not install a global object or keep variables alive:

```javascript
import { connectCua } from '@deepseek-ai/dsh-cua/bridge'
const cua = connectCua(() => tools.cua, text => console.log(text))
const app = await cua.getApp("com.apple.TextEdit")
void await app.getScreenshot()
```

Use app methods directly for single-window tasks. `getApp` reads initial AX state, so a screenshot needs no window enumeration or additional AX read. Use `app.getWindows()` and `app.getWindow(windowId)` when the task needs a particular window or default selection is ambiguous; choose by the observed title and bounds.

`getWindow` emits its initial AX tree. An owned window without an AX surface returns an empty snapshot and remains available for screenshots and coordinate input. Window objects retain separate snapshots, so reading one window does not invalidate another. Re-reading the same scope invalidates old indices. An AX node removed during observation rejects the read with `STALE_SNAPSHOT` and publishes no partial tree; read again without repeating the preceding input. App-scoped screenshots and coordinates reuse the latest AX observation: its focused on-screen, nonzero-size window, otherwise the sole such window. They do not query current focus again; read `app.getAXState()` to follow a focus change. Explicit window objects retain their selected target. Keyboard methods stay on `app` because input follows the app’s current focus.

`hover(target)` first reveals advertised AX alternate UI without moving the system cursor. Entering a revealed descendant preserves its parent UI, and leaving restores the default UI. When unavailable, hover moves the visible system cursor to an AX element center or window-local point without pressing a button, including over disabled controls. It requires the selected app to be foreground and the target point unobscured; otherwise `FOREGROUND_REQUIRED` requires explicit activation or raising and a fresh observation. Completion, AX reads and screenshots do not restore the previous point. Wait for the application’s hover delay, observe the revealed content, then hover into it and click; successive calls can visit intermediate points. Other input or application changes can interrupt the interaction. [Continuous-interaction rationale](../../../.agents/notes/implemented/architecture/2026-10-13-cua-continuous-hover.md).

`paste(text, { format: "text" | "html" })` temporarily publishes the requested clipboard format and invokes the application’s enabled standard Paste menu command. It keeps the temporary format until a pasteboard reader requests its data, then restores every captured original format while it still owns the clipboard, preserving a later copy. Paste operations share a cross-process lock and cancellation joins helper cleanup. A forced process exit can prevent restoration. Unsupported Paste commands fail without typing fallback; `typeText` remains separate key-event input.

`selectText` selects a unique literal occurrence or places the cursor before/after it through writable `AXSelectedTextRange`. Adjacent prefix/suffix disambiguate repeats. Selection preserves the remaining text and formatting, and verifies the resulting UTF-16 range; unsupported, missing, ambiguous or changed text fails without keyboard fallback. AX text includes `selectionWritable`, selection ranges and selected text when available.

Screenshot capture requires an attachment store and a resolved model route declaring image input. The shared attachment admission validates canonical Base64, the raster and its configured capacity, then stores the image once. Native data remains available to programmatic callers; model content carries coordinate metadata and the durable image reference. Response byte limits apply before parsing.

Absolute coordinates for hover, click, scroll and drag use pixels in the latest returned screenshot. Pass `relative: true` for integer thousandths of window width and height, from 0 to 999; omission or `false` uses pixels. Relative input can use a successful AX read or screenshot, while absolute input requires a screenshot. The Host maps the delivered image to native points, including attachment and model-request resizing. A value of 999 remains inside the window edge. Coordinate options do not apply to AX element indices. A width or height change since the latest observation returns `WINDOW_CHANGED` before input, including raw calls without a snapshot ID; read fresh AX or take a new screenshot before proceeding. Window movement alone preserves window-local coordinates. Capture and pointer input reject known disagreement between the selected window’s accessibility frame and displayed bounds with `WINDOW_CHANGED`, before posting pointer events. This includes Stage Manager transformations when AX retains the full window frame. Read fresh state; any activation or window raise remains explicit. Advertised AX actions remain available. Missing AX geometry retains the AXless path and does not establish that a transformed window can be operated.

Retained objects resolve the current tool binding on every call. The external runtime owns persistence, imports, cancellation and completion-value serialization. Screenshots return encoded bytes with their MIME type, pixel dimensions and window ID; the standard tool pipeline admits the image attachment exactly once. `emit: false` suppresses facade output only. A host that uses another dispatcher can build objects through `createCuaApi` from `./api`.

AppKit sheets are selectable by their window IDs and remain visible in their document window’s tree. Keyboard input follows a system Open/Save panel only when the application’s focused sheet identifies one Apple panel-service window and that service still focuses the same panel. Unrelated or ambiguous remote recipients fail before dispatch.

Indexed clicks support a single right/middle click or a single/double left click. Click and drag options accept a button and modifier keys; a modified click uses pointer input. Drags hold that button and carry its modifiers through every movement and release. AX text marks disabled controls, `valueWritable=true`, and available `selected` state. The helper uses an advertised accessibility action for unmodified clicks when available; pointer delivery resolves the element’s current bounds and verifies its owning window. Actions report dispatch, not application success. A visual pointer or click marker can be rendered independently of input; AX actions do not require moving the system cursor. Window-directed mouse input can still change application focus, selection or dialogs. Read state after input. `STALE_APP` requires acquiring the application again; `STALE_SNAPSHOT` requires a fresh AX read. Request timeout/cancellation waits for native acknowledgement and preserves usable handles. Missing cleanup acknowledgement closes that Agent’s connection. A screenshot RPC still awaiting its system callback occupies the single capture slot; further screenshots return `CAPTURE_BUSY`, while AX and input remain available. A late capture result is discarded, and its real completion releases that slot. Only an unresponsive operation or failed cleanup can invalidate the shared process and all its handles. Never retry uncertain input automatically. Closing an Agent releases its connection and AX references, without undoing changes to applications.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Dispatch and resource ownership</summary>

The object facade translates app/window methods into JSON operations. The bridge routes them through the normal tool pipeline, preserving authorization, nested logs and image admission. Agents and Hosts belonging to one user share a helper for the same native build. Each connection retains independent handles, snapshots, configuration and cancellation state; desktop operations use a global queue. The managed launcher transfers service lifetime to these connections, and the helper exits after the last connection finishes cleanup. Process locks cover both build identity and the real executable path, preventing duplicate startup and path collisions after a running executable is replaced. Native handles bind a process identity to its kernel start time, and snapshots retain native AX references only inside that helper. The same operation protocol can serve a future platform provider without adding platform logic to the object API.

[Zod operation definitions](../cua/src/protocol.ts) own model parameters and separately declare Host resource fields and private continuations. Public data types derive from those definitions. `pnpm exec tsx packages/experimental/cua-macos/native/generate-protocol.ts` generates the native JSON Schema and Swift field/enum admission tables; the package test lane checks freshness and rejects Host-only fields at model admission. Native target validation, resource limits and operation behavior remain enforced at execution.

[AX text formatting](native/Sources/CuaNative/AXTextFormatter.swift) consumes already-read node data. The AX walker alone assigns indices and retains native references, so formatting owns no second snapshot or target registry.

Native request IDs match the logged tool call IDs. Successful activation and window-raise results retain foreground request details and immediate before/after focus observations in the raw tool result. An already-frontmost app skips redundant activation; a window raise is skipped only when the exact window is also focused, main, unminimized and first among visible normal windows. Unknown observations retain the requested operation. These observations do not establish who caused an unrelated focus change or verify completion.

Node roles and metadata share one AX batch per observation. Group and scroll-area nodes contribute only children; unused metadata errors do not reject them. Unsupported batching retains individual attribute reads. AX traversal visits each native identity once, including proxy references that compare equal, so cyclic accessibility children cannot repeat whole subtrees. The [source manifest](native/upstream.json) records adapted upstream behavior and local Swift modules. AppKit runs on the main event loop; a separate serial executor owns AX references and synchronous input. A request retains exclusive execution through capture and response delivery. No invariant companion is published: there is no independently projected registry or durable evaluator state to reconcile. Protocol validation, target identity and resource cleanup are checked by their owning implementations.

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

The plugin contributes one `cua` operation tool with method-specific parameters. Standard PTC presentation exposes it as `tools.cua` through `run_code`. The following package-owned guidance is emitted verbatim:

##### Operation guidance (verbatim)

```markdown
用 cua 的 method getCapabilities 和 params {} 检查权限与 sessionLocked。sessionLocked 为 true，或某个操作报 SESSION_LOCKED 时，停止 UI 尝试并请用户解锁 macOS。sessionLocked 为 null 表示没有验证到可用的控制台会话。解锁后重新读取状态；锁屏桌面上的截图不是当前观测。用 listApps 或 cua.getState 发现运行中的应用，用 findApps(query) 按名称、bundle ID 或绝对路径搜索已安装的应用。getApp 在后台启动已停止的应用之前，或对运行中的应用做观测与输入之前，会请求用户同意。访问被拒绝或被撤销后，停止使用该应用，直到用户明确允许再一次授权请求。绝不换工具绕过拒绝。保留返回的 appHandle；每个应用操作都需要它。listWindows 返回窗口 ID 与点边界。raw getState 返回 AX 文本和 snapshotId。菜单栏条目默认显示；includeMenus=true 展开其内容。details=true 追加标识符、全局点边界和完整动作名。这两个选项同样适用于 getAXState。每次读取都会替换该应用/窗口范围内的索引。元素索引只能在那一个 snapshotId 下使用。raw 截图与坐标操作需要 windowId。坐标是最新返回截图里的像素，从它的左上角量起。改用 relative:true 表示 0 到 999 的整数千分比。Host 把两种模式都换算成原生窗口点；AX 详情边界仍是 macOS 全局点。通过验证的窗口也可能没有任何 AX 元素。它的空快照允许截图和坐标输入；元素索引动作需要一个来自新 AX 观测的元素。

在持久 PTC 中初始化一次对象 API。后续调用复用它提供的变量；把临时声明放进 { ... } 块，避免重复声明错误。所有对象方法都是 async。getAXState 返回文本，不是结构化的状态对象。该文本把值和占位符分开，并在可用时报告子角色、help、URL、禁用/聚焦/选中/展开状态和 UTF-16 选区范围。相关控件上的可写性是 true、false 或 unknown；省略的状态字段并不表示 false。selection=unavailable 表示所报告的范围超出了观测到的文本。紧凑输出省略普通的 Press/Pick（点击）、ShowMenu（右键）和 ScrollToVisible 动作；details=true 列出全部可用动作。把显示出来的动作名交给 performSecondaryAction 使用；有歧义的别名需要 details=true 里的完整名称。截断表示已到达 provider 上限。再次读取前收窄窗口或提高那一个 provider 上限。

单窗口任务直接用 app 方法；getApp 已经读取了初始 AX 状态。只有要指定某个窗口，或要消解窗口选择上的歧义时，才调用 app.getWindows() 并 await app.getWindow(windowId)。应用级截图和坐标动作使用最新的 AX 观测：它聚焦的、在屏的、尺寸非零的窗口，否则就是唯一这样的窗口。它们不会自动刷新焦点。要跟随焦点变化，读 app.getAXState()。

CuaScreenshot 为 { bytes: Uint8Array, mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif", pixelWidth: number, pixelHeight: number, windowId: number }。用 mimeType 选择文件扩展名或声明图片；不要假定它是 PNG。

对象 API 签名（options 默认为 { emit: true }）：

- cua.getCapabilities(options?) -> { platform, permissions, sessionLocked, methods, coordinateSpace, browser }
- cua.listApps(options?) -> Array<{ id, displayName, isRunning: true, pid }>
- cua.findApps(query: string, options?) -> Array<{ id, displayName, path, isRunning, pid? }>
- cua.getState(options?) -> { apps, browsers: [] }
- cua.getApp(selector: string) -> App
- app.activate() -> { dispatched: true, verified: false }
- app.getWindows(options?) -> Array<{ windowId, pid, appName, title, bounds, isOnScreen, onCurrentSpace }>
- app.getWindow(windowId: number) -> Window
- app.typeText(text: string), app.pressKey(chord: string) -> action result
- app.paste(text: string, options?: { format?: "text" | "html" }) -> action result

App 与 Window 方法：

- show() -> { dispatched: true, verified: false, windowId: number | null, foregroundChanged: boolean | null }
- getAXState(options?: { emit?: boolean, disableDiffing?: boolean, includeMenus?: boolean, details?: boolean }) -> string
- getScreenshot(options?: { emit?: boolean }) -> CuaScreenshot
- getAXStateAndScreenshot(options?) -> { state: string, screenshot: CuaScreenshot }
- hover(target: number | [x, y], options?: { relative?: boolean }) -> { dispatched, verified, hoverRoute, systemPointerMoved }
- click(target: number | [x, y], options?: { mouseButton?: "left" | "right" | "middle", clickCount?: 1 | 2, holdMs?: number, modifiers?: Array<"command" | "control" | "option" | "shift" | "fn">, relative?: boolean }) -> action result
- setValue(elementIndex: number, value: string) -> action result
- selectText(elementIndex: number, text: string, options?: { prefix?: string, suffix?: string, selectionType?: "text" | "cursor_before" | "cursor_after" }) -> action result
- performSecondaryAction(elementIndex: number, action: string) -> action result
- scroll({ x, y, deltaLinesX, deltaLinesY, relative? }) -> action result
- drag(from: [x, y], to: [x, y], options?: { mouseButton?: "left" | "right" | "middle", modifiers?: Array<"command" | "control" | "option" | "shift" | "fn">, relative?: boolean }) -> action result

raw 操作工具用 { method, params }，无参数方法也要给 params: {}。getApp 只选择应用，不激活它。让应用留在后台做观测和常规输入。不要在初始化时、每次动作之前、或仅仅因为另一个应用在前台就激活或提升某个应用。优先用应用声明出来的 AX 动作。窗口被隐藏或最小化时，先试 app.show() 或 window.show()，再读新状态。show 请求取消隐藏和取消最小化，但不激活、不提升、也不切换空间；它按显式指定、聚焦中、主窗口、唯一 AX 窗口的顺序选择窗口。windowId 为 null 表示没有选中任何窗口可供恢复。foregroundChanged 比较请求前后的前台应用和顶层窗口；null 表示不可用，延迟的焦点变化仍可能发生。如果不支持恢复，或窗口仍不可用（包括位于另一个空间或处于台前调度），说明所需的前台步骤，用 app.activate() 或声明的提升动作，再读新状态。需要前台访问时以完成任务为先。用户切走后避免反复激活；继续做能在后台完成的步骤，并报告哪些步骤需要前台访问。应用仍可能响应输入而改变焦点。

按顺序 await 每一个操作。输入之后重新读取状态以验证效果。动作成功只表示已派发，不表示已验证完成。取消可能留下部分效果；没有观测之前绝不重试不确定的输入。STALE_APP 需要重新 getApp；STALE_SNAPSHOT 需要重新 getState。绝对坐标输入需要该窗口的新截图。相对输入可以使用一次成功的 AX 观测或截图。SCREENSHOT_REQUIRED 表示用像素坐标前要先截取新截图。click 与 hover 的坐标目标必须是 [x, y]，例如 hover([650, 400], {relative:true})。像 hover(650) 这样的裸数字永远是 AX 元素索引。relative 选项只作用于坐标目标，不作用于 AX 索引。最新观测之后窗口尺寸被改变会拒绝坐标输入；只是移动窗口则保留窗口内坐标。WINDOW_CHANGED 要求重试前先取新状态；用声明的 AX 动作，或显式恢复该窗口，再做截图或坐标输入，然后重新观测。PERMISSION_DENIED 需要用户授予 macOS 辅助功能或屏幕录制所需的系统权限。授权之后先观测新状态再继续；不要自动重放先前的输入。

hover 先走应用声明出来的 AX 备用 UI，不移动系统光标，并把展开的后代保留到指针目标离开它们的区域。不可用时，它移动可见的系统光标但不按下任何按键；这条路径要求目标点在前台应用中未被遮挡。FOREGROUND_REQUIRED 需要显式激活或提升，并重新观测之后才能重试。移回、AX 读取和截图都不会恢复上一次的位置。等应用的悬停延迟过去，观测，再 hover 进入展开的控件之后才点击。中间点用连续的 hover 调用。结果里报告 hoverRoute 与 systemPointerMoved。其他输入或应用变化可能打断这次交互；app 对象在调用之间不占用应用。

只在声明了 selectionWritable 的控件上使用 selectText。它选中唯一一处字面量出现位置，或把光标放到它之前/之后；prefix 与 suffix 必须紧邻。AMBIGUOUS_TEXT 需要更多上下文；TEXT_NOT_FOUND 或 SELECTION_CHANGED 需要先重新观测再决定输入。左键支持单击/双击；右键和中键只支持单击。带修饰键的点击使用指针输入。可选的 holdMs 是每次按下（双击的每一次按下都算）的非负整数毫秒数。0 表示不再额外保持就释放。配置的最大值写在下文。即使目标是 AX 元素也走指针输入；省略则保持普通点击。操作期限仍然有效，取消或超时会释放按住的键。KP_0、KP_Enter 这类小键盘名称保留其物理键身份。Window 对象提供观测与指针/AX 动作；键盘输入仍属于 app 作用域，并跟随当前焦点。滚动增量是 -10 到 10 的整数行；正值显示上方或左侧的内容。Paste 通过应用已启用的标准 Paste 菜单命令送达纯文本或 HTML。Paste 跟随目标应用聚焦的文本输入。前台要求因应用而异；例如观察到的 ChatGPT/Codex 接受后台 Paste 而不读取剪贴板数据。PASTE_NOT_CONSUMED 表示命令已派发，但在配置的期限内没有观测到剪贴板读取。检查目标内容，显式激活应用并聚焦预期输入，再观测，然后决定是否重试；延迟的粘贴仍可能执行。剪贴板仍属于这次粘贴时，原有格式会被恢复；之后的复制会被保留。不支持的 Paste 命令直接失败，不会退回逐字输入。CLIPBOARD_CHANGED 表示有别的写入方介入；决定进一步输入前先观测。浏览器应用可以像其他原生应用一样用 getApp 控制；浏览器标签页不可用。已安装应用搜索覆盖标准 macOS 应用目录；其他位置请用绝对应用路径。启动不恢复窗口或文档，取消时应用可能已经启动。执行宿主必须安装对象 API 并负责变量持久化；本插件不预加载 cua 全局。在持久 PTC 中，先执行一次下面由宿主提供的初始化片段。它由安装目录提供的文件 URL 与项目目录无关。在调用之间保留 app 对象。观测方法默认 emit，同时也返回其值。用 void await app.getAXState() 避免 REPL 重复补全，或传 emit:false 后把返回的文本打印一次。截图调用以 void await app.getScreenshot() 或 void await app.getAXStateAndScreenshot() 结尾，这样图片字节不会被当作程序完成值序列化。
```

#### Token effect

Enabling the plugin adds a fixed schema and guidance. AX observations, operation results and admitted images add model input. Retained objects are not serialized into prompts by this package.

#### KV Cache effect

Tool results append to Session history. Changing plugin configuration or tool presentation can change the request prefix; retaining an app object does not change existing history.

## Known Limitations and Deferred Work

The queue orders individual native requests. Holding an app object does not reserve its application across a Session; [continuous interaction](../../../.agents/notes/implemented/architecture/2026-10-13-cua-continuous-hover.md) grants no cross-call ownership. Capture RPCs that never return occupy the single capture slot; creating new app objects does not reset that system connection.

<a id="known-limitations-and-deferred-work"></a>

- macOS 14 is the minimum supported version; settings navigation, drag acceptance, and permission refresh require qualification on each supported release. If macOS requires quitting and reopening the helper after a Screen Recording change, its preflight check can remain denied until that restart. The guide can be dismissed without terminating other connections.
- The guide closes when its selected settings window leaves the visible-window list, including when a Space switch or minimization removes it. Request permission again after returning to reopen the guide.
- Only the macOS native implementation is provided. Windows support is in development; this package remains in `experimental` until that support is complete, then moves to the `computer-use` group. Browser tabs, AX diffs, unassociated system panels and accessory-only apps are unsupported.
- Coordinates use the returned screenshot pixels, including the title bar; `relative: true` selects integers from 0 to 999. Native point conversion is Host-owned. Window movement, application changes and other desktop users can race observations and input.
- macOS Stage Manager can reduce background window bounds and screenshots to thumbnails. Full-window observation and coordinate input in this state are not guaranteed; model guidance requires explaining foreground needs and avoiding repeated focus reclamation.
- Background input depends on private SkyLight symbols; macOS updates can make them unavailable. Validate each target OS version.
- Observed failures include dispatched Unicode text not appearing in Blender and background Command+A not selecting all text in AppKit. Inspect application state after input; a successful tool result confirms dispatch only.
- Source builds default to `ad-hoc` and can require new grants after binary changes. The [developer’s fixed identity](../../../.agents/skills/dsh-cua-macos-signing/SKILL.md) lives outside DSH home; deleting DSH home removes its selection, not the certificate or private key. Release distribution needs a stable Developer ID signature and notarization; the build command accepts `--identity`, and installed packages preserve the distributed signature. The [permission page](../cua/README.md) offers helper authorization and target-application revocation.
- Release packaging does not automatically verify GUI startup, helper identity or exit cleanup. Release maintainers can run the [distribution smoke](native/README.md#build-and-service) on a logged-in Mac before publication; a successful package build does not establish those runtime results.
- Saved permission rows show the name, path and icon of one approved copy, not an inventory of every installation sharing its identity. Removing that copy can leave its icon unavailable. Revocation still applies to every copy with the same identity.
- If macOS does not expose a running application’s bundle identifier, the helper checks its reported bundle only when its executable matches the observed process path, then falls back to that path. Consent identity creation fails only when both the bundle identifier and actual executable path are unavailable; process-instance verification can still fail independently.
- Persistent PTC is an external dependency assumption, not an implementation in this package. Real-model task success requires separate evaluation beyond native and protocol fixtures.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
