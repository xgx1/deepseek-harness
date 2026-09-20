/**
 * The skill-filter surfaces' asynchronous half: every Host read and write the
 * settings page and the Sidebar tab perform.
 *
 * The component never awaits anything. It calls these members and folds the
 * settled `RemoteResult` into its own local state, which is all the presentation
 * half needs to decide what to draw.
 */

import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SkillFilterConfigView, SkillFilterEffectiveView, SkillFilterPersonalView, SkillFilterProjectView,
} from '@deepseek-ai/dsh-api-skill-filter-controller/types'

/** One skill catalog entry, as the Session skills Remote reports it. */
export interface SkillFilterSkillEntry {
  readonly name: string
  readonly description: string
  readonly modelInvocable: boolean
}

/**
 * The slice of the Client Remote face this package calls: the `skillFilter`
 * namespace and the Session catalog's `skills.list`, exactly as the Host's
 * generated client declares them.
 */
export type SkillFilterRemotes = {
  readonly skillFilter: Pick<
    ClientRemote['skillFilter'],
    'getPersonal' | 'setPersonal' | 'getProject' | 'setProject' | 'getEffective'
  >
  readonly skills: Pick<ClientRemote['skills'], 'list'>
}

/** Every Host call the two surfaces make, bound to one Remote face. */
export interface SkillFilterFace {
  /** Read the personal config layer. */
  loadPersonal: () => Promise<RemoteResult<SkillFilterPersonalView>>
  /** Replace the personal config layer. */
  savePersonal: (config: SkillFilterConfigView) => Promise<RemoteResult<SkillFilterPersonalView>>
  /** Read one project's config layer. */
  loadProject: (cwd: string) => Promise<RemoteResult<SkillFilterProjectView>>
  /** Replace one project's config layer. */
  saveProject: (cwd: string, config: SkillFilterConfigView) => Promise<RemoteResult<SkillFilterProjectView>>
  /** Read the merged config for one project. */
  loadEffective: (cwd: string) => Promise<RemoteResult<SkillFilterEffectiveView>>
  /** Read one Session's user-invocable skill catalog, with each skill's current visibility. */
  listSkills: (sessionId: SessionId) => Promise<RemoteResult<readonly SkillFilterSkillEntry[]>>
}

/**
 * Bind the surfaces' Host calls to one Remote face.
 * @param remote - the Client Remote face carrying the `skillFilter` and `skills` namespaces.
 * @returns the calls the surfaces make.
 */
export function createSkillFilterFace(remote: SkillFilterRemotes): SkillFilterFace {
  const { skillFilter, skills } = remote
  return {
    loadPersonal: () => skillFilter.getPersonal(),
    savePersonal: config => skillFilter.setPersonal(config),
    loadProject: cwd => skillFilter.getProject({ cwd }),
    saveProject: (cwd, config) => skillFilter.setProject({ cwd, config }),
    loadEffective: cwd => skillFilter.getEffective({ cwd }),
    listSkills: async (sessionId) => {
      const result = await skills.list({ sessionId })
      if (!result.ok) return result
      return {
        ok: true,
        value: result.value.skills.map(skill => ({
          name: skill.name,
          description: skill.description,
          modelInvocable: skill.modelInvocable,
        })),
      }
    },
  }
}

/**
 * The prefix a skill name shares before its first hyphen, used to group the
 * catalog into whole-family allow decisions.
 * @param name - a skill name.
 * @returns the name's leading segment, or undefined when the name has none.
 */
export function prefixOf(name: string): string | undefined {
  const index = name.indexOf('-')
  return index > 0 ? name.slice(0, index) : undefined
}

/**
 * Filter one skill catalog by a free-text query.
 * @param skills - the catalog as loaded.
 * @param query - the search text; empty keeps every skill.
 * @returns the matching skills in the catalog's own order.
 */
export function filterByQuery(
  skills: readonly SkillFilterSkillEntry[],
  query: string,
): readonly SkillFilterSkillEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return skills
  return skills.filter(skill => skill.name.toLowerCase().includes(needle))
}

/**
 * Move one skill name between a rule list and the other, keeping every other
 * pattern in place.
 * @param patterns - the current pattern list.
 * @param name - the exact skill name to add or remove.
 * @param present - whether the name is currently in the list.
 * @returns the new pattern list.
 */
export function toggleName(
  patterns: readonly string[],
  name: string,
  present: boolean,
): readonly string[] {
  return present ? patterns.filter(pattern => pattern !== name) : [...patterns, name]
}
