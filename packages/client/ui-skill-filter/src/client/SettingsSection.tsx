/**
 * The skill-filter settings page: the personal and project rule layers, the
 * suggested prefix groups, and the session's catalog with one allow switch
 * per skill.
 *
 * Both layers are drafts owned by their hooks — the same ones the Conversation
 * view uses — and the catalog switches edit the personal layer here, beside the
 * lists this page also writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillFilterFace, SkillFilterSkillEntry } from './face.ts'
import { prefixOf, toggleName } from './face.ts'
import type {} from './locales.ts'
import { PersonalRulesPanel, usePersonalLayer } from './PersonalRules.tsx'
import { ProjectRulesPanel, useProjectLayer } from './ProjectRules.tsx'
import { SkillCatalog } from './SkillCatalog.tsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './skill-filter.module.css'

/** Props the section receives: the shell's runtime share, copy, and the Host face. */
export type SkillFilterSettingsSectionProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'skillFilter'>
  & SkillFilterFace

/** The catalog request's local state. */
type CatalogState =
  | { readonly status: 'absent' }
  | { readonly status: 'loading'; readonly sessionId: string }
  | { readonly status: 'ready'; readonly sessionId: string; readonly skills: readonly SkillFilterSkillEntry[] }
  | { readonly status: 'failed'; readonly sessionId: string }

/**
 * Render the skill-filter settings page.
 * @param props - composed slot props plus the Host calls.
 * @returns the section element tree.
 */
export function SkillFilterSettingsSection(props: SkillFilterSettingsSectionProps) {
  const {
    t, loadPersonal, savePersonal, loadProject, saveProject, loadEffective, listSkills, useSessions,
  } = props
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'absent' })
  const [reload, setReload] = useState(0)
  const refresh = useCallback(() => { setReload(value => value + 1) }, [])

  const target = useSessions((state) => {
    const sessions = Object.values(state.byId)
    return sessions.find(session => (session.retainedBy.mainView ?? 0) > 0) ?? sessions[0]
  })
  const sessionId = target?.id
  const cwd = target?.cwd
  const personal = usePersonalLayer({ loadPersonal, savePersonal, onSaved: refresh })
  const project = useProjectLayer({ cwd, loadProject, saveProject, loadEffective, onSaved: refresh })

  useEffect(() => {
    if (sessionId === undefined) {
      setCatalog({ status: 'absent' })
      return
    }
    let live = true
    setCatalog({ status: 'loading', sessionId })
    void listSkills(sessionId).then((result) => {
      if (!live) return
      setCatalog(result.ok
        ? { status: 'ready', sessionId, skills: result.value }
        : { status: 'failed', sessionId })
    })
    return () => { live = false }
  }, [listSkills, sessionId, reload])

  const allowSet = useMemo(() => new Set(personal.allow), [personal.allow])
  const skills = catalog.status === 'ready' ? catalog.skills : undefined

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const skill of skills ?? []) {
      const prefix = prefixOf(skill.name)
      if (prefix === undefined) continue
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])
  }, [skills])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.note}>{t('intro')}</p>

      <PersonalRulesPanel t={t} layer={personal} />

      {cwd !== undefined && <ProjectRulesPanel t={t} layer={project} />}

      <div className={css.panel}>
        <h3 className={css.heading}>{t('prefixes')}</h3>
        <p className={css.note}>{t('prefixes.intro')}</p>
        {groups.length === 0 && <p className={css.note}>{t('prefixes.empty')}</p>}
        <ul className={css.groups}>
          {groups.map(([prefix, count]) => (
            <li key={prefix} className={css.groupRow}>
              <span className={css.groupName}>{prefix}-*</span>
              <span className={css.note}>{count}</span>
              <Button
                size="sm"
                onClick={() => {
                  const pattern = `${prefix}-*`
                  personal.setAllow(toggleName(personal.allow, pattern, allowSet.has(pattern)))
                }}
              >
                {allowSet.has(`${prefix}-*`) ? t('action.clear') : t('action.allow')}
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <SkillCatalog
        t={t}
        skills={skills}
        loading={catalog.status === 'loading'}
        failed={catalog.status === 'failed'}
        onRetry={refresh}
        query={query}
        onQueryChange={setQuery}
        isAllowed={name => allowSet.has(name)}
        onAllow={(name) => {
          personal.setAllow(toggleName(personal.allow, name, allowSet.has(name)))
        }}
      />

      {cwd === undefined && <p className={css.note}>{t('catalog.unavailable')}</p>}
    </div>
  )
}
