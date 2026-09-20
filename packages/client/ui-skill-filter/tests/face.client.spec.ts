/**
 * The skill-filter face: every Host call the surfaces make, bound to a stub
 * Remote, plus the pure helpers that group and filter the catalog.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillFilterRemotes } from '../src/client/face.ts'
import { createSkillFilterFace, filterByQuery, prefixOf, toggleName } from '../src/client/face.ts'

/** One settled Remote result. */
function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/** A stub Remote face recording the calls the surfaces make. */
function stubRemotes(): {
  remotes: SkillFilterRemotes
  calls: { personal: number; project: number; effective: number; skills: number }
} {
  const calls = { personal: 0, project: 0, effective: 0, skills: 0 }
  const remotes: SkillFilterRemotes = {
    skillFilter: {
      getPersonal: () => { calls.personal += 1; return Promise.resolve(ok({ exists: true, config: { allow: ['*'] } })) },
      setPersonal: (config) => { calls.personal += 1; return Promise.resolve(ok({ exists: true, config })) },
      getProject: () => { calls.project += 1; return Promise.resolve(ok({ exists: false })) },
      setProject: (write) => { calls.project += 1; return Promise.resolve(ok({ exists: true, config: write.config })) },
      getEffective: () => {
        calls.effective += 1
        return Promise.resolve(ok({ personalExists: true, projectExists: false, config: { allow: ['*'] } }))
      },
    },
    skills: {
      list: () => {
        calls.skills += 1
        return Promise.resolve(ok({
          skills: [
            { name: 'git-commit', description: 'Commit a change', modelInvocable: true },
            { name: 'git-rebase', description: 'Rebase a branch', modelInvocable: false },
          ],
        }))
      },
    },
  }
  return { remotes, calls }
}

describe('the skill-filter face', () => {
  it('addresses the project and effective calls by working directory', async () => {
    const { remotes, calls } = stubRemotes()
    const face = createSkillFilterFace(remotes)
    const project = await face.loadProject('/repo')
    const effective = await face.loadEffective('/repo')
    expect(project).toEqual({ ok: true, value: { exists: false } })
    expect(effective.ok && effective.value.config).toEqual({ allow: ['*'] })
    expect(calls.project).toBe(1)
    expect(calls.effective).toBe(1)
  })

  it('persists a personal config and reports the accepted copy', async () => {
    const { remotes } = stubRemotes()
    const face = createSkillFilterFace(remotes)
    const saved = await face.savePersonal({ allow: ['git-*'], deny: ['git-rebase'] })
    expect(saved.ok && saved.value.config).toEqual({ allow: ['git-*'], deny: ['git-rebase'] })
  })

  it('persists a project config with its working directory', async () => {
    const { remotes, calls } = stubRemotes()
    const face = createSkillFilterFace(remotes)
    await face.saveProject('/repo', { allow: ['ue-*'] })
    expect(calls.project).toBe(1)
  })

  it('projects one catalog entry per skill with its current visibility', async () => {
    const { remotes } = stubRemotes()
    const face = createSkillFilterFace(remotes)
    const listed = await face.listSkills('session' as never)
    expect(listed.ok && listed.value).toEqual([
      { name: 'git-commit', description: 'Commit a change', modelInvocable: true },
      { name: 'git-rebase', description: 'Rebase a branch', modelInvocable: false },
    ])
  })

  it('surfaces a failed catalog read unchanged', async () => {
    const remotes: SkillFilterRemotes = {
      skillFilter: stubRemotes().remotes.skillFilter,
      skills: {
        list: () => Promise.resolve({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'offline', {}),
        }),
      },
    }
    const face = createSkillFilterFace(remotes)
    const failed = await face.listSkills('session' as never)
    expect(failed.ok).toBe(false)
  })

  it('does not re-request a read the caller did not make', async () => {
    const { remotes, calls } = stubRemotes()
    const face = createSkillFilterFace(remotes)
    await face.loadPersonal()
    expect(calls.personal).toBe(1)
    expect(calls.skills).toBe(0)
  })
})

describe('catalog helpers', () => {
  it('groups a skill name by the segment before its first hyphen', () => {
    expect(prefixOf('git-commit')).toBe('git')
    expect(prefixOf('git')).toBeUndefined()
    expect(prefixOf('-git')).toBeUndefined()
  })

  it('filters the catalog by a case-insensitive substring', () => {
    const skills = [
      { name: 'git-commit', description: 'Commit a change', modelInvocable: true },
      { name: 'ue-build', description: 'Build the project', modelInvocable: true },
    ]
    expect(filterByQuery(skills, '').length).toBe(2)
    expect(filterByQuery(skills, 'GIT').map(skill => skill.name)).toEqual(['git-commit'])
    expect(filterByQuery(skills, 'build').map(skill => skill.name)).toEqual(['ue-build'])
    expect(filterByQuery(skills, 'nothing').length).toBe(0)
  })

  it('adds and removes one exact skill name without disturbing the other patterns', () => {
    expect(toggleName(['*'], 'git-commit', false)).toEqual(['*', 'git-commit'])
    expect(toggleName(['*', 'git-commit'], 'git-commit', true)).toEqual(['*'])
    expect(toggleName(['ue-*'], 'git-commit', false)).toEqual(['ue-*', 'git-commit'])
  })
})
