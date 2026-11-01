/**
 * The personal layer of the skill filter: the state a surface drives, and the
 * panel that renders it.
 *
 * `useProjectLayer` is the same shape for the project layer, so a page that
 * shows both — the Settings section and the Conversation tab — reuses one draft
 * model instead of writing the load/save plumbing twice.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SkillFilterConfigView, SkillFilterPersonalView,
} from '@deepseek-ai/dsh-api-skill-filter-controller/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import { RuleList } from './RuleList.tsx'
import type { SaveState } from './ProjectRules.tsx'
import css from './skill-filter.module.css'

/** Everything a surface renders and drives for the personal layer. */
export interface PersonalLayer {
  /** Whether the layer read has settled. */
  readonly status: 'loading' | 'ready' | 'failed'
  /** Whether the personal config file exists. */
  readonly exists: boolean
  /** The personal config's parse error, when it has one. */
  readonly error: string | undefined
  /** The personal allow draft. */
  readonly allow: readonly string[]
  /** The personal deny draft. */
  readonly deny: readonly string[]
  /** The save's state. */
  readonly save: SaveState
  /** Replace the allow draft. */
  readonly setAllow: (patterns: readonly string[]) => void
  /** Replace the deny draft. */
  readonly setDeny: (patterns: readonly string[]) => void
  /** Persist both drafts as the personal layer. */
  readonly onSave: () => void
}

/** The Host calls one surface's personal layer is read and written with. */
export interface UsePersonalLayerOptions {
  /** Read the personal config layer. */
  readonly loadPersonal: () => Promise<RemoteResult<SkillFilterPersonalView>>
  /** Replace the personal config layer. */
  readonly savePersonal: (config: SkillFilterConfigView) => Promise<RemoteResult<SkillFilterPersonalView>>
  /** Called after an accepted save, for whatever the caller shows beside the panel. */
  readonly onSaved?: () => void
}

/**
 * Read, edit and save the personal skill-filter layer.
 * @param options - the Host calls and the save hook.
 * @returns the state and actions the panel renders.
 */
export function usePersonalLayer(options: UsePersonalLayerOptions): PersonalLayer {
  const { loadPersonal, savePersonal, onSaved } = options
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [exists, setExists] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [allow, setAllow] = useState<readonly string[]>([])
  const [deny, setDeny] = useState<readonly string[]>([])
  const [save, setSave] = useState<SaveState>('idle')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    setStatus('loading')
    void loadPersonal().then((result) => {
      if (!live) return
      if (!result.ok) {
        setStatus('failed')
        return
      }
      setStatus('ready')
      setExists(result.value.exists)
      setError(result.value.error)
      const seeded = result.value.config
      if (seeded === undefined) return
      setAllow([...seeded.allow])
      setDeny(seeded.deny === undefined ? [] : [...seeded.deny])
    })
    return () => { live = false }
  }, [loadPersonal, reload])

  const onSave = useCallback(() => {
    setSave('saving')
    const kept = allow.filter(pattern => pattern.length > 0)
    const dropped = deny.filter(pattern => pattern.length > 0)
    void savePersonal({ allow: kept, ...dropped.length > 0 ? { deny: dropped } : {} }).then((result) => {
      setSave(result.ok ? 'saved' : 'failed')
      if (!result.ok) return
      setReload(value => value + 1)
      onSaved?.()
    })
  }, [allow, deny, savePersonal, onSaved])

  return { status, exists, error, allow, deny, save, setAllow, setDeny, onSave }
}

/** Props the personal panel receives. */
export interface PersonalRulesPanelProps {
  /** Namespace-bound translate. */
  readonly t: PropsLocale<'skillFilter'>['t']
  /** The layer the owning surface drives. */
  readonly layer: PersonalLayer
}

/**
 * Render the personal layer's heading, state line, rule lists and save control.
 * @param props - the copy and the layer.
 * @returns the panel element tree.
 */
export function PersonalRulesPanel({ t, layer }: PersonalRulesPanelProps) {
  const statusLine = layer.status === 'failed'
    ? t('personal.error')
    : layer.status === 'loading'
      ? undefined
      : layer.error !== undefined
        ? t('personal.error')
        : layer.exists
          ? t('personal.present')
          : t('personal.absent')

  return (
    <div className={css.panel}>
      <h3 className={css.heading}>{t('personal')}</h3>
      <p className={css.note}>{t('personal.intro')}</p>
      {statusLine !== undefined && (
        <p className={layer.status === 'failed' || layer.error !== undefined ? css.error : css.note}>
          {statusLine}
        </p>
      )}
      <RuleList
        t={t}
        heading={t('personal.allow')}
        hint={t('personal.allowHint')}
        patterns={layer.allow}
        onChange={layer.setAllow}
      />
      <RuleList
        t={t}
        heading={t('personal.deny')}
        hint={t('personal.denyHint')}
        patterns={layer.deny}
        onChange={layer.setDeny}
      />
      <div className={css.actions}>
        <Button variant="primary" disabled={layer.save === 'saving'} onClick={layer.onSave}>
          {layer.save === 'saving' ? t('action.saving') : t('action.save')}
        </Button>
        {layer.save === 'saved' && <span className={css.note}>{t('action.saved')}</span>}
        {layer.save === 'failed' && <span className={css.error}>{t('action.saveFailed')}</span>}
      </div>
    </div>
  )
}
