/**
 * The skill-filter Sidebar tab: the merged rules in force for this project, the
 * project-level override lists, and the session's catalog with each skill's
 * current visibility.
 *
 * The merged view is the Host's own answer — the personal layer, the project
 * layer, and which one wins. The override lists below it are the draft that
 * `saveProject` persists; while no project config exists the tab says so and
 * the personal rules are what the merged panel shows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillFilterEffectiveView } from '@deepseek-ai/dsh-api-skill-filter-controller/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillFilterFace, SkillFilterSkillEntry } from './face.ts'
import { toggleName } from './face.ts'
import type {} from './locales.ts'
import { RuleList } from './RuleList.tsx'
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

/** The project layer's local state. */
type ProjectState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly exists: boolean; readonly error: string | undefined }
  | { readonly status: 'failed' }

/** The catalog request's local state. */
type CatalogState =
  | { readonly status: 'loading'; readonly sessionId: SessionId }
  | { readonly status: 'ready'; readonly sessionId: SessionId; readonly skills: readonly SkillFilterSkillEntry[] }
  | { readonly status: 'failed'; readonly sessionId: SessionId }

/** The save's local state. */
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * Render the merged skill-filter rules for the session's project.
 * @param props - composed slot props plus the Host calls.
 * @returns the tab body element tree.
 */
export function SkillFilterBody(props: SkillFilterBodyProps) {
  const {
    t, loadProject, saveProject, loadEffective, listSkills, useSessions, sessionId,
  } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const [effective, setEffective] = useState<EffectiveState>({ status: 'loading' })
  const [project, setProject] = useState<ProjectState>({ status: 'loading' })
  const [allow, setAllow] = useState<readonly string[]>([])
  const [deny, setDeny] = useState<readonly string[]>([])
  const [save, setSave] = useState<SaveState>('idle')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading', sessionId })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (cwd === undefined) return
    let live = true
    setProject({ status: 'loading' })
    setEffective({ status: 'loading' })
    void Promise.all([loadProject(cwd), loadEffective(cwd)]).then(([projectResult, effectiveResult]) => {
      if (!live) return
      if (projectResult.ok) {
        setProject({
          status: 'ready',
          exists: projectResult.value.exists,
          error: projectResult.value.error,
        })
      } else {
        setProject({ status: 'failed' })
      }
      if (effectiveResult.ok) setEffective({ status: 'ready', view: effectiveResult.value })
      else setEffective({ status: 'failed' })
      // A project config replaces the personal rules outright, so its own lists
      // are the draft. Without one, the draft starts from what is in force.
      const seeded = projectResult.ok ? projectResult.value.config : undefined
      const inherited = effectiveResult.ok ? effectiveResult.value.config : undefined
      const base = seeded ?? inherited
      if (base !== undefined) {
        setAllow([...base.allow])
        setDeny(base.deny === undefined ? [] : [...base.deny])
      }
    })
    return () => { live = false }
  }, [loadProject, loadEffective, cwd, reload])

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

  const onSave = useCallback(() => {
    if (cwd === undefined) return
    setSave('saving')
    void saveProject(cwd, {
      allow: allow.filter(pattern => pattern.length > 0),
      ...deny.filter(pattern => pattern.length > 0).length > 0
        ? { deny: deny.filter(pattern => pattern.length > 0) }
        : {},
    }).then((result) => {
      setSave(result.ok ? 'saved' : 'failed')
      if (result.ok) setReload(value => value + 1)
    })
  }, [allow, deny, cwd, saveProject])

  const allowSet = useMemo(() => new Set(allow), [allow])
  const denySet = useMemo(() => new Set(deny), [deny])
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
              {t('personal.allow')}: {merged.config.allow.join(', ')}
            </p>
            {merged.config.deny !== undefined && merged.config.deny.length > 0 && (
              <p className={css.mergedPatterns}>
                {t('personal.deny')}: {merged.config.deny.join(', ')}
              </p>
            )}
          </>
        )}
      </div>

      <div className={css.panel}>
        <h3 className={css.heading}>{t('project')}</h3>
        <p className={css.note}>{t('project.intro')}</p>
        {project.status === 'ready' && project.error !== undefined && (
          <p className={css.error}>{t('project.error')}</p>
        )}
        {project.status === 'ready' && !project.exists && (
          <p className={css.note}>{t('project.absent')} · {t('project.inherits')}</p>
        )}
        {project.status === 'ready' && project.exists && (
          <p className={css.note}>{t('project.present')}</p>
        )}
        <RuleList t={t} heading={t('personal.allow')} hint={t('personal.allowHint')} patterns={allow} onChange={setAllow} />
        <RuleList t={t} heading={t('personal.deny')} hint={t('personal.denyHint')} patterns={deny} onChange={setDeny} />
        <div className={css.actions}>
          <Button variant="primary" disabled={save === 'saving' || cwd === undefined} onClick={onSave}>
            {save === 'saving' ? t('action.saving') : t('action.save')}
          </Button>
          {save === 'saved' && <span className={css.note}>{t('action.saved')}</span>}
          {save === 'failed' && <span className={css.error}>{t('action.saveFailed')}</span>}
        </div>
      </div>

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
          setAllow(current => toggleName(current, name, current.includes(name)))
          setDeny(current => current.filter(pattern => pattern !== name))
        }}
        onDeny={(name) => {
          setDeny(current => toggleName(current, name, current.includes(name)))
          setAllow(current => current.filter(pattern => pattern !== name))
        }}
      />
    </div>
  )
}
