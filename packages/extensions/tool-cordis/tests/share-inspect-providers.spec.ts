/**
 * The inspect-provider sharing guard: a second preset carrying this package
 * mounts beside an already-mounted one by sharing the identical process-global
 * providers instead of colliding on the duplicate id, while a genuinely
 * different registration still fails loud.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { HostCordisInspectProviderRegistration } from '@deepseek-ai/dsh-cordis-host-runner'
import { CordisInspectRegistryService } from '@deepseek-ai/dsh-cordis-host-runner'
import { hostInspectProviders, shareInspectProvider } from '../src/providers.ts'

/** A live host whose only capability is the inspect registry. */
async function host(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(CordisInspectRegistryService)
  return ctx
}

const hostProviderIds = (ctx: Context): string[] =>
  ctx.cordisInspect.list()
    .filter(view => view.platform === 'host')
    .map(view => view.id)
    .sort()

describe('sharing Host inspect providers across preset mounts', () => {
  it('registers the four first-party providers exactly once on a fresh host', async () => {
    const ctx = await host()

    const disposers = hostInspectProviders(ctx).map(provider => shareInspectProvider(ctx, provider))
    try {
      expect(hostProviderIds(ctx)).toEqual(['Builtin', 'Event', 'Service', 'Tool'])
    } finally {
      disposers.forEach(dispose => dispose())
    }
  })

  it('shares an identical second registration instead of failing', async () => {
    const ctx = await host()
    const first = hostInspectProviders(ctx).map(provider => shareInspectProvider(ctx, provider))
    try {
      // A second mount of this same package produces byte-identical manifests.
      const second = hostInspectProviders(ctx).map(provider => shareInspectProvider(ctx, provider))
      expect(hostProviderIds(ctx)).toEqual(['Builtin', 'Event', 'Service', 'Tool'])
      second.forEach(dispose => dispose())
      // Sharing never owns a disposer: releasing the second mount leaves the first intact.
      expect(hostProviderIds(ctx)).toEqual(['Builtin', 'Event', 'Service', 'Tool'])
    } finally {
      first.forEach(dispose => dispose())
    }
  })

  it('still fails loud on a conflicting registration under the same id', async () => {
    const ctx = await host()
    const disposer = shareInspectProvider(ctx, hostInspectProviders(ctx)[0]!)
    try {
      const conflicting: HostCordisInspectProviderRegistration = {
        ...hostInspectProviders(ctx)[0]!,
        manifest: {
          ...hostInspectProviders(ctx)[0]!.manifest,
          description: 'a different provider pretending to own the same id',
        },
      }
      expect(() => shareInspectProvider(ctx, conflicting)).toThrow(/already registered/)
    } finally {
      disposer()
    }
  })

  it('re-registers cleanly after the owning registration is released', async () => {
    const ctx = await host()
    const disposer = shareInspectProvider(ctx, hostInspectProviders(ctx)[0]!)
    disposer()
    expect(hostProviderIds(ctx)).toEqual([])

    const again = shareInspectProvider(ctx, hostInspectProviders(ctx)[0]!)
    expect(hostProviderIds(ctx)).toEqual([hostInspectProviders(ctx)[0]!.manifest.id])
    again()
  })
})
