/** Shared model instructions for native application and window operations. */
const hoverSignature = 'mouseMove(target: string | [number, number], options?: { relative?: boolean })'

/** System-prompt section that carries the CUA operation guidance for one Agent. */
export const CUA_PROMPT_SECTION_NAME = 'computer-use:dsh-cua'

/** Async method catalog with consent and observation rules, grouped by observation, mouse, and keyboard. */
export const COMMON_GUIDANCE = `用 cua 观察并操作原生应用。始终先用 cua.getCapabilities() 确认当前平台是否提供某个具体 API；它报告的可用性优先于本说明中的可用性表述。所有方法都是异步的。操作只报告「已派发」的证据，不代表效果已被验证。若 sessionLocked 为 true，或某次操作返回 SESSION_LOCKED，立即停止界面操作并请用户解锁桌面会话；返回 null 或未知时，先确认存在可用且已解锁的桌面会话。cua.getApp 会请求用户同意；若访问被拒绝或撤销，在该用户明确允许新请求之前停止使用这个应用，绝不要绕过拒绝，也不要换用其它工具来规避。没有新的观察就不要重放不确定的输入。

调用 inspect(...values) 展示选定的观察结果。

签名展示的是 await 之后解析出的返回值。ActionResult = { dispatched: boolean, foregroundChanged?: boolean | null }；未采样时省略 foregroundChanged，采样不可用时为 null。JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }；数字必须是有限值。App 是应用对象，含只读的 app.appHandle: string（不透明），以及下面列出的 app 层级方法。Window 是窗口对象，含只读的 window.windowId: string，以及下面列出的 window 层级方法。窗口 ID 是提供方发放的不透明字符串，必须原样保留。

支持的修饰键名称取决于平台与操作，见平台指南。

准备与发现：
- cua.getCapabilities() -> { platform: string, permissions: { accessibility: boolean, screenRecording: boolean }, appLevelAccessibility: boolean, systemPointer: boolean, keyboard: ('app' | 'window')[], sessionLocked: boolean | null, methods: string[], coordinateSpace: 'screenshot-pixels', browser: false } — 在不请求任何权限的前提下检查它报告的 permissions、sessionLocked、methods 与 keyboard 作用域。
- cua.listApps() -> { id: string, displayName: string, isRunning: boolean, pid?: number }[] — 列出提供方可选的应用及其当前运行状态；把返回的 id 原样传给 cua.getApp。
- cua.findApps(query: string) -> { id: string, displayName: string, path: string, isRunning: boolean, pid?: number }[] — 搜索已安装应用，包含未运行的匹配项。
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
- getAccessibilityTree(options?: { includeMenus?: boolean, details?: boolean, maxElements?: number, maxDepth?: number }) -> string — 为这一次读取设定节点数或深度上限。省略时使用提供方设置。includeMenus 展开菜单内容，details 附加标识符、原生边界与完整动作名。
- listActions(elementId: string) -> string[] — 列出元素声明的动作。
- invoke(elementId: string) -> ActionResult — 调用元素的默认动作；元素没有默认动作时 dispatched 为 false。
- performAction(elementId: string, action: string, argument?: JsonValue) -> ActionResult — 执行一个观察到的动作，可带一个直接 JSON 参数。
- setValue(elementId: string, value: JsonValue) -> ActionResult — 写控件的值。
- selectText(elementId: string, text: string, options?: { prefix?: string, suffix?: string, selectionType?: 'text' | 'cursor_before' | 'cursor_after' }) -> ActionResult — 选中某一次字面出现，或把光标放到它旁边，用相邻上下文消除歧义。

## 模拟鼠标
截图与指针输入都要用显式指定的窗口。在做坐标输入（包括相对坐标）之前，先取得覆盖该窗口的一次成功的 getAccessibilityTree 观察，或截取该窗口的截图。绝对像素坐标要求先有返回的截图。
- getScreenshot() -> Image — 把选定的窗口截成一张存储图片，含只读的 attachmentId、path、width、height。把选中的截图传给 inspect(...values) 展示；窗口 ID 从 window.windowId 取。
- ${hoverSignature} -> { dispatched: boolean, foregroundChanged?: boolean | null, hoverRoute: 'accessibility' | 'system-pointer', systemPointerMoved: boolean } — 请求把鼠标移到目标处而不按键；检查 hoverRoute 与 systemPointerMoved，并且不要指望指针会自动复位。
- click(target: string | [number, number], options?: { mouseButton?: 'left' | 'right' | 'middle', clickCount?: 1 | 2, modifiers?: Modifier[], holdMs?: number, relative?: boolean }) -> ActionResult — 点击元素 ID 或坐标点，或做一次左键双击；holdMs 控制每次按压的时长。
- scroll(options: { x: number, y: number, deltaLinesX: number, deltaLinesY: number, relative?: boolean }) -> ActionResult — 在某点滚动；增量为 -10 到 10 的整数且至少一个非零，正值显示上方或左侧的内容。
- drag(from: [number, number], to: [number, number], options?: { mouseButton?: 'left' | 'right' | 'middle', modifiers?: Modifier[], relative?: boolean }) -> ActionResult — 在同一窗口的两点之间拖动。

字符串目标是元素 ID；坐标目标是 [x, y]，默认是最近一次返回截图上的像素。带 relative: true 时，它们是 0 到 999 的整数千分数，基准是窗口的宽与高，取值来自当前 AX 观察或截图。左键支持一次或两次按压；右键与中键只支持一次。FOREGROUND_REQUIRED 表示先解释为什么需要前台，再显式激活目标并重新观察；激活永远不会自动发生。操作后读取新状态，并把 WINDOW_CHANGED、STALE_SNAPSHOT、SCREENSHOT_REQUIRED 视为必须先做所要求的新观察或新截图，然后才能重试。

## 模拟键盘
按平台不同，在 app 或 window 层级可用。
- typeText(text: string) -> ActionResult — 在应用当前焦点处输入字面文本；行尾会发送 Return，制表符会发送 Tab。
- paste(text: string, options?: { format?: 'text' | 'html' }) -> ActionResult — 通过应用的「粘贴」命令投递文本或 HTML，并在结束后恢复原先的剪贴板内容（除非另一写入方改动了它）；粘贴失败会直接报出，不会改用 typeText 顶替；PASTE_NOT_CONSUMED 表示重试之前先观察。
- pressKey(key: string, modifiers?: Modifier[]) -> ActionResult — 按下并释放一次完整按键。例如 pressKey('Tab', ['shift']) 或 pressKey('+')。按键名是平台定义的字符串。键与修饰键分开传，不要拼成一个和弦字符串。
- sendKeyEvent(key: string, direction: 'down' | 'up') -> ActionResult — 发送一次按下或抬起事件；key 接受单个按键名，修饰键也算。

原生工具使用 { method, params }：app 调用要带 appHandle，window 调用要带 windowId，元素路由要用 snapshotId 配 elementId。getAccessibilityTree 对应 getState；getWindow 没有原生方法；getWindows 对应 listWindows；getScreenshot 对应 screenshot；cua.getState 对应 listApps；其余命名操作使用同名方法。`

/**
 * Describe the system-pointer option for a provider that declares the capability.
 * @param guidance Provider instructions including the shared operation catalog.
 * @returns The capability-specific signature and permission instructions.
 */
export function withSystemPointerGuidance(guidance: string): string {
  const signature = 'mouseMove(target: string | [number, number], options?: { relative?: boolean, useSystemPointer?: boolean })'
  return `${guidance.replace(hoverSignature, signature)}

只有在不动用户指针就无法完成任务时，才调用 await win.mouseMove(target, { useSystemPointer: true })。优先使用元素声明的无障碍动作、对可见控件的点击，或浏览器工具。这个询问会打断用户。审批被禁用时，显式移动可以立即生效。即使已经批准，每一次物理移动也都要传 true。省略该选项或传 false 会走默认的悬停路径，不会弹询问。批准或拒绝一直有效，直到本会话关闭或 DSH 重启。拒绝不会发送任何输入。用户关掉询问时，只有在他们主动要求时才再问一次。等未完成的请求结束。subagent 不能请求物理移动。`
}
