// @vitest-environment jsdom
/**
 * The settings page's behavior: the loaded personal rules become editable rows,
 * a catalog row switches one skill between allowed and denied, and a save
 * writes the personal layer and reports the outcome.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillFilterFace } from '../src/client/face.ts'
import type { SkillFilterSettingsSectionProps } from '../src/client/SettingsSection.tsx'
import { SkillFilterSettingsSection } from '../src/client/SettingsSection.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session-1'

/** The visible state one loaded catalog row carries. */
function skill(name: string, description: string, modelInvocable: boolean) {
  return { name, description, modelInvocable }
}

/** A translate seat that resolves this package's own Chinese dictionary. */
const t = ((key: keyof typeof zh) => zh[key]) as SkillFilterSettingsSectionProps['t']

/** A session-list selector hook over one fixture session. */
function useSessions<T>(select: (state: {
  byId: Record<string, { id: string; cwd: string; retainedBy: { mainView: number } }>
}) => T): T {
  return select({ byId: { [SESSION]: { id: SESSION, cwd: '/repo', retainedBy: { mainView: 1 } } } })
}

function props(overrides: Partial<SkillFilterFace> = {}): SkillFilterSettingsSectionProps {
  const face: SkillFilterFace = {
    loadPersonal: () => Promise.resolve({
      ok: true,
      value: { exists: true, config: { allow: ['git-*'], deny: ['git-rebase'] } },
    }),
    savePersonal: config => Promise.resolve({ ok: true, value: { exists: true, config } }),
    loadProject: () => Promise.resolve({ ok: true, value: { exists: false } }),
    saveProject: (_cwd, config) => Promise.resolve({ ok: true, value: { exists: true, config } }),
    loadEffective: () => Promise.resolve({
      ok: true,
      value: { personalExists: true, projectExists: false, config: { allow: ['git-*'], deny: ['git-rebase'] } },
    }),
    listSkills: () => Promise.resolve({
      ok: true,
      value: [
        skill('git-commit', zh['catalog.intro'], true),
        skill('git-rebase', zh['catalog.intro'], false),
      ],
    }),
    ...overrides,
  }
  return {
    close: () => {},
    t,
    useSessions,
    ...face,
  } as unknown as SkillFilterSettingsSectionProps
}

afterEach(cleanup)

describe('the skill-filter settings page', () => {
  it('renders the loaded personal rules as editable rows', async () => {
    render(<SkillFilterSettingsSection {...props()} />)
    expect(await screen.findByDisplayValue('git-*')).toBeDefined()
    expect(screen.getByDisplayValue('git-rebase')).toBeDefined()
    expect(screen.getByText(zh['personal.present'])).toBeDefined()
  })

  it('lists every catalog skill with its current visibility', async () => {
    render(<SkillFilterSettingsSection {...props()} />)
    expect(await screen.findByText('git-commit')).toBeDefined()
    expect(screen.getByText('git-rebase')).toBeDefined()
    const visible = screen.getAllByText(zh['state.visible'])
    const hidden = screen.getAllByText(zh['state.hidden'])
    expect(visible.length).toBe(1)
    expect(hidden.length).toBe(1)
  })

  it('adds one catalog skill to the allow list and drops it from the deny list', async () => {
    render(<SkillFilterSettingsSection {...props()} />)
    expect(await screen.findByDisplayValue('git-*')).toBeDefined()
    const allow = screen.getAllByRole('button', { name: zh['action.allow'] })
    fireEvent.click(allow[allow.length - 1] as HTMLElement)
    await waitFor(() => {
      expect(screen.getAllByDisplayValue('git-rebase').length).toBe(1)
    })
    expect(screen.getAllByDisplayValue('git-*').length).toBe(1)
  })

  it('filters the catalog by the search box', async () => {
    render(<SkillFilterSettingsSection {...props()} />)
    const search = await screen.findByLabelText(zh['catalog.search'])
    fireEvent.change(search, { target: { value: 'commit' } })
    await waitFor(() => {
      expect(screen.queryByText('git-rebase')).toBeNull()
    })
    expect(screen.getByText('git-commit')).toBeDefined()
  })

  it('saves the personal rules and reports the accepted copy', async () => {
    const savePersonal = vi.fn((config: { allow: readonly string[] }) => Promise.resolve({
      ok: true as const,
      value: { exists: true, config },
    }))
    render(<SkillFilterSettingsSection {...props({ savePersonal })} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['action.save'] }))
    await waitFor(() => {
      expect(savePersonal).toHaveBeenCalledWith({ allow: ['git-*'], deny: ['git-rebase'] })
    })
    expect(await screen.findByText(zh['action.saved'])).toBeDefined()
  })

  it('reports a refused save without changing the rows', async () => {
    const savePersonal = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'skill-filter/rejected' as const, message: 'nope', details: { reason: 'nope' } },
    }) as Promise<RemoteResult<{ exists: boolean; config?: { allow: readonly string[] } }>>)
    render(<SkillFilterSettingsSection {...props({ savePersonal })} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['action.save'] }))
    expect(await screen.findByText(zh['action.saveFailed'])).toBeDefined()
    expect(screen.getByDisplayValue('git-*')).toBeDefined()
  })
})
