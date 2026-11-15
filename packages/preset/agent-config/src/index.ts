/**
 * Host service that governs one project's skills and MCP tools through
 * `$DSH_HOME/agent-configs.yaml`.
 *
 * An agent is masked as soon as it is created: tools the project's selection
 * does not name disappear from that agent's tool view, MCP tools whose server
 * the selection omits go with them, and the skill filter reads the same document
 * to decide the catalog. A project absent from the document selects no
 * configuration, which allows no tool, so an unconfigured checkout sees none.
 *
 * @module @deepseek-ai/dsh-agent-config
 */

import { readFileSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import picomatch from 'picomatch'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Side-effect type imports: declare the agent-created and tools/change events,
// and the mcpResources service the suppression goes through.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-mcp-resources'
import {
  EMPTY_DOCUMENT, agentConfigsPath, mcpServersOf, parseAgentConfigs, readAgentConfigs, selectionOf,
  skillGlobsOf, toolsOf, writeProjects,
} from './config.js'
import type { AgentConfigsDocument } from './config.js'
import type { AgentConfigOverview, AgentConfigRequest, AgentConfigSelectionView, AgentConfigWrite } from './types.js'

export type { AgentConfigsDocument, AgentConfiguration } from './config.js'
export type {
  AgentConfigOverview, AgentConfigRequest, AgentConfigSelectionView, AgentConfigView, AgentConfigWrite,
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
      tools: config.tools,
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
  /** Names each installed allow envelope permits, so an unchanged selection is left alone. */
  private readonly masked = new Map<string, Set<string>>()
  /** Projects already reported as unlisted, so the warning fires once per checkout. */
  private readonly unlisted = new Set<string>()
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
          // Mask in the same tick: the first request is assembled before a queued
          // refresh could run, and an unmasked first step is the leak this prevents.
          this.enforce(this.documentSync())
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
        this.unlisted.clear()
        this.suppressors.clear()
        this.suppressed.clear()
        this.agents.clear()
      }
    }, 'agent-configs enforcement')
  }

  /**
   * Resolve the document without awaiting, so a new agent is masked before its
   * first request is assembled.
   * @returns the resolved document, or the last valid parse when this read fails.
   */
  private documentSync(): AgentConfigsDocument {
    const path = agentConfigsPath()
    let stamp: string | undefined
    try {
      const info = statSync(path)
      stamp = `${info.mtimeMs}:${info.size}`
    } catch {
      stamp = undefined
    }
    if (stamp !== undefined && stamp === this.stamp) return this.cached
    try {
      this.cached = parseAgentConfigs(readFileSync(path, 'utf-8'), path)
      this.stamp = stamp
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cached = EMPTY_DOCUMENT
        this.stamp = undefined
      } else {
        this.ctx.logger.warn('agent-configs: %s; keeping the previous document', messageOf(error))
      }
    }
    return this.cached
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
   * Read the whole catalog and every project selection.
   * @returns the document path, every config, and each project's selection.
   */
  @Remote
  async overview(): Promise<AgentConfigOverview> {
    const path = agentConfigsPath()
    try {
      const document = await readAgentConfigs()
      return {
        path,
        configs: Object.entries(document.configs).map(([name, config]) => ({
          name, skills: config.skills, mcp: config.mcp, tools: config.tools,
        })),
        projects: Object.entries(document.projects)
          .map(([cwd, selected]) => ({ cwd, selected }))
          .sort((left, right) => left.cwd.localeCompare(right.cwd)),
      }
    } catch (error: unknown) {
      return { path, configs: [], projects: [], error: messageOf(error) }
    }
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
    // An absent entry allows no server, the same outcome as an empty selection, so the entry goes away.
    const next = new Map(Object.entries(document.projects))
    if (write.selected.length === 0) next.delete(write.cwd)
    else next.set(write.cwd, [...new Set(write.selected)])
    try {
      // Projects-only: a full rewrite would drop comments and any field this build
      // does not know, which another instance relies on.
      await writeProjects(Object.fromEntries(next))
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
   * Bring every agent's mask in line with the current document. The deny set
   * comes from the unrestricted global view, so it is stable while a mask is
   * installed and an unchanged selection needs no reinstalling. A project the
   * document does not list selects nothing, which allows neither a tool nor a server.
   */
  private async recompute(): Promise<void> {
    this.enforce(await this.document())
  }

  /**
   * Bring every agent's mask in line with one already-resolved document.
   * @param document - the document to enforce.
   */
  private enforce(document: AgentConfigsDocument): void {
    for (const agent of this.agents.values()) {
      const sessionId = agent.session.id
      const cwd = agent.session.header.cwd
      if (cwd !== undefined && selectionOf(document, cwd) === undefined && !this.unlisted.has(cwd)) {
        this.unlisted.add(cwd)
        this.ctx.logger.warn('agent-configs: %s is not listed under projects; this agent gets no skill, no MCP server and no tool', cwd)
      }
      const servers = mcpServersOf(document, cwd) ?? new Set<string>()
      // A tool is allowed by its own glob or, for an MCP tool, by its server.
      const allowsTool = picomatch([...(toolsOf(document, cwd) ?? [])], { dot: true })
      const permits = (name: string): boolean => {
        if (allowsTool(name)) return true
        const server = mcpServerOf(name)
        return server !== undefined && servers.has(server)
      }
      // An allow envelope hides every name it omits, so a tool registered after
      // this pass waits for the next one instead of leaking into the request being
      // assembled now; names a live envelope hides are unioned back in because the
      // view no longer reports them.
      const scope = scopeOf(agent.ctx)
      const names = new Set<string>(this.masked.get(sessionId))
      for (const schema of this.ctx.tools.schemas(scope)) names.add(schema.name)
      const known = this.ctx.tools.knownNames(scope)
      const allow = [...names].filter(name => known.has(name) && permits(name))
      // Servers whose tools never reach the view (none registered yet) are still
      // suppressed by name, so their prompt sections and resources follow the selection.
      const roster = this.ctx.mcpResources.servers(scopeOf(agent.ctx))
      const hide = roster.filter(name => !servers.has(name))
      const previous = this.masked.get(sessionId)
      const previousHide = this.suppressed.get(sessionId)
      const same = (installed: Set<string> | undefined, next: readonly string[]): boolean =>
        (installed?.size ?? 0) === next.length && next.every(name => installed?.has(name) === true)
      // An absent envelope is not the empty one: absence allows every tool, while an
      // empty envelope allows none, so the first pass always installs.
      const emptyEnvelopeAllowed = previous === undefined
      // An absent suppression is the empty set and needs no installation.
      if (!emptyEnvelopeAllowed && same(previous, allow) && same(previousHide, hide)) continue
      this.applying = true
      try {
        this.masks.get(sessionId)?.()
        this.masks.delete(sessionId)
        this.masked.delete(sessionId)
        this.suppressors.get(sessionId)?.()
        this.suppressors.delete(sessionId)
        this.suppressed.delete(sessionId)
        // Installed even when empty: an omitted envelope would leave every tool
        // visible, which is the opposite of a project that selected nothing.
        // includeScoped: a preset mounts its MCP clients per agent, so their tools
        // are scope-local and an ordinary mask would leave them visible.
        this.masks.set(sessionId, agent.ctx.tools.restrict({ allow, includeScoped: true }))
        this.masked.set(sessionId, new Set(allow))
        if (hide.length > 0) {
          // Hide in the agent's own scope: a root-scope suppression would collide with
          // every other session's and hide servers they may see.
          this.suppressors.set(sessionId, this.ctx.mcpResources.suppress(hide, agent.ctx))
          this.suppressed.set(sessionId, new Set(hide))
        }
      } catch (error) {
        // One agent's failure must not skip the rest of the pass.
        this.ctx.logger.warn('agent-configs: cannot enforce %s: %s', cwd, messageOf(error))
      } finally { this.applying = false }
    }
    const live = new Set([...this.agents.keys()])
    for (const sessionId of [...this.masks.keys()]) if (!live.has(sessionId)) this.drop(sessionId)
  }
}
