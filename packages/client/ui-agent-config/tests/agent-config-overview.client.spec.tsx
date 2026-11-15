// @vitest-environment jsdom
/**
 * The catalog overview on the General settings page: every config with what it
 * contributes, and every project's selection. It reads once and never writes.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfigOverview as Overview } from '@deepseek-ai/dsh-agent-config/types'
// Type-only: the plugin's own \`agentConfig\` locale-namespace merge, which types the \`t\` seat.
import type {} from '../src/client/index.ts'
import { AgentConfigOverview } from '../src/client/AgentConfigOverview.tsx'
import type { AgentConfigOverviewProps } from '../src/client/AgentConfigOverview.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const VIEW: Overview = {
  path: '/home/user/.dsh/agent-configs.yaml',
  configs: [
    { name: 'core', skills: ['ponytail'], mcp: ['cbm'], tools: ['bash', 'read'] },
    { name: 'js', skills: [], mcp: [], tools: [] },
  ],
  projects: [
    { cwd: '/work/app', selected: ['core', 'js'] },
  ],
}

const t: AgentConfigOverviewProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function renderOverview(view: Overview | undefined): HTMLElement {
  const read: AgentConfigOverviewProps['read'] = vi.fn(() => Promise.resolve(view))
  return render(<AgentConfigOverview read={read} t={t} />).container
}

describe('the agent-config overview', () => {
  it('lists every config with its contribution and every project selection', async () => {
    const container = renderOverview(VIEW)
    expect(await screen.findByText('Skills / MCP / tools configuration')).toBeTruthy()
    await waitFor(() => { expect(container.textContent).toContain('Source: /home/user/.dsh/agent-configs.yaml') })
    expect(container.textContent).toContain('2 configs')
    expect(container.textContent).toContain('1 projects')
    expect(container.textContent).toContain('core')
    expect(container.textContent).toContain('1 skills · 1 MCP · 2 tools')
    expect(container.textContent).toContain('/work/app')
    expect(container.textContent).toContain('Selected: core, js')
  })

  it('shows the parse error instead of an empty catalog', async () => {
    const container = renderOverview({ ...VIEW, configs: [], projects: [], error: 'bad yaml' })
    await waitFor(() => { expect(container.textContent).toContain('bad yaml') })
  })
})
