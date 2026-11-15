/**
 * Host service that governs one project's skills and MCP tools through
 * `$DSH_HOME/agent-configs.yaml`.
 *
 * An agent is masked as soon as it is created: MCP tools whose server the
 * project's selection omits disappear from that agent's tool view, and the skill
 * filter reads the same document to decide the catalog. A project absent from
 * the document is not governed, so an unconfigured checkout keeps the plain
 * deployment behavior.
 *
 * @module @deepseek-ai/dsh-agent-config
 */

import { stat } from 'node:fs/promises'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
// Side-effect type imports: declare the agent-created and tools/change events.
import type {} from '@deepseek-ai/dsh-tools'
import {
  EMPTY_DOCUMENT, agentConfigsPath, mcpServersOf, readAgentConfigs, skillGlobsOf,
} from './config.js'
import type { AgentConfigsDocument } from './config.js'

export type { AgentConfigsDocument, AgentConfiguration } from './config.js'
export { agentConfigsPath, readAgentConfigs, writeAgentConfigs } from './config.js'

const MCP_TOOL_PREFIX = 'mcp__'

/**
 * Read the MCP server a public tool name belongs to.
 * @param toolName - model-facing tool name, `mcp__<server>__<tool>`.
 * @returns the server name, or undefined for a tool that no MCP server registered.
 */
function mcpServerOf(toolName: string): string | undefined {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return undefined
  const rest = toolName.slice(MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf('__')
  return separator === -1 ? undefined : rest.slice(0, separator)
}

/**
 * Service that resolves the document and enforces its MCP half per agent.
 * Skill enforcement lives in the skill filter, which reads the same document.
 */
export default class AgentConfigsService extends Service {
  static inject = ['tools']

  /** Last valid parse; kept so a transient bad write does not silently drop enforcement. */
  private cached: AgentConfigsDocument = EMPTY_DOCUMENT
  /** `mtime:size` of the file behind {@link cached}, so a step costs no re-read. */
  private stamp: string | undefined
  /** Agents this service governs, keyed by session id. */
  private readonly agents = new Map<string, Agent>()
  /** Lifts one agent's mask, keyed by session id. */
  private readonly masks = new Map<string, () => void>()
  /** Names each installed mask hides, so an unchanged selection is left alone. */
  private readonly masked = new Map<string, Set<string>>()
  /** Serializes refreshes so two tool changes cannot interleave restrictions. */
  private tail: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - host context of the plugin instance.
   */
  constructor(ctx: Context) {
    super(ctx, 'agentConfigs')
    ctx.effect(() => {
      const refresh = (): undefined => {
        void this.enqueue(() => this.refresh())
        return undefined
      }
      // A fresh agent and a late-registering MCP server both invalidate the mask.
      const disposers = [
        ctx.on('agent/created', ({ agent }) => {
          this.agents.set(agent.session.id, agent)
          return refresh()
        }),
        ctx.on('agent/disposed', ({ agent }) => {
          this.drop(agent.session.id)
          return undefined
        }),
        ctx.on('tools/change', refresh),
      ]
      return () => {
        for (const dispose of disposers) dispose()
        for (const lift of this.masks.values()) lift()
        this.masks.clear()
        this.masked.clear()
        this.agents.clear()
      }
    }, 'agent-configs enforcement')
  }

  /**
   * Read the document, falling back to the last valid parse.
   * @returns the resolved document.
   */
  async document(): Promise<AgentConfigsDocument> {
    const stamp = await this.fileStamp()
    if (stamp !== undefined && stamp === this.stamp) return this.cached
    try {
      this.cached = await readAgentConfigs()
      this.stamp = stamp
    } catch (error) {
      this.ctx.logger.warn('agent-configs: %s; keeping the previous document', error instanceof Error ? error.message : String(error))
    }
    return this.cached
  }

  /**
   * Skill allow globs governing one project.
   * @param cwd - absolute project working directory.
   * @returns the globs, or undefined when the project is not governed.
   */
  async skillGlobs(cwd: string | undefined): Promise<readonly string[] | undefined> {
    return skillGlobsOf(await this.document(), cwd)
  }

  private async fileStamp(): Promise<string | undefined> {
    try {
      const info = await stat(agentConfigsPath())
      return `${info.mtimeMs}:${info.size}`
    } catch {
      return undefined
    }
  }

  private enqueue(task: () => Promise<void>): Promise<unknown> {
    this.tail = this.tail.then(task, task)
    return this.tail
  }

  private drop(sessionId: string): void {
    this.agents.delete(sessionId)
    this.masks.get(sessionId)?.()
    this.masks.delete(sessionId)
    this.masked.delete(sessionId)
  }

  private async refresh(): Promise<void> {
    try {
      await this.recompute()
    } catch (error) {
      this.ctx.logger.warn('agent-configs: enforcement failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Bring every governed agent's mask in line with the current document. The
   * deny set comes from the unrestricted global view, so it is stable while a
   * mask is installed and an unchanged selection needs no reinstalling.
   */
  private async recompute(): Promise<void> {
    const document = await this.document()
    for (const agent of this.agents.values()) {
      const sessionId = agent.session.id
      const servers = mcpServersOf(document, agent.session.header.cwd)
      // MCP servers mount in whatever scope their composition entry declares, so
      // candidates come from the agent's own view; the names a live mask already
      // hides are unioned back in, because that view no longer reports them.
      const names = new Set<string>(this.masked.get(sessionId))
      for (const schema of this.ctx.tools.schemas(scopeOf(agent.ctx))) names.add(schema.name)
      const deny = servers === undefined
        ? []
        : [...names].filter((name) => {
          const server = mcpServerOf(name)
          return server !== undefined && !servers.has(server)
        })
      const previous = this.masked.get(sessionId)
      if (previous !== undefined && previous.size === deny.length && deny.every(name => previous.has(name))) continue
      this.masks.get(sessionId)?.()
      this.masks.delete(sessionId)
      this.masked.delete(sessionId)
      if (deny.length === 0) continue
      this.masks.set(sessionId, agent.ctx.tools.restrict({ deny }))
      this.masked.set(sessionId, new Set(deny))
    }
    const live = new Set([...this.agents.keys()])
    for (const sessionId of [...this.masks.keys()]) if (!live.has(sessionId)) this.drop(sessionId)
  }
}
