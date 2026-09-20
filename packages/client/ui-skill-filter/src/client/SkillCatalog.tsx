/**
 * The skill catalog half shared by the settings page and the Sidebar tab: a
 * search box over the Session's user-invocable skills, each row's current
 * visibility, and the allow/deny switch for one skill name.
 *
 * Every list the rows write arrives as a draft from the caller; this component
 * owns no persistence of its own.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillFilterSkillEntry } from './face.ts'
import { filterByQuery } from './face.ts'
import type {} from './locales.ts'
import css from './skill-filter.module.css'

/** Props the catalog half receives. */
export interface SkillCatalogProps {
  /** Namespace-bound translate. */
  t: PropsLocale<'skillFilter'>['t']
  /** The catalog as loaded, or undefined while it is unavailable. */
  skills: readonly SkillFilterSkillEntry[] | undefined
  /** Whether the catalog request is in flight. */
  loading: boolean
  /** Whether the last catalog request failed. */
  failed: boolean
  /** Retry the catalog request. */
  onRetry: () => void
  /** The live search text. */
  query: string
  /** Replace the search text. */
  onQueryChange: (query: string) => void
  /** Whether one skill name currently sits in the allow draft. */
  isAllowed: (name: string) => boolean
  /** Whether one skill name currently sits in the deny draft. */
  isDenied: (name: string) => boolean
  /** Move one skill name into the allow draft. */
  onAllow: (name: string) => void
  /** Move one skill name into the deny draft. */
  onDeny: (name: string) => void
}

/**
 * Render the searchable catalog with one allow/deny switch per skill.
 * @param props - the catalog's data and callbacks.
 * @returns the catalog element tree.
 */
export function SkillCatalog(props: SkillCatalogProps) {
  const { t, skills, loading, failed, onRetry, query, onQueryChange, isAllowed, isDenied, onAllow, onDeny } = props
  if (skills === undefined) {
    return (
      <div className={css.panel}>
        <h3 className={css.heading}>{t('catalog')}</h3>
        <p className={css.note}>{failed ? t('catalog.loadFailed') : t('catalog.unavailable')}</p>
        {failed && <Button size="sm" onClick={onRetry}>{t('catalog.retry')}</Button>}
      </div>
    )
  }

  const visible = filterByQuery(skills, query)
  return (
    <div className={css.panel}>
      <h3 className={css.heading}>{t('catalog')}</h3>
      <p className={css.note}>{t('catalog.intro')}</p>
      <span className={css.search}>
        <Input
          value={query}
          aria-label={t('catalog.search')}
          onChange={(event) => { onQueryChange(event.target.value) }}
        />
      </span>
      {loading && <p className={css.note}>{t('action.saving')}</p>}
      {!loading && visible.length === 0 && <p className={css.note}>{t('catalog.empty')}</p>}
      <ul className={css.skills}>
        {visible.map((skill) => {
          const allowed = isAllowed(skill.name)
          const denied = isDenied(skill.name)
          return (
            <li key={skill.name} className={css.skillRow}>
              <span className={css.skillName}>{skill.name}</span>
              <span className={css.skillDescription}>{skill.description}</span>
              <span className={css.skillState} data-state={skill.modelInvocable ? 'visible' : 'hidden'}>
                {skill.modelInvocable ? t('state.visible') : t('state.hidden')}
              </span>
              <span className={css.skillActions}>
                <Button
                  size="sm"
                  variant={allowed ? 'primary' : 'ghost'}
                  onClick={() => { onAllow(skill.name) }}
                >
                  {t('action.allow')}
                </Button>
                <Button
                  size="sm"
                  variant={denied ? 'primary' : 'ghost'}
                  onClick={() => { onDeny(skill.name) }}
                >
                  {t('action.deny')}
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
