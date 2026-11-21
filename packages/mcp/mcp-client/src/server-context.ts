/**
 * Publish connection-owned MCP resources, literal server instructions, and an
 * on-demand server's tool catalog.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { McpResourceProvider } from '@deepseek-ai/dsh-mcp-resources'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

/** Connection-owned values used by the resource and prompt consumers. */
export interface ServerContext {
  /** Resource access through the current connection generation. */
  resources: McpResourceProvider
  /**
   * Read the last successfully connected server's attributed instructions.
   * @returns literal prompt text, or an empty string when no server instructions are active.
   */
  instructions(): string
  /**
   * Render an on-demand server's tool catalog for one prompt assembly.
   * @param scope - the assembling agent, or undefined for the global view.
   * @returns literal prompt text, or an empty string when the scope has nothing to load.
   */
  catalog?: (scope: ScopeKey | undefined) => string
}

/**
 * Contribute server context to the services enabled by this composition.
 * @param ctx - server plugin's registration scope and effect owner.
 * @param server - configured server identity.
 * @param connection - live resource operations, successful instruction snapshot, and an on-demand server's tool catalog.
 */
export function registerServerContext(ctx: Context, server: string, connection: ServerContext): void {
  ctx.inject(['mcpResources'], (inner) => {
    inner.mcpResources.register(server, connection.resources)
  })
  ctx.inject(['systemPrompt', 'tools', 'mcpResources'], (inner) => {
    inner.systemPrompt.section({
      name: `mcp:${server}`,
      order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
      interpolate: false,
      // A scope that masks every tool of this server, or whose host suppresses the
      // server outright, does not use it: its instructions take no prompt space.
      text: ({ scope }) => {
        if (inner.mcpResources.hidden(scope).has(server)) return ''
        const owns = (view?: Parameters<typeof inner.tools.definitions>[0]): boolean => inner.tools
          .definitions(view).some(definition => definition.name.startsWith(`mcp__${server}__`))
        return owns() && !owns(scope) ? '' : connection.instructions()
      },
    })
    const { catalog } = connection
    if (catalog !== undefined) {
      inner.systemPrompt.section({
        name: `mcp:${server}:tools`,
        order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
        interpolate: false,
        text: ({ scope }) => catalog(scope),
      })
    }
  })
}
