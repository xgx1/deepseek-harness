/**
 * Scoped MCP resource providers and the shared model-facing resource tools.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { createScope, NamedEntries, ScopedLayers, scopeOf, type ScopeKey, type ScopeLayer } from '@deepseek-ai/dsh-scope'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ToolArgsError, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerResourceTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpResources: McpResourceRuntime
  }
}

/** One supported resource operation, with server-owned cursors and URIs. */
export type McpResourceRequest =
  | { method: 'resources/list' | 'resources/templates/list'; cursor?: string }
  | { method: 'resources/read'; uri: string }

/** One configured server's resource access, owned by its MCP connection plugin. */
export interface McpResourceProvider {
  /**
   * Run an operation against one live connection generation. The resource tools
   * dispatch in parallel, so one provider may receive several concurrent requests;
   * each must settle independently.
   * @param request - MCP resource method and parameters.
   * @param exec - caller identity and cancellation for this invocation.
   * @returns the protocol result as lossless JSON.
   */
  request(request: McpResourceRequest, exec: ToolExecution): Promise<JsonValue>
}

class ResourceLayer implements ScopeLayer {
  readonly servers = new NamedEntries<McpResourceProvider>(name =>
    new Error(`MCP resource server "${name}" is already registered in this scope`))
  /** Servers a host plugin hides in this scope, whatever their registration scope. */
  readonly hidden = new NamedEntries<true>(name =>
    new Error(`MCP server "${name}" is already suppressed in this scope`))
  disposeTools: (() => void | Promise<void>) | undefined

  isEmpty(): boolean {
    return this.servers.isEmpty() && this.hidden.isEmpty()
  }
}

/** Scoped resource access plus three tools shared by configured MCP servers. */
export class McpResourceRuntime extends Service {
  /** Tool registry required by the resource consumer. */
  static inject = ['tools']

  private readonly layers = new ScopedLayers(() => new ResourceLayer(), () => undefined)
  /** Shared tool registrations outlive any one server's registering context. */
  private readonly selfCtx: Context

  constructor(ctx: Context) {
    super(ctx, 'mcpResources')
    this.selfCtx = ctx

    ctx.inject(['systemPrompt'], (inner) => {
      inner.systemPrompt.section({
        name: 'mcp-resource-servers',
        order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
        interpolate: false,
        text: ({ scope }) => {
          const hidden = this.hidden(scope)
          const names = this.servers(scope).filter(name => !hidden.has(name))
          return names.length === 0 ? '' : '## MCP 资源服务器\n\n'
            + '用 list_mcp_resources、list_mcp_resource_templates 或 read_mcp_resource，把下列名称之一'
            + `作为 server 参数：${JSON.stringify(names)}。`
        },
      })
    })
  }

  /**
   * Register one server and expose resource tools while that scope has providers.
   * @param server - configured server name, unique in this scope.
   * @param provider - connection-owned resource operations.
   * @returns the effect disposer for this exact registration.
   */
  register(server: string, provider: McpResourceProvider): () => void {
    const ctx = this.ctx
    const scope = scopeOf(ctx)
    const dispose = ctx.effect(function* (this: McpResourceRuntime) {
      let disposal: void | Promise<void>
      // Tools disappear synchronously; Cordis owns any pending scoped-fiber teardown.
      yield () => disposal
      yield this.layers.effect(ctx, (layer) => {
        const first = layer.servers.isEmpty()
        const remove = layer.servers.insert(server, provider)
        try {
          if (first) layer.disposeTools = this.registerTools(scope)
        } catch (error) {
          remove()
          throw error
        }
        return () => {
          remove()
          // oxlint-disable-next-line typescript/no-non-null-assertion -- successful provider registration owns the shared tools
          if (layer.servers.isEmpty()) disposal = layer.disposeTools!()
        }
      }, { label: `mcpResources.provider(${server})` })
    }.bind(this), `mcpResources.register(${server})`)
    // oxlint-disable-next-line typescript/no-misused-promises -- visibility cleanup is synchronous; Cordis retains pending fiber disposal
    return dispose
  }

  /**
   * Hide servers from this scope's prompt section and resource requests.
   * @param servers - configured server names to suppress in the calling scope.
   * @returns the exact disposer lifting the suppression.
   */
  suppress(servers: readonly string[]): () => void {
    return this.layers.effect(this.ctx, (layer) => {
      const removes = servers.map(name => layer.hidden.insert(name, true))
      return () => { for (const remove of removes) remove() }
    }, { label: 'mcpResources.suppress' })
  }

  /**
   * Server names a scope hides from its prompt section and resource requests.
   * @param scope - viewing scope, or undefined for the global view.
   * @returns the suppressed names in that scope.
   */
  hidden(scope: ScopeKey | undefined): ReadonlySet<string> {
    return new Set(this.layers.merge(scope, layer => layer.hidden).keys())
  }

  /**
   * Registered server names a scope can reach.
   * @param scope - viewing scope, or undefined for the global view.
   * @returns the sorted registered names.
   */
  servers(scope: ScopeKey | undefined): readonly string[] {
    return [...this.layers.merge(scope, layer => layer.servers).keys()].sort()
  }

  /** Own one scope's tools independently of its configured server plugins. */
  private registerTools(scope: ScopeKey | undefined): () => void | Promise<void> {
    const ctx = this.selfCtx
    return ctx.effect(function* (this: McpResourceRuntime) {
      let toolCtx = ctx
      if (scope !== undefined) {
        const owned = createScope(ctx, scope)
        yield owned.rawDispose
        toolCtx = owned.ctx
      }
      yield registerResourceTools(toolCtx, (server, request, exec) => this.request(server, request, exec))
    }.bind(this), 'mcpResources.tools')
  }

  /** Resolve the caller-visible server before starting any network operation. */
  private request(server: string, request: McpResourceRequest, exec: ToolExecution): Promise<JsonValue> {
    if (this.hidden(exec.agent).has(server)) {
      throw new ToolArgsError([`server: MCP resource server "${server}" is unavailable in this agent's scope`])
    }
    const provider = this.layers.merge(exec.agent, layer => layer.servers).get(server)
    if (!provider) throw new ToolArgsError([`server: MCP resource server "${server}" is unavailable in this agent's scope`])
    return provider.request(request, exec)
  }
}

export default McpResourceRuntime
