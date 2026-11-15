// @vitest-environment jsdom
/**
 * The project agent-config chip: it appears only for a readable project roster,
 * and every tick persists the complete replacement selection — including the
 * empty list, which leaves the project ungoverned.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfigSelectionView } from '@deepseek-ai/dsh-agent-config/types'
// Type-only: the plugin's own `agentConfig` locale-namespace merge, which types the `t` seat.
import type {} from '../src/client/index.ts'
import { AgentConfigChip } from '../src/client/AgentConfigChip.tsx'
import type { AgentConfigChipProps } from '../src/client/AgentConfigChip.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const CWD = '/work/project'

const ROSTER: AgentConfigSelectionView = {
  configs: [
    { name: 'frontend', skills: ['ui-*', 'react-*'], mcp: ['playwright'], tools: [] },
    { name: 'backend', skills: ['db-*'], mcp: [], tools: ['read', 'bash'] },
  ],
  selected: [],
}

// The seat's key domain is this namespace plus the shared common vocabulary; the
// stub mirrors the real lookup chain and falls back to the key for common entries.
const t: AgentConfigChipProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function renderChip(
  view: AgentConfigSelectionView | undefined,
  save: (cwd: string, selected: readonly string[]) => Promise<AgentConfigSelectionView | undefined>
    = () => Promise.resolve(undefined),
) {
  const readSpy = vi.fn(() => Promise.resolve(view))
  const saveSpy = vi.fn(save)
  // Plain-function aliases: the composed props type takes function values, so the
  // props object holds those rather than the mocks the assertions keep.
  const read: AgentConfigChipProps['read'] = readSpy
  const write: AgentConfigChipProps['save'] = saveSpy
  const props: AgentConfigChipProps = { cwd: CWD, read, save: write, t }
  const rendered = render(<AgentConfigChip {...props} />)
  return { read: readSpy, save: saveSpy, view: rendered }
}

/** Open the chip's menu and return its rows. */
function openMenu(): HTMLElement[] {
  fireEvent.click(screen.getByRole('button', { name: /^Configs: / }))
  return screen.getAllByRole('menuitem')
}

describe('the project agent-config chip', () => {
  it('renders nothing when the Host declares no config', async () => {
    const { read, view } = renderChip({ configs: [], selected: [] })
    await waitFor(() => { expect(read).toHaveBeenCalledWith(CWD) })
    expect(view.container.firstChild).toBeNull()
  })

  it('renders nothing when the document is unreadable', async () => {
    const { view } = renderChip({ ...ROSTER, error: 'bad yaml' })
    await waitFor(() => { expect(view.container.firstChild).toBeNull() })
  })

  it('renders nothing when the read failed', async () => {
    const { view } = renderChip(undefined)
    await waitFor(() => { expect(view.container.firstChild).toBeNull() })
  })

  it('reads "none" before the project selects anything', async () => {
    renderChip(ROSTER)
    expect(await screen.findByText('Configs: none')).toBeTruthy()
  })

  it('shows how many configs the project carries', async () => {
    renderChip({ ...ROSTER, selected: ['backend'] })
    expect(await screen.findByRole('button', { name: /^Configs: / })).toBeTruthy()
    expect(screen.getByText('Configs: 1')).toBeTruthy()
  })

  it('names each config with what it contributes', async () => {
    renderChip(ROSTER)
    await screen.findByRole('button', { name: /^Configs: / })
    expect(openMenu().map(row => row.textContent)).toEqual([
      'frontend2 skills · 1 MCP · 0 tools',
      'backend1 skills · 0 MCP · 2 tools',
    ])
  })

  it('ticks and unticks one config, persisting the replacement list each time', async () => {
    const { save } = renderChip(ROSTER, (_cwd, selected) => Promise.resolve({ ...ROSTER, selected }))
    await screen.findByRole('button', { name: /^Configs: / })
    openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: /^frontend/ }))
    await waitFor(() => { expect(save).toHaveBeenLastCalledWith(CWD, ['frontend']) })
    expect(screen.getByText('Configs: 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: /^frontend/ }))
    await waitFor(() => { expect(save).toHaveBeenLastCalledWith(CWD, []) })
    expect(screen.getByText('Configs: none')).toBeTruthy()
  })

  it('puts the previous selection back when the write fails', async () => {
    const { save } = renderChip(ROSTER, () => Promise.resolve(undefined))
    await screen.findByRole('button', { name: /^Configs: / })
    openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: /^frontend/ }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(CWD, ['frontend']) })
    await waitFor(() => { expect(screen.getByText('Configs: none')).toBeTruthy() })
  })

  it('ignores a tick while its write is still in flight', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { save } = renderChip(ROSTER, async (_cwd, selected) => {
      // Overlapping replacements can land out of order, so the second tick waits.
      await gate
      return { ...ROSTER, selected }
    })
    await screen.findByRole('button', { name: /^Configs: / })
    openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: /^frontend/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^backend/ }))
    expect(save).toHaveBeenCalledOnce()

    release?.()
    await waitFor(() => { expect(screen.getByText('Configs: 1')).toBeTruthy() })
  })

  it('keeps the menu open across ticks and shows the Host-persisted selection', async () => {
    const { save } = renderChip(ROSTER, (_cwd, selected) => Promise.resolve({ ...ROSTER, selected }))
    await screen.findByRole('button', { name: /^Configs: / })
    openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: /^backend/ }))
    await waitFor(() => { expect(screen.getByText('Configs: 1')).toBeTruthy() })
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    expect(save).toHaveBeenCalledOnce()
  })
})
