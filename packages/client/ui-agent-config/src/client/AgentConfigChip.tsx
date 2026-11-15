/**
 * Project agent-config chip on the new-session screen, beside the preset chip.
 *
 * The roster and the selection are project-level: ticking a config persists
 * this working directory's selection through the Host Remote, so a session
 * that starts here already carries it. Nothing in this control is per-session
 * state, which is why it takes the working directory rather than a session.
 */

import { useEffect, useRef, useState } from 'react'
import type { AgentConfigSelectionView } from '@deepseek-ai/dsh-agent-config/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChecklistOutlineRegular, IconChevronDownOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the hero seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './AgentConfigChip.module.css'

/** Registration-side business face for the hero chip. */
export interface AgentConfigChipInjected {
  /**
   * Read the roster and this project's selection.
   * @param cwd - absolute project working directory.
   * @returns the Host view, or undefined when the read failed.
   */
  read: (cwd: string) => Promise<AgentConfigSelectionView | undefined>
  /**
   * Replace this project's complete selection; an empty list leaves it ungoverned, which allows no MCP server.
   * @param cwd - absolute project working directory.
   * @param selected - names to persist.
   * @returns the selection as persisted, or undefined when the write failed.
   */
  save: (cwd: string, selected: readonly string[]) => Promise<AgentConfigSelectionView | undefined>
}

/** Full component props: the project directory, this namespace's copy, and the Host face. */
export type AgentConfigChipProps =
  Pick<PropsRuntime<'conversation.hero.agentConfig'>, 'cwd'>
  & PropsLocale<'agentConfig'>
  & InjectFace<AgentConfigChipInjected>

/**
 * Render the new-session agent-config chip and its multi-select menu.
 * @param props - composed slot props.
 * @returns The chip, or null without a project directory, a roster, or a readable document.
 */
export function AgentConfigChip({ cwd, read, save, t }: AgentConfigChipProps) {
  const [view, setView] = useState<AgentConfigSelectionView | undefined>(undefined)
  const [open, setOpen] = useState(false)
  // One write at a time: overlapping replacements can land out of order.
  const [busy, setBusy] = useState(false)
  // Last view the Host confirmed, so a refused write restores it without another round trip.
  const confirmed = useRef<AgentConfigSelectionView | undefined>(undefined)

  useEffect(() => {
    if (cwd === undefined) {
      setView(undefined)
      return
    }
    let current = true
    void read(cwd).then((next) => {
      if (!current) return
      confirmed.current = next
      setView(next)
    })
    return () => { current = false }
  }, [cwd, read])

  // No project directory, no roster, or an unreadable document: nothing to govern.
  if (cwd === undefined || view === undefined || view.error !== undefined || view.configs.length === 0) return null

  const { selected } = view
  const toggle = (name: string): void => {
    if (busy) return
    const next = selected.includes(name)
      ? selected.filter(entry => entry !== name)
      : [...selected, name]
    // The tick lands with the click; a refused write restores the last Host-confirmed selection.
    setView({ ...view, selected: next })
    setBusy(true)
    void save(cwd, next).then((saved) => {
      if (saved === undefined) setView(confirmed.current ?? view)
      else {
        confirmed.current = saved
        setView(saved)
      }
    }).finally(() => { setBusy(false) })
  }

  const label = selected.length === 0
    ? t('chip.none')
    : t('chip.count', { count: selected.length })

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={view.configs.map(config => ({
        id: config.name,
        label: (
          <span className={css.item}>
            <span className={css.itemName}>{config.name}</span>
            <span className={css.itemDesc}>
              {t('option.summary', { skills: config.skills.length, mcp: config.mcp.length, tools: config.tools.length })}
            </span>
          </span>
        ),
      }))}
      selectedIds={selected}
      onSelect={toggle}
      align="start"
      portal
      className={css.menuAnchor}
      anchor={(
        <button
          type="button"
          className={css.seat}
          aria-haspopup="menu"
          aria-expanded={open}
          title={t('chip.hint')}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconChecklistOutlineRegular className={css.seatIcon} />
          <span className={css.seatLabel}>{label}</span>
          <IconChevronDownOutlineRegular className={css.chevron} />
        </button>
      )}
    />
  )
}
