/**
 * REAL composition: the plugin runs against the real `SkillRegistry` and the
 * real filesystem provider over a temporary skill root, so the assertions cover
 * what a preset's agent actually reads — catalog visibility, `/name` loading of
 * a skill no allow rule covers, and the invalidation a persisted config write
 * triggers.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'

let home: string
const fibers: Array<{ dispose: () => Promise<void> }> = []

/** Build an isolated home so the personal config is absent unless a test writes one. */
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'skill-filter-home-'))
  mkdirSync(join(home, '.dsh'), { recursive: true })
  vi.stubEnv('HOME', home)
  vi.stubEnv('DSH_HOME', join(home, '.dsh'))
})

afterEach(async () => {
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose()
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

/** One skill root with three skills, one of which hides itself from the model. */
function skillRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-filter-root-'))
  for (const [name, frontmatter] of [
    ['git-commit', 'name: git-commit\ndescription: Commit a change.'],
    ['git-rebase', 'name: git-rebase\ndescription: Rebase a branch.'],
    ['ue-build', 'name: ue-build\ndescription: Build the project.\ndisable-model-invocation: true'],
  ] as const) {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(
      join(dir, name, 'SKILL.md'),
      `---\n${frontmatter}\n---\nBody of ${name}.\n`,
    )
  }
  return dir
}

/** Ship a skill inside the working directory's own .dsh/skills root. */
function projectSkill(dir: string, name: string): void {
  const skillDir = join(dir, '.dsh', 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Shipped by the project.\n---\nBody of ${name}.\n`,
    'utf-8')
}

/** Write the personal config the plugin reads on every collection. */
function personalConfig(body: string): void {
  writeFileSync(join(home, '.dsh', 'skill-filter.yaml'), body, 'utf-8')
}

/** Write the project config for one skill root's working directory. */
function projectConfig(dir: string, body: string): void {
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(join(dir, '.dsh', 'skill-filter.yaml'), body, 'utf-8')
}

/** Boot the real registry with the plugin mounted, as a preset mounts it. */
async function boot(skillsDir: string): Promise<Context> {
  vi.resetModules()
  const SkillRegistry = (await import('@deepseek-ai/dsh-skill')).default
  const skillFilter = await import('../src/index.js')
  const ctx = new Context()
  fibers.push(await ctx.plugin(SkillRegistry))
  fibers.push(await ctx.plugin(skillFilter, { customSkillDirs: [skillsDir], watch: false }))
  return ctx
}

/** The fixture skills' visibility, as the catalog reports them. */
async function visibility(ctx: Context, cwd?: string): Promise<Map<string, boolean>> {
  const listed = await ctx.skills.list(cwd === undefined ? {} : { cwd })
  return new Map(listed.map(skill => [skill.name, skill.invocation.modelInvocable]))
}

describe('the skill filter in a real composition', () => {
  it('hides a skill no allow rule covers from both surfaces and refuses its /name load', async () => {
    const dir = skillRoot()
    try {
      personalConfig('allow:\n  - "git-*"\n')
      const ctx = await boot(dir)
      // The default roots contribute the host's own skills; the fixture's three
      // are what this composition asserts on.
      const state = await visibility(ctx)
      expect(state.get('git-commit')).toBe(true)
      expect(state.get('git-rebase')).toBe(true)
      expect(state.get('ue-build')).toBe(false)

      // The load still resolves — the registry keeps the entry — but the verdict
      // clears both invocation flags, which is what the `/name` gesture and the
      // instructions-injection boundary read before either acts.
      const definition = await ctx.skills.get('ue-build', {})
      expect(definition?.name).toBe('ue-build')
      expect(definition?.content).toContain('Body of ue-build')
      expect(definition?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
      expect(isUserInvocable(definition!)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads a specific name and a glob in the same config as one allow list', async () => {
    const dir = skillRoot()
    try {
      personalConfig('allow:\n  - "git-commit"\n  - "ue-*"\n')
      const ctx = await boot(dir)
      const byName = await visibility(ctx)
      expect(byName.get('git-commit')).toBe(true)
      expect(byName.get('git-rebase')).toBe(false)
      expect(byName.get('ue-build')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('filters on the project config alone when no personal config exists', async () => {
    const dir = skillRoot()
    try {
      projectConfig(dir, 'allow:\n  - "git-commit"\n')
      const ctx = await boot(dir)
      const state = await visibility(ctx, dir)
      expect(state.get('git-commit')).toBe(true)
      expect(state.get('git-rebase')).toBe(false)
      expect(state.get('ue-build')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('unions the personal and project layers', async () => {
    const dir = skillRoot()
    try {
      personalConfig('allow:\n  - "git-*"\n')
      projectConfig(dir, 'allow:\n  - "ue-build"\n')
      const ctx = await boot(dir)
      const state = await visibility(ctx, dir)
      expect(state.get('git-commit')).toBe(true)
      expect(state.get('git-rebase')).toBe(true)
      // The project allow also overrides the skill's own frontmatter deny.
      expect(state.get('ue-build')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves a skill the project ships under .dsh/skills to the project', async () => {
    const dir = skillRoot()
    try {
      projectSkill(dir, 'proj-only')
      // A personal allow list that matches nothing: every user-level skill is
      // denied, and the project's own skill still has to come through.
      personalConfig('allow:\n  - "git-*"\n')
      const ctx = await boot(dir)
      const state = await visibility(ctx, dir)
      expect(state.get('proj-only')).toBe(true)
      expect(state.get('git-commit')).toBe(true)
      expect(state.get('ue-build')).toBe(false)

      // The load keeps the skill's own frontmatter policy — the verdict that
      // denies the user-level skills never reaches it.
      const definition = await ctx.skills.get('proj-only', { cwd: dir })
      expect(definition?.content).toContain('Body of proj-only')
      expect(definition?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies a persisted config write to the next catalog read', async () => {
    const dir = skillRoot()
    try {
      // The owner is host-plane and the plugin is preset-plane, so the plugin
      // reads it through the shared service store at apply time.
      const listeners = new Set<() => void>()
      const owner = {
        onConfigUpdated: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
      vi.resetModules()
      const SkillRegistry = (await import('@deepseek-ai/dsh-skill')).default
      const skillFilter = await import('../src/index.js')
      const ctx = new Context()
      ctx.provide('skillFilter', owner as never)
      fibers.push(await ctx.plugin(SkillRegistry))
      fibers.push(await ctx.plugin(skillFilter, { customSkillDirs: [dir], watch: false }))

      // No personal config yet: the fixture skills keep their own visibility,
      // so the frontmatter-hidden one is the only fixture skill the model loses.
      const before = await visibility(ctx)
      expect(before.get('git-commit')).toBe(true)
      expect(before.get('git-rebase')).toBe(true)
      expect(before.get('ue-build')).toBe(false)

      // The registry caches completed collections, so the write must publish.
      personalConfig('allow:\n  - "git-commit"\n')
      for (const listener of [...listeners]) listener()

      // The denied skills stay registered — the flag is what moved.
      const after = await visibility(ctx)
      expect(after.get('git-commit')).toBe(true)
      expect(after.get('git-rebase')).toBe(false)
      expect(after.get('ue-build')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
