/**
 * One allow/deny rule list: an editable row per glob pattern, plus the add and
 * remove controls. The list is a draft the caller owns; this component reports
 * every edit back and keeps no copy of its own.
 */
import { Button, IconCloseOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './skill-filter.module.css'

/** Props one rule list receives. */
export interface RuleListProps {
  /** Namespace-bound translate. */
  t: PropsLocale<'skillFilter'>['t']
  /** The list's heading. */
  heading: string
  /** The list's explanatory line. */
  hint: string
  /** The current pattern rows. */
  patterns: readonly string[]
  /** Replace the whole list after one row edit. */
  onChange: (patterns: readonly string[]) => void
}

/**
 * Render one editable pattern list.
 * @param props - the list's copy, rows, and edit callback.
 * @returns the list element tree.
 */
export function RuleList({ t, heading, hint, patterns, onChange }: RuleListProps) {
  return (
    <div className={css.ruleList}>
      <h4 className={css.ruleHeading}>{heading}</h4>
      <p className={css.note}>{hint}</p>
      <ul className={css.patterns}>
        {patterns.map((pattern, index) => (
          <li key={`${index}:${pattern}`} className={css.patternRow}>
            <input
              className={css.patternInput}
              value={pattern}
              onChange={(event) => {
                const next = [...patterns]
                next[index] = event.target.value
                onChange(next)
              }}
            />
            <Button
              size="sm"
              icon={<IconCloseOutline16 size={14} />}
              aria-label={t('action.clear')}
              onClick={() => { onChange(patterns.filter((_value, position) => position !== index)) }}
            />
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        icon={<IconPlusOutline16 size={14} />}
        onClick={() => { onChange([...patterns, '']) }}
      >
        {t('action.addPattern')}
      </Button>
    </div>
  )
}
