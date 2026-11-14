// @vitest-environment jsdom
/**
 * The Conversation view's behavior: the catalog counts in the header, both rule
 * layers rendered beside the catalog, and a catalog switch landing in the
 * project draft that Save persists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SkillFilterFace } from '../src/client/face.ts'
import type { SkillFilterViewProps } from '../src/client/SkillFilterView.tsx'
import { SkillFilterView } from '../src/client/SkillFilterView.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = SessionId('session-1')

/** A translate seat that resolves this package's own Chinese dictionary. */
const t = ((key: keyof typeof zh) => zh[key]) as SkillFilterViewProps['t']

/** The session-list state the view's selector hook receives. */
type SessionsState = Parameters<Parameters<SkillFilterViewProps['useSessions']>[0]>[0]

/** A session-list selector hook over one fixture session. */
function useSessions<T>(select: (state: SessionsState) => T): T {
  return select({
    ids: [SESSION],
    byId: {
      [SESSION]: {
        id: SESSION, displayTitle: 'session-1', cwd: '/repo', running: false, retainedBy: {}, blank: false, updatedAt: 0,
      },
    },
    phase: 'ready',
    projectionsBySession: {},
  })
}

function props(overrides: Partial<SkillFilterFace> = {}): SkillFilterViewProps {
  const face: SkillFilterFace = {
    loadPersonal: () => Promise.resolve({ ok: true, value: { exists: true, config: { allow: ['git-*'] } } }),
    savePersonal: config => Promise.resolve({ ok: true, value: { exists: true, config } }),
    loadProject: () => Promise.resolve({ ok: true, value: { exists: true, config: { allow: ['ue-*'] } } }),
    saveProject: (_cwd, config) => Promise.resolve({ ok: true, value: { exists: true, config } }),
    loadEffective: () => Promise.resolve({
      ok: true,
      value: { personalExists: true, projectExists: true, config: { allow: ['git-*', 'ue-*'] } },
    }),
    listSkills: () => Promise.resolve({
      ok: true,
      value: [
        { name: 'git-commit', description: 'Commit a change.', modelInvocable: true },
        { name: 'ue-build', description: 'Build the project.', modelInvocable: false },
      ],
    }),
    ...overrides,
  }
  // Sibling view specs stub only the props the component reads and cast the literal.
  return {
    sessionId: SESSION,
    t,
    useSessions,
    ...face,
  } as SkillFilterViewProps
}

afterEach(cleanup)

describe('the skill-filter conversation view', () => {
  it('shows the catalog counts and both rule layers', async () => {
    render(<SkillFilterView {...props()} />)
    expect(await screen.findByText('git-commit')).toBeDefined()
    expect(screen.getByText('ue-build')).toBeDefined()
    // One skill declares itself user-invocable, the other does not.
    expect(screen.getByText(zh['page.total'])).toBeDefined()
    expect(screen.getByDisplayValue('ue-*')).toBeDefined()
    expect(screen.getByDisplayValue('git-*')).toBeDefined()
    expect(screen.getByText(zh['project.present'])).toBeDefined()
    expect(screen.getByText(zh['personal.present'])).toBeDefined()
  })

  it('refuses to save a cleared allow list and says why', async () => {
    const saveProject = vi.fn()
    render(<SkillFilterView {...props({ saveProject })} />)
    // The project card seeds from the merged rules while no project file exists.
    const projectCard = within((await screen.findByText(zh['project.present'])).closest('div') as HTMLElement)
    await waitFor(() => {
      expect(projectCard.getByDisplayValue('ue-*')).toBeDefined()
    })
    fireEvent.click(projectCard.getByLabelText(zh['action.clear']))
    await waitFor(() => {
      expect(screen.queryByDisplayValue('ue-*')).toBeNull()
    })
    expect(screen.getByText(zh['action.allowRequired'])).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: zh['action.save'] })[0] as HTMLElement)
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('shows the Host reason when a save is refused for another cause', async () => {
    const saveProject = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'skill-filter/rejected', message: 'disk is read-only' } as never,
    }))
    render(<SkillFilterView {...props({ saveProject })} />)
    await screen.findByText(zh['project.present'])
    fireEvent.click(screen.getAllByRole('button', { name: zh['action.save'] })[0] as HTMLElement)
    expect(await screen.findByText('disk is read-only')).toBeDefined()
  })

  it('writes a catalog switch into the project draft and saves it', async () => {
    const saveProject = vi.fn((_cwd: string, config: { allow: readonly string[] }) => Promise.resolve({
      ok: true as const,
      value: { exists: true, config },
    }))
    render(<SkillFilterView {...props({ saveProject })} />)
    const row = (await screen.findByText('ue-build')).closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: zh['action.allow'] }))
    await waitFor(() => {
      expect(screen.getAllByDisplayValue('ue-build').length).toBe(1)
    })
    // The project card comes before the personal card, so it owns the first Save.
    fireEvent.click(screen.getAllByRole('button', { name: zh['action.save'] })[0] as HTMLElement)
    await waitFor(() => {
      expect(saveProject).toHaveBeenCalledWith('/repo', { allow: ['ue-*', 'ue-build'] })
    })
  })
})
