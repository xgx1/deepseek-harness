/**
 * The skill-filter page as a Conversation view: the catalog with one switch per
 * skill, beside the project and personal layers it is filtered by.
 *
 * The catalog's switches edit the project draft, so a page reached from a
 * conversation changes what this project's model sees. Both layers come from
 * the same hooks the Settings section and the Sidebar tab use.
 */
import { useEffect, useMemo, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillFilterFace, SkillFilterSkillEntry } from './face.ts'
import { toggleName } from './face.ts'
import type {} from './locales.ts'
import { PersonalRulesPanel, usePersonalLayer } from './PersonalRules.tsx'
import { ProjectRulesPanel, useProjectLayer } from './ProjectRules.tsx'
import { SkillCatalog } from './SkillCatalog.tsx'
import css from './SkillFilterView.module.css'

/** Props the Conversation view receives: runtime share, copy, and the Host face. */
export type SkillFilterViewProps =
  & ConvViewProps
  & PropsLocale<'skillFilter'>
  & SkillFilterFace

/** The catalog request's local state. */
type CatalogState =
  | { readonly status: 'loading'; readonly sessionId: SessionId }
  | { readonly status: 'ready'; readonly sessionId: SessionId; readonly skills: readonly SkillFilterSkillEntry[] }
  | { readonly status: 'failed'; readonly sessionId: SessionId }

/**
 * Render the skill-filter page inside the Conversation area.
 * @param props - composed view props plus the Host calls.
 * @returns the page element tree.
 */
export function SkillFilterView(props: SkillFilterViewProps) {
  const {
    t, loadPersonal, savePersonal, loadProject, saveProject, loadEffective, listSkills,
    useSessions, sessionId,
  } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading', sessionId })
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const refresh = useMemo(() => () => { setReload(value => value + 1) }, [])
  const personal = usePersonalLayer({ loadPersonal, savePersonal, onSaved: refresh })
  const project = useProjectLayer({ cwd, loadProject, saveProject, loadEffective, onSaved: refresh })

  useEffect(() => {
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

  const allowSet = useMemo(() => new Set(project.allow), [project.allow])
  const skills = catalog.status === 'ready' ? catalog.skills : undefined
  const total = skills?.length ?? 0
  const visible = skills?.filter(skill => skill.modelInvocable).length ?? 0

  return (
    <div className={css.page}>
      <header className={css.hero}>
        <div className={css.heroText}>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('intro')}</p>
        </div>
        <div className={css.stats}>
          <span className={css.stat}>
            <span className={css.statValue}>{total}</span>
            <span className={css.statLabel}>{t('page.total')}</span>
          </span>
          <span className={css.stat} data-tone="visible">
            <span className={css.statValue}>{visible}</span>
            <span className={css.statLabel}>{t('state.visible')}</span>
          </span>
          <span className={css.stat} data-tone="hidden">
            <span className={css.statValue}>{total - visible}</span>
            <span className={css.statLabel}>{t('state.hidden')}</span>
          </span>
        </div>
      </header>

      <div className={css.columns}>
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
            project.setAllow(toggleName(project.allow, name, allowSet.has(name)))
          }}
        />
        <div className={css.stack}>
          <ProjectRulesPanel t={t} layer={project} canSave={cwd !== undefined} />
          <PersonalRulesPanel t={t} layer={personal} />
        </div>
      </div>
    </div>
  )
}
