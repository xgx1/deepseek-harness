/**
 * Unit tests for the agent-configs document: validation, resolution, and the
 * read/write round trip the configuration surfaces depend on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EMPTY_DOCUMENT, mcpServersOf, parseAgentConfigs, readAgentConfigs, selectionOf, skillGlobsOf, writeAgentConfigs,
} from '../src/config.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-configs-'))
  file = join(dir, 'agent-configs.yaml')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('parseAgentConfigs', () => {
  it('reads configurations and each project selection', () => {
    const document = parseAgentConfigs(`
configs:
  general:
    skills: ["*"]
    mcp: ["cbm"]
  unreal:
    skills: ["unreal-*", "ue*"]
projects:
  /work/game: [general, unreal]
  /work/blank: []
`, file)
    expect(document.configs.general).toEqual({ skills: ['*'], mcp: ['cbm'] })
    expect(document.configs.unreal?.skills).toEqual(['unreal-*', 'ue*'])
    expect(document.projects['/work/game']).toEqual(['general', 'unreal'])
    expect(document.projects['/work/blank']).toEqual([])
  })

  it('treats an absent field as an empty list', () => {
    const document = parseAgentConfigs('configs:\n  bare: {}\n', file)
    expect(document.configs.bare).toEqual({ skills: [], mcp: [] })
  })

  it('treats an empty file as no document', () => {
    expect(parseAgentConfigs('', file)).toEqual(EMPTY_DOCUMENT)
  })

  it('rejects an unknown top-level key rather than silently ignoring it', () => {
    expect(() => parseAgentConfigs('configz: {}\n', file)).toThrow(/unknown key/)
  })

  it('rejects a project selection that is not a string array', () => {
    expect(() => parseAgentConfigs('projects:\n  /work: general\n', file)).toThrow(/projects.\/work/)
  })

  it('rejects a non-string glob entry', () => {
    expect(() => parseAgentConfigs('configs:\n  a:\n    skills: [1]\n', file)).toThrow(/configs.a.skills/)
  })
})

describe('resolution', () => {
  const document = parseAgentConfigs(`
configs:
  general:
    skills: ["common-*"]
    mcp: [cbm]
  unreal:
    skills: ["unreal-*"]
    mcp: [unity]
projects:
  /work/game: [general, unreal]
  /work/blank: []
`, file)

  it('unions the globs and servers of the selected configurations', () => {
    expect(skillGlobsOf(document, '/work/game')).toEqual(['common-*', 'unreal-*'])
    expect([...mcpServersOf(document, '/work/game') ?? []]).toEqual(['cbm', 'unity'])
  })

  it('governs a project that selects nothing with empty rules', () => {
    expect(skillGlobsOf(document, '/work/blank')).toEqual([])
    expect(mcpServersOf(document, '/work/blank')?.size).toBe(0)
  })

  it('leaves an unlisted project ungoverned', () => {
    expect(selectionOf(document, '/work/other')).toBeUndefined()
    expect(skillGlobsOf(document, '/work/other')).toBeUndefined()
    expect(mcpServersOf(document, '/work/other')).toBeUndefined()
    expect(skillGlobsOf(document, undefined)).toBeUndefined()
  })

  it('ignores a selection naming a configuration that does not exist', () => {
    const stale = parseAgentConfigs('configs: {}\nprojects:\n  /work/game: [gone]\n', file)
    expect(skillGlobsOf(stale, '/work/game')).toEqual([])
  })
})

describe('file round trip', () => {
  it('reads an absent file as the empty document', async () => {
    expect(await readAgentConfigs(file)).toEqual(EMPTY_DOCUMENT)
  })

  it('writes and reads back the same document', async () => {
    const document = parseAgentConfigs('configs:\n  general:\n    skills: ["*"]\n    mcp: [cbm]\nprojects:\n  /work: [general]\n', file)
    await writeAgentConfigs(document, file)
    expect(await readAgentConfigs(file)).toEqual(document)
    expect(await readFile(file, 'utf-8')).toContain('general')
  })

  it('reports the path of a file that does not parse', async () => {
    await writeFile(file, 'configs: [1]\n', 'utf-8')
    await expect(readAgentConfigs(file)).rejects.toThrow(/configs/)
  })
})
