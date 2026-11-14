/** Discover the caller's entire subagent tree; the control plugin owns registration. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ROOT_AGENT_NAME } from '@deepseek-ai/dsh-subagent'
import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'


type ListAgentsStatus = 'running' | 'inactive' | 'corrupt' | 'unsupported' | 'unavailable'

/** One model-facing tree member; unreadable branches report their failure as status. */
interface ListAgentsEntry {
  readonly name: string
  readonly status: ListAgentsStatus
  readonly description?: string
}

/** Report turn activity without exposing whether the child is loaded. */
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'inactive' {
  return agents.get(id)?.status === 'running' ? 'running' : 'inactive'
}

/** Project one service row into the model-facing entry, or omit a one-shot or external child. */
function project(
  agents: { get(id: SessionId): Agent | undefined },
  entry: SubagentDescendantListEntry,
): ListAgentsEntry | undefined {
  const name = entry.path ?? entry.id
  if (entry.kind === 'diagnostic') return { name, status: entry.reason }
  // One-shot children cannot be continued by send_message, so the model
  // never selects them; discovery still traversed them for descendants.
  if (entry.mode !== 'continuable') return undefined
  return { name, status: statusOf(agents, entry.id), description: entry.label }
}

/**
 * Register the `list_agents` tool.
 * @param ctx - context carrying the tool registry, subagent service, and live Agent registry.
 * @returns the registered definition for scoped availability checks.
 */
export function registerListAgents(ctx: Context): ToolDefinition {
  const definition = defineTool({
    name: 'list_agents',
    description:
      '列出你整棵 subagent 树：root agent 以及所有可达、可续接的后代，包括你自己。'
      + '每行带有名字、描述与状态。后代的 name 是它从 root 起的路径，例如 reviewer/checker。'
      + '你可以给树中任何其他 agent 发消息。'
      + 'running 表示它在工作；inactive 表示没有正在执行的轮次，不代表任务完成、成功或失败。'
      + 'corrupt、unsupported 或 unavailable 表示这一行自己的后代读不到；该行本身仍是'
      + '可以发消息的成员。'
      + '只要你仍然活跃，直接子 agent 完成时会通知你；无需反复查询它的状态。'
      + '用 send_message 继续对话。',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['running', 'inactive', 'corrupt', 'unsupported', 'unavailable'] },
            description: { type: 'string' },
          },
        },
      },
      render: (_args, entries) => [{
        type: 'text',
        text: entries.map(entry =>
          `${entry.name} [${entry.status}]${entry.description === undefined ? '' : ` — ${entry.description}`}`,
        ).join('\n'),
      }],
    },
    async execute(_args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers have no session whose children could be listed.
        throw new Error('list_agents requires a calling agent (exec.agent was undefined)')
      }
      const root = ctx.subagents.rootOf(parent)
      const entries = await ctx.subagents.listDescendants(root.id, exec.signal)
      return [
        { name: ROOT_AGENT_NAME, status: statusOf(ctx.agents, root.id), description: 'root agent' },
        ...entries
          .map(entry => project(ctx.agents, entry))
          .filter(entry => entry !== undefined),
      ]
    },
  })
  ctx.tools.register(definition)
  return definition
}
