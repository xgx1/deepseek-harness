/** Model-facing guidance enumerates the full available object API without unavailable operations. */
import { expect, it } from 'vitest'
import type { CuaApi, CuaApp, CuaSurface, CuaWindow } from '@deepseek-ai/dsh-cua/api'
import { COMMON_GUIDANCE, withSystemPointerGuidance } from '@deepseek-ai/dsh-cua/guidance'
import { GUIDANCE, PLATFORM_GUIDANCE, PROGRAM_GUIDANCE } from '../src/guidance.ts'

const apiNames: Array<keyof CuaApi> = ['getCapabilities', 'listApps', 'findApps', 'getState', 'getApp']
const accessibilityNames: Array<Exclude<keyof CuaSurface, 'sendKeyEvent'>> = [
  'getAccessibilityTree', 'listActions', 'invoke', 'performAction', 'setValue', 'selectText',
]
const appNames: Array<keyof CuaApp> = ['appHandle', 'activate', 'getWindows', 'getWindow']
const windowNames: Array<keyof CuaWindow> = ['windowId', 'getScreenshot', 'mouseMove', 'click', 'scroll', 'drag']

it('keeps file-tool instructions in PTC and limits the program guidance to available bindings', () => {
  for (const name of ['tools.write', 'tools.grep', 'tools.read']) {
    expect(GUIDANCE).toContain(name)
    expect(PROGRAM_GUIDANCE).not.toContain(name)
  }
  expect(PROGRAM_GUIDANCE).toContain('node:fs/promises')
  expect(PROGRAM_GUIDANCE).toContain('会话的文件工具')
})

