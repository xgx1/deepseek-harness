/**
 * The project layer of the skill filter: the state a surface drives, and the
 * panel that renders it.
 *
 * Both surfaces show the same panel — the Settings page beside the personal
 * rules, the Sidebar tab above the merged view — so the draft, the seeding rule
 * and the save path live here once instead of in each seat.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SkillFilterConfigView, SkillFilterEffectiveView, SkillFilterProjectView,
} from '@deepseek-ai/dsh-api-skill-filter-controller/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import { RuleList } from './RuleList.tsx'
import css from './skill-filter.module.css'

/** One layer's save state, shared by the personal and project drafts. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/** Everything a surface renders and drives for the project layer. */
export interface ProjectLayer {
  /** Whether the layered read has settled. */
  readonly status: 'loading' | 'ready' | 'failed'
  /** Whether the project config file exists. */
  readonly exists: boolean
  /** The project config's parse error, when it has one. */
  readonly error: string | undefined
  /** The project allow draft. */
  readonly allow: readonly string[]
  /** The save's state. */
  readonly save: SaveState
  /** Replace the allow draft. */
  readonly setAllow: (patterns: readonly string[]) => void
  /** Persist the draft as the project layer. */
  readonly onSave: () => void
  /** Why the last save was refused, as the Host worded it. */
  readonly reason: string | undefined
}

/** The Host calls and the address the project layer is read and written with. */
export interface UseProjectLayerOptions {
  /** The session's working directory; nothing loads until it is known. */
  readonly cwd: string | undefined
  /** Read one project's config layer. */
  readonly loadProject: (cwd: string) => Promise<RemoteResult<SkillFilterProjectView>>
  /** Replace one project's config layer. */
  readonly saveProject: (cwd: string, config: SkillFilterConfigView) => Promise<RemoteResult<SkillFilterProjectView>>
  /** Read the merged config, which seeds the draft while the project layer is absent. */
  readonly loadEffective: (cwd: string) => Promise<RemoteResult<SkillFilterEffectiveView>>
  /** Called after an accepted save, for whatever the caller shows beside the panel. */
  readonly onSaved?: () => void
}

/**
 * Read, edit and save one project's skill-filter layer.
 * @param options - the working directory, the Host calls and the save hook.
 * @returns the state and actions the panel renders.
 */
export function useProjectLayer(options: UseProjectLayerOptions): ProjectLayer {
  const { cwd, loadProject, saveProject, loadEffective, onSaved } = options
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [exists, setExists] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [allow, setAllow] = useState<readonly string[]>([])
  const [save, setSave] = useState<SaveState>('idle')
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (cwd === undefined) return
    let live = true
    setStatus('loading')
    // ponytail: a seat that also reads the merged config fetches it twice on
    // mount; both reads are one small YAML behind a local Remote.
    void Promise.all([loadProject(cwd), loadEffective(cwd)]).then(([projectResult, effectiveResult]) => {
      if (!live) return
      if (projectResult.ok) {
        setStatus('ready')
        setExists(projectResult.value.exists)
        setError(projectResult.value.error)
      } else {
        setStatus('failed')
        setExists(false)
        setError(undefined)
      }
      // The layers union, so the project draft starts from the project's own
      // lists when it exists, otherwise from the rules in force.
      const seeded = projectResult.ok ? projectResult.value.config : undefined
      const inherited = effectiveResult.ok ? effectiveResult.value.config : undefined
      const base = seeded ?? inherited
      if (base !== undefined) {
        setAllow([...base.allow])
      }
    })
    return () => { live = false }
  }, [cwd, loadProject, loadEffective, reload])

  // The Host refuses an empty allow list, and the project draft starts from the
  // merged rules when no project file exists — so "clear the wildcard, then add
  // mine" passes through a state the Host will never accept. Name it before the
  // Save is pressed instead of after.
  const emptyAllow = allow.every(pattern => pattern.length === 0)

  const onSave = useCallback(() => {
    if (cwd === undefined || emptyAllow) return
    setSave('saving')
    setReason(undefined)
    const kept = allow.filter(pattern => pattern.length > 0)
    void saveProject(cwd, { allow: kept }).then((result) => {
      if (result.ok) {
        setSave('saved')
        setReload(value => value + 1)
        onSaved?.()
        return
      }
      setSave('failed')
      setReason(result.error.message)
    })
  }, [allow, cwd, saveProject, onSaved, emptyAllow])

  return { status, exists, error, allow, save, reason, setAllow, onSave }
}

/** Props the project panel receives. */
export interface ProjectRulesPanelProps {
  /** Namespace-bound translate. */
  readonly t: PropsLocale<'skillFilter'>['t']
  /** The layer the owning surface drives. */
  readonly layer: ProjectLayer
  /** Whether a working directory is known; a save needs one. */
  readonly canSave?: boolean
}

/**
 * Render the project layer's heading, state line, rule lists and save control.
 * @param props - the copy, the layer and whether saving is possible.
 * @returns the panel element tree.
 */
export function ProjectRulesPanel({ t, layer, canSave = true }: ProjectRulesPanelProps) {
  return (
    <div className={css.panel}>
      <h3 className={css.heading}>{t('project')}</h3>
      <p className={css.note}>{t('project.intro')}</p>
      {layer.status === 'ready' && layer.error !== undefined && (
        <p className={css.error}>{t('project.error')}</p>
      )}
      {layer.status === 'failed' && <p className={css.error}>{t('project.error')}</p>}
      {layer.status === 'ready' && !layer.exists && (
        <p className={css.note}>{t('project.absent')} · {t('project.inherits')}</p>
      )}
      {layer.status === 'ready' && layer.exists && (
        <p className={css.note}>{t('project.present')}</p>
      )}
      <RuleList
        t={t}
        heading={t('project.allow')}
        hint={t('project.allowHint')}
        patterns={layer.allow}
        onChange={layer.setAllow}
      />
      <div className={css.actions}>
        <Button
          variant="primary"
          disabled={layer.save === 'saving' || !canSave || layer.allow.every(pattern => pattern.length === 0)}
          onClick={layer.onSave}
        >
          {layer.save === 'saving' ? t('action.saving') : t('action.save')}
        </Button>
        {layer.save === 'saved' && <span className={css.note}>{t('action.saved')}</span>}
        {layer.save === 'failed' && <span className={css.error}>{t('action.saveFailed')}</span>}
        {layer.reason !== undefined && <span className={css.error}>{layer.reason}</span>}
      </div>
      {layer.allow.every(pattern => pattern.length === 0) && (
        <p className={css.note}>{t('action.allowRequired')}</p>
      )}
    </div>
  )
}
