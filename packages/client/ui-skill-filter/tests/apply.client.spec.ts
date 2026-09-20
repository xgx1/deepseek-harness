// @vitest-environment jsdom
/**
 * The plugin's wiring through the real registries: the tab type, both keyed
 * Sidebar seats, the Settings section, and the dictionaries — and their removal
 * when the fiber is disposed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../src/client/index.ts'
import { SKILL_FILTER_ID, SKILL_FILTER_KIND } from '../src/client/definition.tsx'
import { SkillFilterBody } from '../src/client/SkillFilterBody.tsx'
import { SkillFilterSettingsSection } from '../src/client/SettingsSection.tsx'
import { SkillFilterTitle } from '../src/client/SkillFilterTitle.tsx'
import { en, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

interface Recorded {
  name: string
  key?: string
  id?: string
  locale?: string
  inject?: unknown
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const dictionaries = new Map<string, unknown>()
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const locale = {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((namespace: string, value: unknown) => {
      dictionaries.set(namespace, value)
      return () => { dictionaries.delete(namespace) }
    }),
  }
  const remote = { skillFilter: {}, skills: {} }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', remote as never)
  ctx.provide('remote.skillFilter', remote.skillFilter as never)
  ctx.provide('remote.skills', remote.skills as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber }
}

afterEach(() => undefined)

describe('ui-skill-filter apply', () => {
  it('keeps the Host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the tab type, both keyed seats, and the settings section', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(SKILL_FILTER_KIND)
    expect(definition).toMatchObject({ id: SKILL_FILTER_ID, kind: SKILL_FILTER_KIND, multiple: false })
    expect(definition?.title('skill-filter://x')).toBe('type.label')
    expect(dictionaries.get('skillFilter')).toEqual({ zh, en })
    expect(registered.map(entry => [entry.name, entry.key, entry.id, entry.component])).toEqual([
      ['sidebar.right.pane.tab', SKILL_FILTER_ID, undefined, SkillFilterBody],
      ['sidebar.right.pane.tab.title', SKILL_FILTER_ID, undefined, SkillFilterTitle],
      ['settings.section', undefined, 'skill-filter', SkillFilterSettingsSection],
    ])
    for (const entry of registered) {
      expect(entry.locale).toBe('skillFilter')
      expect(entry.inject).toBeTypeOf('function')
    }
  })

  it('removes every registration when the plugin is disposed', async () => {
    const { tabs, registered, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(SKILL_FILTER_KIND)).toBeUndefined()
    expect(registered).toEqual([])
  })
})
