/**
 * Catalog overview on the General settings page: every config with the skills,
 * MCP servers and tools it contributes, and every project's selection. Read
 * only — the per-project selection is edited by the chip on the new-session
 * screen, so this panel never writes.
 */

import { useEffect, useState } from 'react'
import type { AgentConfigOverview as Overview } from '@deepseek-ai/dsh-agent-config/types'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AgentConfigOverview.module.css'

/** Registration-side business face for the overview panel. */
export interface AgentConfigOverviewInjected {
  /**
   * Read the whole catalog and every project selection.
   * @returns the Host view, or undefined when the read failed.
   */
  read: () => Promise<Overview | undefined>
}

/** Full component props: this namespace's copy and the Host face. */
export type AgentConfigOverviewProps =
  PropsLocale<'agentConfig'> & InjectFace<AgentConfigOverviewInjected>

/**
 * Render the configuration catalog and the project selections.
 * @param props - composed slot props.
 * @returns the panel, or nothing while the document is unreadable.
 */
export function AgentConfigOverview({ read, t }: AgentConfigOverviewProps) {
  const [view, setView] = useState<Overview | undefined>(undefined)
  useEffect(() => {
    let current = true
    void read().then((next) => { if (current) setView(next) })
    return () => { current = false }
  }, [read])

  if (view === undefined) return null
  if (view.error !== undefined || view.configs.length === 0) {
    return <div className={css.section}>
      <div className={css.title}>{t('overview.title')}</div>
      <div className={css.empty}>{view.error ?? t('overview.empty')}</div>
    </div>
  }

  const counts = (entry: { skills: readonly string[]; mcp: readonly string[]; tools: readonly string[] }): string =>
    t('overview.counts', { skills: entry.skills.length, mcp: entry.mcp.length, tools: entry.tools.length })

  return <div className={css.section}>
    <div className={css.head}>
      <span className={css.title}>{t('overview.title')}</span>
      <span className={css.muted}>{t('overview.configs', { count: view.configs.length })} · {t('overview.projects', { count: view.projects.length })}</span>
    </div>
    <div className={css.muted}>{t('overview.source', { path: view.path })}</div>
    <div className={css.rows}>
      {view.configs.map((config) => {
        // Only the dimensions this config actually contributes; an empty list is noise.
        const groups = ([
          ['overview.skills', config.skills],
          ['overview.mcp', config.mcp],
          ['overview.tools', config.tools],
        ] as const).filter(([, values]) => values.length > 0)
        return <details className={css.row} key={config.name}>
          <summary className={css.summary}>
            <span className={css.name}>{config.name}</span>
            <span className={css.muted}>{counts(config)}</span>
          </summary>
          {groups.map(([label, values]) => <ul className={css.list} key={label}>
            <li>{t(label)}: {values.join(', ')}</li>
          </ul>)}
        </details>
      })}
    </div>
    <div className={css.rows} style={{ marginTop: 12 }}>
      {view.projects.map(project => <div className={css.row} key={project.cwd}>
        <div className={css.summary}>
          <span className={css.name}>{project.cwd}</span>
          <span className={css.muted}>{t('overview.selected', { names: project.selected.join(', ') })}</span>
        </div>
      </div>)}
    </div>
    <div className={css.muted} style={{ marginTop: 8 }}>{t('overview.unlisted')}</div>
  </div>
}
