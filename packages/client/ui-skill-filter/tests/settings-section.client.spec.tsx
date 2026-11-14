// @vitest-environment jsdom
/**
 * The settings page's behavior: the loaded personal and project rules become
 * editable rows, a catalog row adds one skill to the allow list, and each save
 * writes its own layer and reports the outcome.
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
      value: { exists: true, config: { allow: ['git-*'] } },
    }),
    savePersonal: config => Promise.resolve({ ok: true, value: { exists: true, config } }),
    loadProject: () => Promise.resolve({
      ok: true,
      value: { exists: true, config: { allow: ['ue-*'] } },
    }),
    saveProject: (_cwd, config) => Promise.resolve({ ok: true, value: { exists: true, config } }),
    loadEffective: () => Promise.resolve({
      ok: true,
      value: { personalExists: true, projectExists: false, config: { allow: ['git-*'] } },
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
  } as SkillFilterSettingsSectionProps
}

afterEach(cleanup)

describe('the skill-filter settings page', () => {
  it('renders the loaded personal rules as editable rows', async () => {
    render(<SkillFilterSettingsSection {...props()} />)
    expect(await screen.findByDisplayValue('git-*')).toBeDefined()
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

  it('adds one catalog skill to the allow list', async () => {
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
    await screen.findByText(zh['project.present'])
    fireEvent.click(screen.getAllByRole('button', { name: zh['action.save'] })[0] as HTMLElement)
    await waitFor(() => {
      expect(savePersonal).toHaveBeenCalledWith({ allow: ['git-*'] })
    })
    expect(await screen.findByText(zh['action.saved'])).toBeDefined()
  })

  it('edits the project layer in its own panel and saves it separately', async () => {
    const saveProject = vi.fn((_cwd: string, config: { allow: readonly string[] }) => Promise.resolve({
      ok: true as const,
      value: { exists: true, config },
    }))
    render(<SkillFilterSettingsSection {...props({ saveProject })} />)
    expect(await screen.findByText(zh['project.present'])).toBeDefined()
    expect(screen.getByDisplayValue('ue-*')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: zh['action.save'] })[1] as HTMLElement)
    await waitFor(() => {
      expect(saveProject).toHaveBeenCalledWith('/repo', { allow: ['ue-*'] })
    })
  })

  it('reports a refused save without changing the rows', async () => {
    const savePersonal = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'skill-filter/rejected' as const, message: 'nope', details: { reason: 'nope' } },
    }) as Promise<RemoteResult<{ exists: boolean; config?: { allow: readonly string[] } }>>)
    render(<SkillFilterSettingsSection {...props({ savePersonal })} />)
    await screen.findByText(zh['project.present'])
    fireEvent.click(screen.getAllByRole('button', { name: zh['action.save'] })[0] as HTMLElement)
    expect(await screen.findByText(zh['action.saveFailed'])).toBeDefined()
    expect(screen.getByDisplayValue('git-*')).toBeDefined()
  })
})
