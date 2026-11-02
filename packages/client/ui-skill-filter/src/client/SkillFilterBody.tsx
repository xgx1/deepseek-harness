/**
 * The skill-filter Sidebar tab: the project layer's draft, and the merged rules
 * in force for this project with the session's catalog and each skill's current
 * visibility.
 *
 * The merged view is the Host's own answer — the union of the personal and
 * project layers. The project panel's draft comes from `useProjectLayer`, the
 * same panel the Settings page shows.
 */
import { useEffect, useMemo, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillFilterEffectiveView } from '@deepseek-ai/dsh-api-skill-filter-controller/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillFilterFace, SkillFilterSkillEntry } from './face.ts'
import { toggleName } from './face.ts'
import type {} from './locales.ts'
import { ProjectRulesPanel, useProjectLayer } from './ProjectRules.tsx'
import { SkillCatalog } from './SkillCatalog.tsx'
import css from './skill-filter.module.css'

/** Props the tab body receives: runtime share, copy, and the Host face. */
export type SkillFilterBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'skillFilter'>
  & SkillFilterFace

/** The merged layer's local state. */
type EffectiveState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly view: SkillFilterEffectiveView }
  | { readonly status: 'failed' }

/** The catalog request's local state. */
type CatalogState =
  | { readonly status: 'loading'; readonly sessionId: SessionId }
  | { readonly status: 'ready'; readonly sessionId: SessionId; readonly skills: readonly SkillFilterSkillEntry[] }
  | { readonly status: 'failed'; readonly sessionId: SessionId }

/**
 * Render the merged skill-filter rules and the project layer for the session's project.
 * @param props - composed slot props plus the Host calls.
 * @returns the tab body element tree.
 */
export function SkillFilterBody(props: SkillFilterBodyProps) {
  const {
    t, loadProject, saveProject, loadEffective, listSkills, useSessions, sessionId,
  } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const [effective, setEffective] = useState<EffectiveState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading', sessionId })
  const [reload, setReload] = useState(0)
  const layer = useProjectLayer({
    cwd,
    loadProject,
    saveProject,
    loadEffective,
    onSaved: () => { setReload(value => value + 1) },
  })

  useEffect(() => {
    if (cwd === undefined) return
    let live = true
    setEffective({ status: 'loading' })
    void loadEffective(cwd).then((result) => {
      if (!live) return
      setEffective(result.ok ? { status: 'ready', view: result.value } : { status: 'failed' })
    })
    return () => { live = false }
  }, [loadEffective, cwd, reload])

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

  const allowSet = useMemo(() => new Set(layer.allow), [layer.allow])
  const denySet = useMemo(() => new Set(layer.deny), [layer.deny])
  const merged = effective.status === 'ready' ? effective.view : undefined
  const skills = catalog.status === 'ready' ? catalog.skills : undefined

  return (
    <div className={css.body}>
      <div className={css.panel}>
        <h3 className={css.heading}>{t('effective')}</h3>
        {merged === undefined && <p className={css.note}>{t('catalog.loadFailed')}</p>}
        {merged !== undefined && merged.config === undefined && (
          <p className={css.note}>{t('effective.none')}</p>
        )}
        {merged?.config !== undefined && (
          <>
            <p className={css.note}>
              {merged.personalExists ? t('personal.present') : t('personal.absent')}
              {' · '}
              {merged.projectExists ? t('project.present') : t('project.absent')}
            </p>
            <p className={css.mergedPatterns}>
              {t('effective.allow')}: {merged.config.allow.join(', ')}
            </p>
            {merged.config.deny !== undefined && merged.config.deny.length > 0 && (
              <p className={css.mergedPatterns}>
                {t('effective.deny')}: {merged.config.deny.join(', ')}
              </p>
            )}
          </>
        )}
      </div>

      <ProjectRulesPanel t={t} layer={layer} canSave={cwd !== undefined} />

      <SkillCatalog
        t={t}
        skills={skills}
        loading={catalog.status === 'loading'}
        failed={catalog.status === 'failed'}
        onRetry={() => { setReload(value => value + 1) }}
        query={query}
        onQueryChange={setQuery}
        isAllowed={name => allowSet.has(name)}
        isDenied={name => denySet.has(name)}
        onAllow={(name) => {
          layer.setAllow(toggleName(layer.allow, name, allowSet.has(name)))
          layer.setDeny(layer.deny.filter(pattern => pattern !== name))
        }}
        onDeny={(name) => {
          layer.setDeny(toggleName(layer.deny, name, denySet.has(name)))
          layer.setAllow(layer.allow.filter(pattern => pattern !== name))
        }}
      />
    </div>
  )
}
