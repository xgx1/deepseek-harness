/** Platform setup guidance prefixed to the shared application and window instructions. */
import { COMMON_GUIDANCE } from '@deepseek-ai/dsh-cua/guidance'

/** macOS operation levels, permissions, selectors, and native measurement units. */
export const PLATFORM_GUIDANCE = 'macOS：无障碍树操作在 app 或 window 层级可用。模拟键盘输入在 app 层级可用。模拟鼠标输入在 window 层级可用。pressKey、click 与 drag 接受 command、control（或 ctrl）、option（或 alt）、shift 与 fn；pressKey 还接受 cmd 表示 command。要操作表单（sheet）上的指针输入，先用 app.getWindow(id) 选择它的窗口 ID。窗口之外的菜单项用 app.invoke(id)。findApps 搜索 /Applications、/System/Applications 与 ~/Applications。用 Computer Use 权限页在系统设置里给辅助应用授予「辅助功能」与「屏幕录制」权限。原生窗口与 AX 边界使用 macOS point，而交付的截图带有自己的像素尺寸。show 不会切换 Space，Stage Manager 也可能呈现被缩减的窗口几何；在调用 app.activate() 或执行元素声明的 AXRaise 动作之前，先说明需要的前台步骤。'

function operationGuidance(treeAdvice: string): string {
  const mouseGuidance = '普通的 mouseMove 与 drag 调用请保持 useSystemPointer 不设置，即使已经批准也一样。优先用 selectText 处理受支持的文本区间，用普通的面向窗口的拖动处理可拖动的控件。效果不明确时，先观察窗口再选择下一步动作。只有用户明确要求，或预期效果确实需要时，才请求系统指针。'
  const catalog = COMMON_GUIDANCE.replace('## 模拟鼠标\n', `## 模拟鼠标\n${mouseGuidance}\n\n`)
  const methodDetails = new Map<string, string>([
    ['cua.listApps', '每一行代表一个正在运行的进程。要在多个同名或同 bundle ID 的实例中选一个，把 String(row.pid) 传给 cua.getApp。'],
    ['cua.findApps', '运行中的已安装匹配项会带进程 ID；未运行的匹配项没有 pid。'],
    ['sendKeyEvent', "在一次程序里跨多次工具调用按住某个键时，先发送 'down'。例如 W down、D down、D up、W up。在物理键盘上按住一个键，延迟后会产生重复的按下事件。要给本次运行已经按住的非修饰键补发一次这样的重复，再发一次 'down'。每次调用只投递一个事件。控件可以过滤重复。用应用的响应来判断是否需要重发或松开。当本次程序返回、抛错，或用户暂停它时，macOS 只会把它仍然按住的键在原接收方处释放。"],
    ['getAccessibilityTree', `macOS 接受 maxElements 最大 100000、maxDepth 最大 512。若树被截断，下次读取时选更窄的窗口或提高所报告的上限。${treeAdvice} 只在该次观察仍然有效时使用文件里的元素 ID。`],
    ['mouseMove', '省略 useSystemPointer 或传 false 时，macOS 走无障碍悬停，不请求鼠标控制。这要求启用中的元素或其祖先同时支持 AXShowAlternateUI 与 AXShowDefaultUI。没有这条路径时，会在发送输入之前返回 HOVER_UNAVAILABLE。物理移动要求目标在前台且未被遮挡；说明必要的激活步骤，并重新观察目标。'],
    ['drag', '省略 useSystemPointer 或传 false 时，拖动直接发往窗口，不请求鼠标控制。显式的系统拖动与 mouseMove 共享同一次会话决策，并在未遮挡的前台窗口里沿路径按住选定的按钮。'],
    ['click', 'click 是 Window 方法：先用 const win = await app.getWindow(windowId) 选择窗口，再调用 win.click(target)。对后台控件的默认动作使用 app.invoke(id)；要对后台应用做鼠标点击，先调用 app.activate() 并重新读取目标。两种目标形式都会发送 mouse-down 与 mouse-up。click(id) 使用元素完整边界的中心；若该中心落在窗口之外，重新取 win.getScreenshot()，用截图像素对控件的可见部分调用 click([x, y])。后台应用即使 dispatched 为 true 也可能忽略这些事件；在输入或重试之前先验证预期效果，例如选中状态是否变化。'],
  ])
  return `${PLATFORM_GUIDANCE}

${catalog.replace(/^- ([\w.]+)\(.*$/gm, (entry, method: string) => {
  const detail = methodDetails.get(method)
  const signature = method === 'drag' ? entry.replace('relative?: boolean }', 'relative?: boolean, useSystemPointer?: boolean }') : entry
  return detail ? `${signature} ${detail}` : signature
})}`
}

/** Native PTC operation instructions with registered file tools for large observations. */
export const GUIDANCE = operationGuidance('在常驻 PTC 中，用 const tree = await win.getAccessibilityTree() 抓取一棵大树。在内存里过滤它的行，或用 await tools.write({ file_path: path, content: tree }) 存成新的工作区文件。用 tools.grep({ path, pattern }) 搜索内容，并用 tools.read 读取匹配行附近。用 inspect 展示你需要的匹配。')

/** CUA-only program instructions; other session tools remain outside the program. */
export const PROGRAM_GUIDANCE = operationGuidance('用 const tree = await win.getAccessibilityTree() 抓取一棵大树。在内存里过滤它的行，并用 inspect 展示你需要的匹配。必要时用 node:fs/promises 把它存成新的工作区文件，再用会话的文件工具搜索。')
