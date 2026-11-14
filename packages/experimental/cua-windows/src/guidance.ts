/** Platform setup guidance prefixed to the shared application and window instructions. */
import { COMMON_GUIDANCE } from '@deepseek-ai/dsh-cua/guidance'

/** Windows operation levels, application selectors, and input availability. */
export const PLATFORM_GUIDANCE = 'Windows：无障碍树操作只在 window 层级可用。模拟鼠标与模拟键盘输入都在 window 层级可用。支持的修饰键：ctrl、alt、shift、win。control 是 ctrl 的别名。'

const methodDetails = new Map<string, string>([
  ['cua.getApp', 'Windows 接受 listApps 返回的精确 AUMID，或一个已存在的绝对 .exe 路径，包括 listApps 里没有的可执行文件。显示名与 PID 不能作为替选选择器。选择沿用现有的应用同意流程，并且只在该应用未运行时才启动它。'],
  ['cua.findApps', 'Windows 上未实现。用 listApps 发现应用，或把一个已知的绝对 .exe 路径传给 getApp。'],
  ['getAccessibilityTree', '为这一次读取设定节点数或深度。Windows 接受 maxElements 从 1 到 10000、maxDepth 从 1 到 100。省略时使用提供方设置；maxDepth=1 只包含窗口根。若树被截断，选更窄的窗口或提高相应的上限。includeMenus 展开菜单内容。元素 ID 是 UI Automation 的 RuntimeId，格式为以斜杠分隔的整数字符串，例如 "12/345/6"。把完整字符串原样作为 elementId 传入。每个元素列出它支持的全部模式，而不是动作名。Disabled 是观察到的状态，不是禁止尝试操作的依据。'],
  ['listActions', '动作名是区分大小写的 Pattern.Action 形式，例如 "Invoke.Invoke"、"Toggle.Toggle"、"ExpandCollapse.Expand"。每个模式有一组已知的原生 UI Automation 操作，一个模式可以暴露多个动作。已知模式的操作可以直接用；需要确认暴露了哪些操作时再调用 listActions。查询类方法不会通过 performAction 暴露。'],
  ['invoke', '提供方会为已知模式选择默认动作。操作失败不会改用其它模式或模拟输入重试。'],
  ['performAction', '使用精确的 Pattern.Action 名称。无参数操作省略 argument 或传 null。单个参数按其直接 JSON 值传入；多个参数用它们的原生名字作为对象的键传入。枚举值用其精确名称字符串。例如：await win.performAction(id, "Value.SetValue", "hello"); await win.performAction(id, "Window.SetWindowVisualState", "Normal"); await win.performAction(id, "Transform.Resize", { width: 800, height: 600 })。'],
])

/** Native operation instructions; the shared Host adds guidance for declared capabilities. */
export const GUIDANCE = `${PLATFORM_GUIDANCE}

${COMMON_GUIDANCE.replace(/^- ([\w.]+)\(.*$/gm, (entry, method: string) => {
  const detail = methodDetails.get(method)
  if (!detail) return entry
  if (method === 'getAccessibilityTree') return `${entry.replace(/ — .*$/, '')} — ${detail}`
  return `${entry} ${detail}`
})}`
