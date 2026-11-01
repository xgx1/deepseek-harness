// @vitest-environment jsdom
/**
 * The Conversation view's behavior: the catalog counts in the header, both rule
 * layers rendered beside the catalog, and a catalog switch landing in the
 * project draft that Save persists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SkillFilterFace } from '../src/client/face.ts'
import type { SkillFilterViewProps } from '../src/client/SkillFilterView.tsx'
import { SkillFilterView } from '../src/client/SkillFilterView.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session-1'

/** A translate seat that resolves this package's own Chinese dictionary. */
const t = ((key: keyof typeof zh) => zh[key]) as SkillFilterViewProps['t']

/** A session-list selector hook over one fixture session. */
function useSessions<T>(select: (state: {
  byId: Record<string, { id: string; cwd: string }>
}) => T): T {
  return select({ byId: { [SESSION]: { id: SESSION, cwd: '/repo' } } })
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
  return {
    sessionId: SESSION,
    t,
    useSessions,
    ...face,
  } as unknown as SkillFilterViewProps
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
