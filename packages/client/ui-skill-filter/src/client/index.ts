/**
 * Skill filtering surfaces, browser half: the Settings page that owns the
 * personal rule lists and the right-Sidebar tab that shows the merged rules and
 * the project override.
 *
 * Both surfaces read and write through one Host face bound to the `skillFilter`
 * Remote namespace, and both list the Session's skills through the `skills`
 * namespace the Session controller already owns. Copy comes from this package's
 * own dictionaries; no surface hardcodes product text.
 */

// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Sidebar's SlotMap merge (the tab seats) and its Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: the Session catalog's types and the ctx.remote Context merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the renderer's SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the Session standard props merge (useSessions / sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { Context } from '@deepseek-ai/cordis'
import { createSkillFilterFace } from './face.ts'
import { SKILL_FILTER_ID, skillFilterDefinition } from './definition.tsx'
import { SkillFilterSettingsSection } from './SettingsSection.tsx'
import { SkillFilterBody } from './SkillFilterBody.tsx'
import { SkillFilterTitle } from './SkillFilterTitle.tsx'
import { en, zh, type SkillFilterKey } from './locales.ts'

export type { SkillFilterFace, SkillFilterSkillEntry } from './face.ts'
export type { SkillFilterBodyProps } from './SkillFilterBody.tsx'
export type { SkillFilterSettingsSectionProps } from './SettingsSection.tsx'
export type { SkillFilterTitleProps } from './SkillFilterTitle.tsx'
export type { SkillCatalogProps } from './SkillCatalog.tsx'
export type { RuleListProps } from './RuleList.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The skill-filter settings page and Sidebar tab copy. */
    skillFilter: SkillFilterKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'skillFilter'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.skillFilter', 'remote.skills']

/**
 * Mount the settings section, the Sidebar tab type, and both keyed seats.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill-filter: dictionaries')

  const face = createSkillFilterFace(ctx.remote)

  ctx.effect(() => ctx.sidebarRightTabs.register(skillFilterDefinition(t)), 'ui-skill-filter: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: SKILL_FILTER_ID,
    locale: NS,
    inject: () => face,
  }, SkillFilterBody)), 'ui-skill-filter: tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: SKILL_FILTER_ID,
    locale: NS,
    inject: () => face,
  }, SkillFilterTitle)), 'ui-skill-filter: tab title')

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skill-filter',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: () => face,
  }, SkillFilterSettingsSection)), 'ui-skill-filter: settings section')
}
