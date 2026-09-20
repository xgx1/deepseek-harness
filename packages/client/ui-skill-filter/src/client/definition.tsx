/** Static skill-filter tab type and guide declaration. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locales.ts'

/** Skill-filter implementation identity and keyed Slot dispatch key. */
export const SKILL_FILTER_ID = '@deepseek-ai/dsh-client-ui-skill-filter'

/** Skill-filter tab kind. */
export const SKILL_FILTER_KIND = 'skill-filter'

/**
 * Build the skill-filter type with locale-live copy.
 * @param t - namespace-bound translate.
 * @returns the tab definition the right Sidebar registers.
 */
export function skillFilterDefinition(t: TranslateNS<'skillFilter'>): SidebarRightTabDefinition {
  return {
    id: SKILL_FILTER_ID,
    kind: SKILL_FILTER_KIND,
    multiple: false,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'new',
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconAgentPresetOutline16,
    }],
  }
}
