/** macOS operation guidance supplied with the shared CUA object API. */
/** Instructions for raw operation calls and optional object-API bindings. */
export const GUIDANCE = `用 cua 的 method getCapabilities 和 params {} 检查权限与 sessionLocked。sessionLocked 为 true，或某个操作报 SESSION_LOCKED 时，停止 UI 尝试并请用户解锁 macOS。sessionLocked 为 null 表示没有验证到可用的控制台会话。解锁后重新读取状态；锁屏桌面上的截图不是当前观测。用 listApps 或 cua.getState 发现运行中的应用，用 findApps(query) 按名称、bundle ID 或绝对路径搜索已安装的应用。getApp 在后台启动已停止的应用之前，或对运行中的应用做观测与输入之前，会请求用户同意。访问被拒绝或被撤销后，停止使用该应用，直到用户明确允许再一次授权请求。绝不换工具绕过拒绝。保留返回的 appHandle；每个应用操作都需要它。listWindows 返回窗口 ID 与点边界。raw getState 返回 AX 文本和 snapshotId。菜单栏条目默认显示；includeMenus=true 展开其内容。details=true 追加标识符、全局点边界和完整动作名。这两个选项同样适用于 getAXState。每次读取都会替换该应用/窗口范围内的索引。元素索引只能在那一个 snapshotId 下使用。raw 截图与坐标操作需要 windowId。坐标是最新返回截图里的像素，从它的左上角量起。改用 relative:true 表示 0 到 999 的整数千分比。Host 把两种模式都换算成原生窗口点；AX 详情边界仍是 macOS 全局点。通过验证的窗口也可能没有任何 AX 元素。它的空快照允许截图和坐标输入；元素索引动作需要一个来自新 AX 观测的元素。

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

只在声明了 selectionWritable 的控件上使用 selectText。它选中唯一一处字面量出现位置，或把光标放到它之前/之后；prefix 与 suffix 必须紧邻。AMBIGUOUS_TEXT 需要更多上下文；TEXT_NOT_FOUND 或 SELECTION_CHANGED 需要先重新观测再决定输入。左键支持单击/双击；右键和中键只支持单击。带修饰键的点击使用指针输入。可选的 holdMs 是每次按下（双击的每一次按下都算）的非负整数毫秒数。0 表示不再额外保持就释放。配置的最大值写在下文。即使目标是 AX 元素也走指针输入；省略则保持普通点击。操作期限仍然有效，取消或超时会释放按住的键。KP_0、KP_Enter 这类小键盘名称保留其物理键身份。Window 对象提供观测与指针/AX 动作；键盘输入仍属于 app 作用域，并跟随当前焦点。滚动增量是 -10 到 10 的整数行；正值显示上方或左侧的内容。Paste 通过应用已启用的标准 Paste 菜单命令送达纯文本或 HTML。Paste 跟随目标应用聚焦的文本输入。前台要求因应用而异；例如观察到的 ChatGPT/Codex 接受后台 Paste 而不读取剪贴板数据。PASTE_NOT_CONSUMED 表示命令已派发，但在配置的期限内没有观测到剪贴板读取。检查目标内容，显式激活应用并聚焦预期输入，再观测，然后决定是否重试；延迟的粘贴仍可能执行。剪贴板仍属于这次粘贴时，原有格式会被恢复；之后的复制会被保留。不支持的 Paste 命令直接失败，不会退回逐字输入。CLIPBOARD_CHANGED 表示有别的写入方介入；决定进一步输入前先观测。浏览器应用可以像其他原生应用一样用 getApp 控制；浏览器标签页不可用。已安装应用搜索覆盖标准 macOS 应用目录；其他位置请用绝对应用路径。启动不恢复窗口或文档，取消时应用可能已经启动。执行宿主必须安装对象 API 并负责变量持久化；本插件不预加载 cua 全局。在持久 PTC 中，先执行一次下面由宿主提供的初始化片段。它由安装目录提供的文件 URL 与项目目录无关。在调用之间保留 app 对象。观测方法默认 emit，同时也返回其值。用 void await app.getAXState() 避免 REPL 重复补全，或传 emit:false 后把返回的文本打印一次。截图调用以 void await app.getScreenshot() 或 void await app.getAXStateAndScreenshot() 结尾，这样图片字节不会被当作程序完成值序列化。`
