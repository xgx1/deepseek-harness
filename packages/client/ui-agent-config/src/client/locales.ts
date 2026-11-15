/**
 * `agentConfig` namespace dictionaries: the project agent-config chip and its
 * menu rows. Config names come from the Host document and stay verbatim.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.none': '配置：无',
  'chip.count': '配置：{count}',
  'chip.hint': '为这个项目选择技能与 MCP 配置',
  'option.summary': '{skills} 项技能 · {mcp} 个 MCP · {tools} 个工具',
} satisfies Record<string, string>

/** The agentConfig namespace key union. */
export type AgentConfigKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.none': 'Configs: none',
  'chip.count': 'Configs: {count}',
  'chip.hint': 'Choose the skill and MCP configs for this project',
  'option.summary': '{skills} skills · {mcp} MCP · {tools} tools',
} satisfies Record<AgentConfigKey, string>
