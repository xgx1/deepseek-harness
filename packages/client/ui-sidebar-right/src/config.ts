/** Deployment switch shared by the Host page injection and the browser panel. */
import z from '@deepseek-ai/schemastery'

/** Right-Sidebar deployment settings. */
export interface Config {
  /**
   * Mount the panel and its header expand button. `false` leaves the
   * `sidebarRight` service and the `sidebarRightTabs` registry intact for every
   * consumer and draws no part of the surface.
   */
  panel: boolean
}

/** Validated deployment settings for the mounted Right-Sidebar surface. */
export const Config: z<Partial<Config>, Config> = z.object({
  panel: z.boolean().default(true),
})
