/** Conditionally available task-board tools and guidance for Agent Teams. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import type { TeamTaskId, TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the Team tool plugin. */
export const inject = ['agentTeams', 'subagents', 'tools', 'systemPrompt']

/** The Team tool plugin takes no configuration. */
export type Config = Record<never, never>

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({})

/** Configuration keys removed when Team reused subagent creation and messaging. */
const REMOVED_CONFIG_KEYS = ['interrupt', 'freshProvider', 'forkProvider'] as const

/** Model-facing collaboration guidance shared by Lead and teammates. */
const TEAM_POLICY = `本会话启用了 Agent Teams。

团队负责人与所有队友共享同一个工作目录与文件系统，任何成员的编辑对所有人立即可见。把写入工作拆成互不重叠的范围，把预期的写入范围记录在共享任务上，工作必须按序时用任务依赖表达。写入范围重叠只是提示性的，不是锁。

分配或筛选共享任务时，用 subagent、subagent_fork 或 list_agents 返回的名字作为 owner。root 可以把任务重新分配给自己或任何可继续的后代 agent；其它 agent 自己认领已就绪的任务。共享任务的工作流是：list、带当前 revision 的 get、claim，然后执行，最后 complete。任务就绪不会启动负责人。root agent 必须等必需的队友完成后再给出最终答复。

任务变动不会结束 wait_agent 调用、不会新增收件箱消息、也不会启动空闲 agent。需要另一个 agent 对某个任务采取行动时，用 send_message。`

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    owner: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** One task as the model sees it: the owner's Session id is replaced by its agent name. */
type NamedTaskView = Omit<TeamTaskView, 'ownerId' | 'ownerName'> & { readonly owner?: string }

/** Recover the exact caller guaranteed by conditional Team-tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- The Team condition rejects callers without an Agent before execution. */
  if (agent === undefined) throw new ToolContextUnavailableError(`${toolName} requires a calling Agent`)
  return agent
}

/**
 * Register Team tools and guidance selected by each caller's root Session mode.
 * @param ctx - context carrying Team, subagent, tool, and system prompt services.
 * @param config - the empty plugin configuration; removed keys fail at load.
 */
export function apply(ctx: Context, config: Config = {}): void {
  for (const key of REMOVED_CONFIG_KEYS) {
    if (Object.hasOwn(config, key)) {
      throw new Error(`tool-agent-team: ${key} is no longer supported; create teammates with a subagent tool`)
    }
  }
  const withOwnerName = ({ ownerId, ownerName, ...task }: TeamTaskView): NamedTaskView =>
    ownerId === undefined ? task : { ...task, owner: ownerName ?? ownerId }
  const enabled = (agent: Agent | undefined): boolean => {
    if (agent === undefined) return false
    try {
      return ctx.agentTeams.isEnabled(agent)
    } catch (error: unknown) {
      if (!(error instanceof SubagentError) || error.code !== 'UNAUTHORIZED') throw error
      // An independently resumed child has no active root to supply Team mode.
      return false
    }
  }
  ctx.systemPrompt.section({
    name: 'team:policy',
    order: ctx.systemPrompt.getSectionOrder('TEAM_POLICY'),
    text: ({ agent }) => enabled(agent) ? TEAM_POLICY : '',
  })
  ctx.tools.register(defineTool({
    name: 'team_task_create',
    description: 'Create one unowned pending task on the shared Team task board.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Concise task title.' },
      description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
      blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
      write_scopes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
      },
    },
    output: jsonOutput(TASK_VIEW_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'team_task_create')
      const task = await ctx.agentTeams.createTask(caller, {
        subject: args.subject,
        description: args.description,
        ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(brandString<TeamTaskId>) },
        ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
      }, exec.signal)
      return withOwnerName(task)
    },
  }), { when: ({ agent }) => enabled(agent) })

  ctx.tools.register(defineTool({
    name: 'team_task_list',
    description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
    parameters: {
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
        description: 'Optional exact status filter.',
      },
      owner: { type: 'string', description: 'Optional owner agent name filter; cannot be combined with unowned.' },
      unowned: { type: 'boolean', description: 'Filter tasks by whether they have no owner; cannot be combined with owner.' },
      ready: { type: 'boolean', description: 'Optional readiness filter.' },
      cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
      limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
    },
    output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
    // Board reads project the Team Lead journal without appending to it.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cursor = args.cursor ?? 0
      const limit = args.limit ?? 50
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new ToolArgsError(['cursor must be a non-negative safe integer'])
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ToolArgsError(['limit must be an integer from 1 through 100'])
      const caller = callingAgent(exec.agent, 'team_task_list')
      if (args.owner !== undefined && args.unowned !== undefined) throw new ToolArgsError(['owner and unowned filters cannot be combined'])
      const owner = args.owner === undefined
        ? undefined
        : await ctx.subagents.resolveName(caller, args.owner, exec.signal)
      const filtered = ctx.agentTeams.listTasks(caller).filter(task =>
        (args.status === undefined || task.status === args.status)
        && (owner === undefined || task.ownerId === owner)
        && (args.unowned === undefined || (task.ownerId === undefined) === args.unowned)
        && (args.ready === undefined || task.ready === args.ready))
      const page = filtered.slice(cursor, cursor + limit)
      return {
        tasks: page.map(withOwnerName),
        ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
      }
    },
  }), { when: ({ agent }) => enabled(agent) })

  ctx.tools.register(defineTool({
    name: 'team_task_get',
    description: 'Read the complete latest value of one shared task before changing or executing it.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Shared task id.' },
    },
    output: jsonOutput(TASK_VIEW_SCHEMA),
    // Board reads project the Team Lead journal without appending to it.
    isConcurrencySafe: () => true,
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'team_task_get')
      const task = ctx.agentTeams.getTask(caller, brandString<TeamTaskId>(args.task_id))
      return Promise.resolve(withOwnerName(task))
    },
  }), { when: ({ agent }) => enabled(agent) })

  ctx.tools.register(defineTool({
    name: 'team_task_update',
    description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Shared task id.' },
      expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
      action: {
        type: 'string',
        required: true,
        enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
        description: 'Task transition to apply.',
      },
      subject: { type: 'string', description: 'Replacement title for edit.' },
      description: { type: 'string', description: 'Replacement details for edit.' },
      blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
      write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
      owner: { type: 'string', description: 'Agent name of the root or any continuable descendant for root-only reassign; omit to unassign.' },
    },
    output: jsonOutput(TASK_VIEW_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'team_task_update')
      const taskId = brandString<TeamTaskId>(args.task_id)
      const task = await ctx.agentTeams.updateTask(caller, {
        taskId,
        expectedRevision: args.expected_revision,
        action: args.action,
        ...args.subject === undefined ? {} : { subject: args.subject },
        ...args.description === undefined ? {} : { description: args.description },
        ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(brandString<TeamTaskId>) },
        ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        ...args.owner === undefined ? {} : { owner: await ctx.subagents.resolveName(caller, args.owner, exec.signal) },
      }, exec.signal)
      return withOwnerName(task)
    },
  }), { when: ({ agent }) => enabled(agent) })
}
