/**
 * Project agent-config plugin, browser half: one chip in the new-session row and
 * a read-only catalog overview on the General settings page, both over the
 * Host's \`agentConfigs\` Remote namespace. The selection is project-level, so
 * the chip reads and writes it through the working directory it receives and
 * keeps no session state.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the agentConfigs namespace merge (the assembly re-exports
// every other namespace's generated declaration; this one only through its own package).
import type {} from '@deepseek-ai/dsh-agent-config/remote'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the General page's SlotMap merge ('settings.general.item').
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { AgentConfigChip } from './AgentConfigChip.tsx'
import type { AgentConfigChipInjected } from './AgentConfigChip.tsx'
import { AgentConfigOverview } from './AgentConfigOverview.tsx'
import type { AgentConfigOverviewInjected } from './AgentConfigOverview.tsx'
import { en, zh, type AgentConfigKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project agent-configuration copy. */
    'agentConfig': AgentConfigKey
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.agentConfigs']

/**
 * Render one Remote call as its value, hiding every failure from the surface.
 * @param call - the pending Remote call.
 * @returns the value, or undefined when the Host refused or the call failed.
 */
async function valueOf<T>(call: Promise<RemoteResult<T>>): Promise<T | undefined> {
  // A refusal and a transport failure both leave the surface with nothing to govern.
  const result = await call.catch(() => undefined)
  return result !== undefined && result.ok ? result.value : undefined
}

/**
 * Mount the project agent-config chip and the catalog overview.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('agentConfig', { zh, en }), 'ui-agent-config: dictionaries')

  ctx.slots.inject('conversation.hero.agentConfig', () => ctx.slots.register({
    name: 'conversation.hero.agentConfig',
    locale: 'agentConfig',
    inject: (): AgentConfigChipInjected => ({
      read: async cwd => await valueOf(ctx.remote.agentConfigs.getSelection({ cwd })),
      save: async (cwd, selected) => await valueOf(ctx.remote.agentConfigs.setSelection({ cwd, selected })),
    }),
  }, AgentConfigChip))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'agent-configs',
    order: 20,
    locale: 'agentConfig',
    inject: (): AgentConfigOverviewInjected => ({
      read: async () => await valueOf(ctx.remote.agentConfigs.overview()),
    }),
  }, AgentConfigOverview))
}
