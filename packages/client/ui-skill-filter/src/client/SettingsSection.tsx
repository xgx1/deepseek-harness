/**
 * The skill-filter settings page: the personal rule lists, the suggested prefix
 * groups, and the session's skill catalog with one allow/deny switch per skill.
 *
 * The page reads the personal layer on mount and the catalog once the session
 * list reports a Session. Both live in component state; a save writes the
 * personal layer and republishes the loaded copy so the rows reflect what the
 * Host accepted.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillFilterFace, SkillFilterSkillEntry } from './face.ts'
import { prefixOf, toggleName } from './face.ts'
import type {} from './locales.ts'
import { RuleList } from './RuleList.tsx'
import { SkillCatalog } from './SkillCatalog.tsx'
import type {
  SkillFilterConfigView, SkillFilterPersonalView,
} from '@deepseek-ai/dsh-api-skill-filter-controller/types'
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

/** The personal layer's local state. */
type PersonalState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly view: SkillFilterPersonalView }

/** The save's local state. */
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/** The empty draft a first-run user starts from. */
const EMPTY_CONFIG: SkillFilterConfigView = { allow: [] }

/**
 * Render the skill-filter settings page.
 * @param props - composed slot props plus the Host calls.
 * @returns the section element tree.
 */
export function SkillFilterSettingsSection(props: SkillFilterSettingsSectionProps) {
  const { t, loadPersonal, savePersonal, listSkills, useSessions } = props
  const [personal, setPersonal] = useState<PersonalState>({ status: 'loading' })
  const [allow, setAllow] = useState<readonly string[]>([])
  const [deny, setDeny] = useState<readonly string[]>([])
  const [save, setSave] = useState<SaveState>('idle')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'absent' })
  const [reload, setReload] = useState(0)

  const target = useSessions((state) => {
    const sessions = Object.values(state.byId)
    return sessions.find(session => (session.retainedBy.mainView ?? 0) > 0) ?? sessions[0]
  })
  const sessionId = target?.id
  const cwd = target?.cwd

  useEffect(() => {
    let live = true
    void loadPersonal().then((result) => {
      if (!live) return
      setPersonal({ status: 'ready', view: result.ok ? result.value : { exists: false } })
    })
    return () => { live = false }
  }, [loadPersonal, reload])

  useEffect(() => {
    const view = personal.status === 'ready' ? personal.view : undefined
    const loaded = view?.config ?? (view?.exists === false ? EMPTY_CONFIG : undefined)
    if (loaded === undefined) return
    setAllow([...loaded.allow])
    setDeny(loaded.deny === undefined ? [] : [...loaded.deny])
  }, [personal])

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

  const onSave = useCallback(() => {
    setSave('saving')
    const config: SkillFilterConfigView = {
      allow: allow.filter(pattern => pattern.length > 0),
      ...deny.filter(pattern => pattern.length > 0).length > 0
        ? { deny: deny.filter(pattern => pattern.length > 0) }
        : {},
    }
    void savePersonal(config).then((result) => {
      setSave(result.ok ? 'saved' : 'failed')
      if (result.ok) setReload(value => value + 1)
    })
  }, [allow, deny, savePersonal])

  const allowSet = useMemo(() => new Set(allow), [allow])
  const denySet = useMemo(() => new Set(deny), [deny])
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

  const personalView = personal.status === 'ready' ? personal.view : undefined
  const statusLine = personalView === undefined
    ? undefined
    : personalView.error !== undefined
      ? t('personal.error')
      : personalView.exists
        ? t('personal.present')
        : t('personal.absent')

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.note}>{t('intro')}</p>

      <div className={css.panel}>
        <h3 className={css.heading}>{t('personal')}</h3>
        <p className={css.note}>{t('personal.intro')}</p>
        {statusLine !== undefined && <p className={css.note}>{statusLine}</p>}
        <RuleList
          t={t}
          heading={t('personal.allow')}
          hint={t('personal.allowHint')}
          patterns={allow}
          onChange={setAllow}
        />
        <RuleList
          t={t}
          heading={t('personal.deny')}
          hint={t('personal.denyHint')}
          patterns={deny}
          onChange={setDeny}
        />
        <div className={css.actions}>
          <Button variant="primary" disabled={save === 'saving'} onClick={onSave}>
            {save === 'saving' ? t('action.saving') : t('action.save')}
          </Button>
          {save === 'saved' && <span className={css.note}>{t('action.saved')}</span>}
          {save === 'failed' && <span className={css.error}>{t('action.saveFailed')}</span>}
        </div>
      </div>

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
                onClick={() => { setAllow(current => toggleName(current, `${prefix}-*`, current.includes(`${prefix}-*`))) }}
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

      {cwd === undefined && <p className={css.note}>{t('catalog.unavailable')}</p>}
    </div>
  )
}
