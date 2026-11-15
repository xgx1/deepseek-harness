/**
 * Tests for the YAML-to-TOML composition converter.
 * @module scripts/convert-compositions-to-toml.spec
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseEntryToml, parseEntryYaml } from '@deepseek-ai/cordis-plugin-include'
import { afterEach, describe, expect, it } from 'vitest'
import { convertFile } from './convert-compositions-to-toml.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Write a source file into a scratch directory and return its path. */
function scratch(name: string, content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-toml-'))
  directories.push(directory)
  const file = join(directory, name)
  writeFileSync(file, content)
  return file
}

describe('convertFile', () => {
  it('converts a patch list without changing its meaning', () => {
    const file = scratch('cordis.patch.yml', [
      '# The header block documents the whole file.',
      '',
      '- insert:',
      '    # The plugin keeps its own state.',
      '    - id: alpha',
      "      name: '@deepseek-ai/dsh-alpha'",
      '      config:',
      '        # Read once at boot.',
      "        model: !!js 'process.env.DSH_MODEL'",
      '',
    ].join('\n'))
    const target = convertFile(file)
    const before = parseEntryYaml(readFileSync(file, 'utf8'))
    expect(isDeepStrictEqual(parseEntryToml(readFileSync(target, 'utf8')), before)).toBe(true)
    const converted = readFileSync(target, 'utf8')
    expect(converted.indexOf('# The plugin keeps its own state.')).toBeLessThan(converted.indexOf('id = "alpha"'))
    expect(converted.indexOf('# Read once at boot.')).toBeLessThan(converted.indexOf('model ='))
    expect(converted).toContain('model = "js:process.env.DSH_MODEL"')
  })
})
