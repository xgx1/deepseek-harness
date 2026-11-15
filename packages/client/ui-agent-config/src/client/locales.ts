/**
 * \`agentConfig\` namespace dictionaries: the project agent-config chip, its menu
 * rows, and the catalog overview on the General settings page. Config names come
 * from the Host document and stay verbatim.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.none': '配置：无',
  'chip.count': '配置：{count}',
  'chip.hint': '为这个项目选择技能与 MCP 配置',
  'option.summary': '{skills} 项技能 · {mcp} 个 MCP · {tools} 个工具',
  'overview.title': '技能 / MCP / 工具配置',
  'overview.source': '来源：{path}',
  'overview.configs': '{count} 个配置',
  'overview.projects': '{count} 个项目',
  'overview.counts': '{skills} 项技能 · {mcp} 个 MCP · {tools} 个工具',
  'overview.selected': '选中：{names}',
  'overview.unlisted': '未列入的项目不加载任何技能与 MCP，也不允许任何工具。',
  'overview.empty': '没有读到配置文档。',
  'overview.skills': '技能',
  'overview.mcp': 'MCP',
  'overview.tools': '工具',
} satisfies Record<string, string>

/** The agentConfig namespace key union. */
export type AgentConfigKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.none': 'Configs: none',
  'chip.count': 'Configs: {count}',
  'chip.hint': 'Choose the skill and MCP configs for this project',
  'option.summary': '{skills} skills · {mcp} MCP · {tools} tools',
  'overview.title': 'Skills / MCP / tools configuration',
  'overview.source': 'Source: {path}',
  'overview.configs': '{count} configs',
  'overview.projects': '{count} projects',
  'overview.counts': '{skills} skills · {mcp} MCP · {tools} tools',
  'overview.selected': 'Selected: {names}',
  'overview.unlisted': 'A project that is not listed loads no skill and no MCP server, and allows no tool.',
  'overview.empty': 'No configuration document could be read.',
  'overview.skills': 'Skills',
  'overview.mcp': 'MCP',
  'overview.tools': 'Tools',
} satisfies Record<AgentConfigKey, string>
