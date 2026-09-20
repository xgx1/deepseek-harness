/** The skill-filter tab's chip title. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './skill-filter.module.css'

/** Props the title receives: the keyed runtime share and copy. */
export type SkillFilterTitleProps =
  PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<'skillFilter'>

/**
 * Render the tab chip's title.
 * @param props - composed slot props.
 * @returns the title element.
 */
export function SkillFilterTitle({ t }: SkillFilterTitleProps) {
  return <span className={css.title}>{t('type.label')}</span>
}
