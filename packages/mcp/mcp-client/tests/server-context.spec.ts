import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { createScope } from '@deepseek-ai/dsh-scope'
import { registerServerContext } from '../src/server-context.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

async function setup() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(McpResources)
  return ctx
}

describe('MCP server context', () => {
  it('publishes literal instructions and withdraws the prompt and resource provider together', async () => {
    const ctx = await setup()
    let instructions = 'MCP server: docs\nKeep {{server.template}} literal.'
    const fiber = await ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, 'docs', {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => instructions,
      })
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(instructions)
    instructions = 'MCP server: docs\nUpdated instructions.'
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(instructions)
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('MCP server: docs')
    const result = await executeToolFixture(ctx, {
      name: 'list_mcp_resources', arguments: { server: 'docs' },
      callId: brandString<ToolCallId>('disposed-resource'), signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
  })

  it('withdraws instructions when every tool of the server is masked in the viewing scope', async () => {
    const ctx = await setup()
    ctx.tools.register({
      name: 'mcp__docs__search',
      description: 'search docs',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'null' }, render: () => [] },
      async execute() { return null },
    })
    await ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, 'docs', {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => 'Docs server instructions.',
      })
    } })
    const scopeKey = {}
    await ctx.plugin({ inject: ['tools'], apply(inner: Context) {
      createScope(inner, scopeKey).ctx.tools.restrict({ deny: ['mcp__docs__search'] })
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Docs server instructions.')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeKey }))).not.toContain('Docs server instructions.')
  })

  it('withdraws instructions for a server its host suppresses, tools or not', async () => {
    const ctx = await setup()
    await ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, 'unity', {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => 'Unity editor instructions.',
      })
    } })
    const scopeKey = {}
    await ctx.plugin({ inject: ['mcpResources'], apply(inner: Context) {
      createScope(inner, scopeKey).ctx.mcpResources.suppress(['unity'])
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Unity editor instructions.')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeKey }))).not.toContain('Unity editor instructions.')
  })

  it('shows scoped server instructions only to the owning scope', async () => {
    const ctx = await setup()
    const scopeKey = {}
    await ctx.plugin({ apply(inner: Context) {
      const scoped = createScope(inner, scopeKey)
      registerServerContext(scoped.ctx, 'private', {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => 'Private server instructions.',
      })
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeKey }))).toContain('Private server instructions.')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Private server instructions.')
  })
})
