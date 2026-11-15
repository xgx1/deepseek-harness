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
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Side-effect type imports: declare the agent-created and tools/change events,
// and the mcpResources service the suppression goes through.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-mcp-resources'
import {
  EMPTY_DOCUMENT, agentConfigsPath, mcpServersOf, readAgentConfigs, selectionOf, skillGlobsOf,
  writeAgentConfigs,
} from './config.js'
import type { AgentConfigsDocument } from './config.js'
import type { AgentConfigRequest, AgentConfigSelectionView, AgentConfigWrite } from './types.js'

export type { AgentConfigsDocument, AgentConfiguration } from './config.js'
export type {
  AgentConfigRequest, AgentConfigSelectionView, AgentConfigView, AgentConfigWrite,
} from './types.js'
// Config file access stays on the `./config` subpath: a plugin entry exports only what the loader reads.

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `agentConfigs` Remote namespace. */
    agentConfigs: AgentConfigsService
  }
}

/**
 * Project the document into the browser-safe roster and selection view.
 * @param document - parsed home document.
 * @param cwd - absolute project working directory.
 * @returns the roster with this project's selection.
 */
function viewOf(document: AgentConfigsDocument, cwd: string): AgentConfigSelectionView {
  return {
    configs: Object.entries(document.configs).map(([name, config]) => ({
      name,
      skills: config.skills,
      mcp: config.mcp,
    })),
    selected: selectionOf(document, cwd) ?? [],
  }
}

/** Message of an unknown throwable. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
export default class AgentConfigsService extends TypertRemoteService {
  static inject = ['tools', 'typert', 'mcpResources']

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
  /** Lifts one agent's prompt suppression, keyed by session id. */
  private readonly suppressors = new Map<string, () => void>()
  /** Servers each suppression hides, so an unchanged profile is left alone. */
  private readonly suppressed = new Map<string, Set<string>>()
  /** Serializes refreshes so two tool changes cannot interleave restrictions. */
  private tail: Promise<unknown> = Promise.resolve()
  /** True while this plugin mutates masks, so its own `tools/change` cannot reschedule a refresh. */
  private applying = false
  /** True while a refresh is already queued, so a change storm coalesces into one recompute. */
  private refreshQueued = false

  /**
   * @param ctx - host context of the plugin instance.
   */
  constructor(ctx: Context) {
    super(ctx, 'agentConfigs', { namespace: 'agentConfigs' })
    ctx.effect(() => {
      const refresh = (): undefined => {
        // Both guards keep recompute from rescheduling itself: mask mutation emits
        // `tools/change` synchronously, and a queued refresh already reads the
        // state a second queued one would read, so the queue must stay bounded.
        if (this.applying || this.refreshQueued) return undefined
        this.refreshQueued = true
        void this.enqueue(() => {
          this.refreshQueued = false
          return this.refresh()
        })
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
        for (const lift of this.suppressors.values()) lift()
        this.masks.clear()
        this.masked.clear()
        this.suppressors.clear()
        this.suppressed.clear()
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
   * Read every declared config and the selection governing one project.
   * @param request - the project working directory.
   * @returns the roster with this project's selection, or the parse error that hid it.
   */
  @Remote
  async getSelection(request: AgentConfigRequest): Promise<AgentConfigSelectionView> {
    try {
      return viewOf(await readAgentConfigs(), request.cwd)
    } catch (error: unknown) {
      return { configs: [], selected: [], error: messageOf(error) }
    }
  }

  /**
   * Replace one project's selection and re-enforce every live agent.
   * @param write - the project working directory and the complete replacement selection.
   * @returns the selection as persisted.
   * @throws RemoteError `agent-configs/rejected` when a name is undeclared or the file is unwritable.
   */
  @Remote
  async setSelection(write: AgentConfigWrite): Promise<AgentConfigSelectionView> {
    let document: AgentConfigsDocument
    try {
      document = await readAgentConfigs()
    } catch (error: unknown) {
      throw new RemoteError('agent-configs/rejected', messageOf(error), { reason: messageOf(error) })
    }
    const unknown = write.selected.filter(name => document.configs[name] === undefined)
    if (unknown.length > 0) {
      throw new RemoteError('agent-configs/rejected', `未声明的配置：${unknown.join(', ')}`, {
        reason: `undeclared config: ${unknown.join(', ')}`,
      })
    }
    // An empty selection means "not governed", so the project entry goes away entirely.
    const next = new Map(Object.entries(document.projects))
    if (write.selected.length === 0) next.delete(write.cwd)
    else next.set(write.cwd, [...new Set(write.selected)])
    try {
      await writeAgentConfigs({ configs: document.configs, projects: Object.fromEntries(next) })
    } catch (error: unknown) {
      throw new RemoteError('agent-configs/rejected', messageOf(error), { reason: messageOf(error) })
    }
    this.stamp = undefined
    await this.enqueue(() => this.refresh())
    return viewOf(await readAgentConfigs(), write.cwd)
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
    this.suppressors.get(sessionId)?.()
    this.suppressors.delete(sessionId)
    this.suppressed.delete(sessionId)
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
      // Servers whose tools never reach the view (none registered yet) are still
      // suppressed by name, so their prompt sections and resources follow the selection.
      const roster = this.ctx.mcpResources.servers(scopeOf(agent.ctx))
      const hide = servers === undefined ? [] : roster.filter(name => !servers.has(name))
      const previous = this.masked.get(sessionId)
      const previousHide = this.suppressed.get(sessionId)
      // An absent installation is the empty selection: `same(undefined, [])` must hold,
      // or an agent with nothing to deny never converges and reinstalls every pass.
      const same = (installed: Set<string> | undefined, next: readonly string[]): boolean =>
        (installed?.size ?? 0) === next.length && next.every(name => installed?.has(name) === true)
      if (same(previous, deny) && same(previousHide, hide)) continue
      this.applying = true
      try {
        this.masks.get(sessionId)?.()
        this.masks.delete(sessionId)
        this.masked.delete(sessionId)
        this.suppressors.get(sessionId)?.()
        this.suppressors.delete(sessionId)
        this.suppressed.delete(sessionId)
        if (deny.length > 0) {
          this.masks.set(sessionId, agent.ctx.tools.restrict({ deny }))
          this.masked.set(sessionId, new Set(deny))
        }
        if (hide.length > 0) {
          this.suppressors.set(sessionId, this.ctx.mcpResources.suppress(hide))
          this.suppressed.set(sessionId, new Set(hide))
        }
      } finally { this.applying = false }
    }
    const live = new Set([...this.agents.keys()])
    for (const sessionId of [...this.masks.keys()]) if (!live.has(sessionId)) this.drop(sessionId)
  }
}
