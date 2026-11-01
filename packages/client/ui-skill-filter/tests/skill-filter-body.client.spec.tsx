// @vitest-environment jsdom
/**
 * The Sidebar tab's behavior: the merged rules in force, the project layer's
 * draft rows, and how the tab reports a project that has no config yet.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SkillFilterFace } from '../src/client/face.ts'
import type { SkillFilterBodyProps } from '../src/client/SkillFilterBody.tsx'
import { SkillFilterBody } from '../src/client/SkillFilterBody.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session-1'

/** A translate seat that resolves this package's own Chinese dictionary. */
const t = ((key: keyof typeof zh) => zh[key]) as SkillFilterBodyProps['t']

/** A session-list selector hook over one fixture session. */
function useSessions<T>(select: (state: {
  byId: Record<string, { id: string; cwd: string }>
}) => T): T {
  return select({ byId: { [SESSION]: { id: SESSION, cwd: '/repo' } } })
}

function props(overrides: Partial<SkillFilterFace> = {}): SkillFilterBodyProps {
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
      value: [{ name: 'git-commit', description: 'Commit a change.', modelInvocable: true }],
    }),
    ...overrides,
  }
  return {
    sessionId: SESSION,
    t,
    useSessions,
    ...face,
  } as SkillFilterBodyProps
}

afterEach(cleanup)

describe('the skill-filter sidebar tab', () => {
  it('shows the merged rules in force and the project layer draft', async () => {
    render(<SkillFilterBody {...props()} />)
    expect(await screen.findByText(zh['project.present'])).toBeDefined()
    expect(screen.getByText(`${zh['effective.allow']}: git-*, ue-*`)).toBeDefined()
    expect(screen.getByDisplayValue('ue-*')).toBeDefined()
  })

  it('reports an absent project layer and seeds the draft from the merged rules', async () => {
    render(<SkillFilterBody {...props({
      loadProject: () => Promise.resolve({ ok: true, value: { exists: false } }),
      loadEffective: () => Promise.resolve({
        ok: true,
        value: { personalExists: true, projectExists: false, config: { allow: ['git-*'] } },
      }),
    })} />)
    // The merged panel reports the absent layer, and the project panel says
    // the personal rules carry the session on their own.
    expect(await screen.findByText(zh['project.inherits'], { exact: false })).toBeDefined()
    expect(screen.getByDisplayValue('git-*')).toBeDefined()
  })
})