it('keeps exactly three ordered operation headings', () => {
  const heads = COMMON_GUIDANCE.match(/^## .+$/gm)
  expect(heads).toEqual(['## 无障碍树', '## 模拟鼠标', '## 模拟键盘'])
  expect(COMMON_GUIDANCE.indexOf('## 无障碍树')).toBeLessThan(COMMON_GUIDANCE.indexOf('## 模拟鼠标'))
  expect(COMMON_GUIDANCE.indexOf('## 模拟鼠标')).toBeLessThan(COMMON_GUIDANCE.indexOf('## 模拟键盘'))
})

it('prefixes concise platform guidance before the shared catalog', () => {
  expect(GUIDANCE.startsWith(`${PLATFORM_GUIDANCE}\n\n用 cua`)).toBe(true)
  expect(PLATFORM_GUIDANCE).not.toContain('##')
})

it.each([GUIDANCE, PROGRAM_GUIDANCE])('explains when macOS mouse input needs a system-pointer prompt', (catalog) => {
  const instructions = withSystemPointerGuidance(catalog)
  expect(catalog.split('- mouseMove(')[0]).toContain('保持 useSystemPointer 不设置')
  expect(instructions).toContain('优先使用元素声明的无障碍动作、对可见控件的点击，或浏览器工具。')
  expect(instructions).toContain('这个询问会打断用户。')
  expect(instructions).toContain('省略该选项或传 false 会走默认的悬停路径，不会弹询问。')
  const drag = catalog.split('\n').find(line => line.startsWith('- drag('))
  expect(drag).toContain('useSystemPointer?: boolean')
  expect(drag).toContain('省略 useSystemPointer 或传 false 时，拖动直接发往窗口，不请求鼠标控制。')
  expect(COMMON_GUIDANCE).not.toContain('面向窗口的拖动')
})

it('states the macOS accessibility, keyboard, and mouse levels', () => {
  expect(PLATFORM_GUIDANCE).toContain('无障碍树操作在 app 或 window 层级可用')
  expect(PLATFORM_GUIDANCE).toContain('模拟键盘输入在 app 层级可用')
  expect(PLATFORM_GUIDANCE).toContain('模拟鼠标输入在 window 层级可用')
  const pressKey = GUIDANCE.split('\n').find(line => line.startsWith('- pressKey('))
  expect(GUIDANCE).toContain("sendKeyEvent(key: string, direction: 'down' | 'up')")
  expect(GUIDANCE).toContain('当本次程序返回、抛错，或用户暂停它时')
  const sharedKeyEvent = COMMON_GUIDANCE.split('\n').find(line => line.startsWith('- sendKeyEvent('))
  expect(sharedKeyEvent).toBeDefined()
  expect(GUIDANCE.split('\n').find(line => line.startsWith('- sendKeyEvent('))).toContain(sharedKeyEvent)
  expect(pressKey).toBe(COMMON_GUIDANCE.split('\n').find(line => line.startsWith('- pressKey(')))
  expect(GUIDANCE).toContain('W down、D down、D up、W up')
  const hover = GUIDANCE.split('\n').find(line => line.startsWith('- mouseMove('))
  for (const term of ['AXShowAlternateUI', 'AXShowDefaultUI', 'HOVER_UNAVAILABLE']) expect(hover).toContain(term)
  const click = GUIDANCE.split('\n').find(line => line.startsWith('- click('))
  expect(click).toContain('win.click(target)')
  expect(click).toContain('使用 app.invoke(id)')
  for (const step of ['先调用 app.activate()', '落在窗口之外', '截图像素', '先验证预期效果']) expect(click).toContain(step)
  for (const platformDetail of ['macOS', 'AXShowAlternateUI', 'AXRaise', 'HOVER_UNAVAILABLE', 'mouse-down']) {
    expect(COMMON_GUIDANCE).not.toContain(platformDetail)
  }
})

it('enumerates every available method once in its catalog entry', () => {
  const signatures = [
    ...apiNames.map(name => `cua.${name}(`),
    ...appNames.filter(name => name !== 'appHandle').map(name => `app.${name}(`),
    'app.show(', 'window.show(',
    ...accessibilityNames.map(name => `${name}(`),
    ...windowNames.filter(name => name !== 'windowId').map(name => `${name}(`),
    ...['typeText', 'paste', 'pressKey', 'sendKeyEvent'].map(name => `${name}(`),
  ]
  for (const catalog of [COMMON_GUIDANCE, GUIDANCE, PROGRAM_GUIDANCE]) {
    for (const signature of signatures) expect(catalog.split('\n').filter(line => line.startsWith(`- ${signature}`))).toHaveLength(1)
  }
  expect(signatures).toHaveLength(25)
  expect(new Set(signatures.map(signature => signature.slice(signature.indexOf('.') + 1, -1))).size).toBe(24)
  expect(COMMON_GUIDANCE).toContain('app.appHandle')
  expect(COMMON_GUIDANCE).toContain('window.windowId')
})

it('documents option fields and return fields', () => {
  for (const token of ['includeMenus', 'details', 'maxElements', 'maxDepth', 'relative', 'mouseButton', 'clickCount', 'holdMs', 'modifiers', 'format', 'prefix', 'suffix', 'selectionType']) expect(COMMON_GUIDANCE).toContain(token)
  for (const token of ['dispatched', 'foregroundChanged', 'hoverRoute', 'systemPointerMoved', 'path', 'width', 'height', 'windowId']) expect(COMMON_GUIDANCE).toContain(token)
})

it('inlines discovery, restoration, and mouse-move return records', () => {
  const lines = COMMON_GUIDANCE.split('\n')
  for (const name of ['cua.getCapabilities', 'cua.listApps', 'cua.findApps', 'cua.getState', 'app.getWindows', 'app.show', 'window.show', 'mouseMove']) {
    expect(lines.find(line => line.startsWith(`- ${name}(`))).toMatch(/ -> \(?\{ /)
  }
  expect(COMMON_GUIDANCE).toContain("{ platform: string, permissions: { accessibility: boolean, screenRecording: boolean }, appLevelAccessibility: boolean, systemPointer: boolean, keyboard: ('app' | 'window')[], sessionLocked: boolean | null, methods: string[], coordinateSpace: 'screenshot-pixels', browser: false }")
  expect(COMMON_GUIDANCE).toContain('{ id: string, displayName: string, isRunning: boolean, pid?: number }[]')
  expect(COMMON_GUIDANCE).toContain('{ id: string, displayName: string, path: string, isRunning: boolean, pid?: number }[]')
  expect(COMMON_GUIDANCE).toContain('getScreenshot() -> Image')
  expect(COMMON_GUIDANCE).toContain('bounds: { x: number, y: number, width: number, height: number }, isOnScreen: boolean, onCurrentSpace: boolean | null')
})

it('documents shared types while leaving Modifier members platform-defined', () => {
  const signatures = COMMON_GUIDANCE.split('\n').filter(line => line.startsWith('- ')).map(line => line.split(' — ')[0]).join('\n')
  const names = signatures.replace(/'[^']*'/g, '').match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []
  expect([...new Set(names)].sort()).toEqual(['ActionResult', 'App', 'Image', 'JsonValue', 'Modifier', 'Window'])
  expect(COMMON_GUIDANCE).toContain('ActionResult = { dispatched: boolean, foregroundChanged?: boolean | null }')
  expect(COMMON_GUIDANCE).toContain('JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }')
  expect(COMMON_GUIDANCE).toContain('App 是应用对象，含只读的 app.appHandle: string（不透明）')
  expect(COMMON_GUIDANCE).toContain('Window 是窗口对象，含只读的 window.windowId: string')
  expect(COMMON_GUIDANCE).toContain('签名展示的是 await 之后解析出的返回值')
})

it('references Modifier without defining its members in shared guidance', () => {
  const lines = COMMON_GUIDANCE.split('\n')
  for (const name of ['click', 'drag', 'pressKey']) {
    const entry = lines.find(line => line.startsWith(`- ${name}(`))
    expect(entry).toContain('modifiers?: Modifier[]')
    expect(entry).not.toContain('Modifier 的成员')
  }
  expect(PLATFORM_GUIDANCE).toContain('pressKey、click 与 drag 接受 command、control（或 ctrl）、option（或 alt）、shift 与 fn；pressKey 还接受 cmd 表示 command。')
  expect(COMMON_GUIDANCE).toContain('\n\n支持的修饰键名称取决于平台与操作，见平台指南。\n\n')
  expect(COMMON_GUIDANCE).not.toMatch(/(?:type|enum) Modifier\b|Modifier\s*=/)
  expect(COMMON_GUIDANCE).not.toContain('支持的修饰键：')
  expect(COMMON_GUIDANCE).toContain('按键名是平台定义的字符串')
})

it('states platform-dependent levels without qualifying grouped method names', () => {
  expect(COMMON_GUIDANCE).toContain('## 模拟鼠标\n截图与指针输入都要用显式指定的窗口。')
  for (const heading of ['无障碍树', '模拟键盘']) {
    expect(COMMON_GUIDANCE).toContain(`## ${heading}\n按平台不同，在 app 或 window 层级可用。`)
  }
  expect(GUIDANCE).not.toMatch(/\bsurface\b/)
  const groups = COMMON_GUIDANCE.slice(COMMON_GUIDANCE.indexOf('## 无障碍树'))
  expect(groups).not.toMatch(/^- (?:surface|window|app)\./m)
  expect(COMMON_GUIDANCE).toContain('target: string | [number, number]')
  expect(COMMON_GUIDANCE).toContain('from: [number, number]')
})

it('keeps consent, lock, observation, and no-replay rules', () => {
  expect(COMMON_GUIDANCE).toContain('同意')
  expect(COMMON_GUIDANCE).toContain('SESSION_LOCKED')
  expect(COMMON_GUIDANCE).toContain('没有新的观察就不要重放不确定的输入')
  expect(COMMON_GUIDANCE).toContain('操作后读取新状态')
  expect(COMMON_GUIDANCE).toContain('元素 ID 是取自最近一次成功树的不透明字符串')
  expect(COMMON_GUIDANCE).toContain('snapshotId')
})

it('prioritizes reported API availability over instruction text in the prologue', () => {
  const prologue = COMMON_GUIDANCE.split('\n\n')[0]
  expect(prologue).toContain('始终先用 cua.getCapabilities() 确认当前平台是否提供某个具体 API；它报告的可用性优先于本说明中的可用性表述。')
})

it('documents explicit inspection and separate key arguments', () => {
  expect(COMMON_GUIDANCE).toContain('调用 inspect(...values) 展示选定的观察结果。')
  expect(COMMON_GUIDANCE).toContain('不要拼成一个和弦字符串')
  expect(COMMON_GUIDANCE).toContain('做一次左键双击')
})

it('omits stale names and unavailable platform operations', () => {
  for (const stale of ['getAXState', 'emit', 'disableDiffing', 'performSecondaryAction', 'hover(', 'keyChord', 'window.typeText', 'window.pressKey', 'elementIndex', 'verified: false', 'browser tabs', 'not implemented']) expect(GUIDANCE).not.toContain(stale)
})
