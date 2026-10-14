/** Host configuration for the mounted Right-Sidebar surface; the Sidebar itself lives in the browser export. */
// Host configuration injection stays with each plugin's validated Config and browser global.
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'

export { Config } from './config.ts'

/**
 * Embed the validated surface switch in browser pages.
 * @param ctx - Host context serving browser pages.
 * @param config - surface settings adopted when the page loads.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_SIDEBAR_RIGHT_CONFIG__', value: config })
  })
}
/* jscpd:ignore-end */
