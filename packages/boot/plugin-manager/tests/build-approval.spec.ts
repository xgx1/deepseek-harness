/** Pending script permissions survive cleanup and preserve unrelated manifest fields. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { approveBuilds, recordPendingBuilds } from '../src/build-approval.ts'

function fixture(text?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'build-approval-'))
  onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
  const filename = join(dir, 'package.json')
  if (text !== undefined) writeFileSync(filename, text)
  return { dir, filename }
}

/** A profile manifest as the manager writes it: 2-space JSON with a trailing newline. */
function manifest(fields: Record<string, unknown>): string {
  return JSON.stringify({ name: 'dsh-profile-test', private: true, dependencies: {}, ...fields }, undefined, 2) + '\n'
}

it('approves only reported pending packages and preserves the rest of the manifest', async () => {
  const original = manifest({
    dependencies: { addon: '1.0.0' },
    allowScripts: { trusted: true, denied: false },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  })
  const { dir, filename } = fixture(original)
  const output = 'ERR_NUB_IGNORED_BUILDS\n Ignored build scripts: native@1.0.0, trusted, denied, @scope/*\n'
  expect(await recordPendingBuilds(dir, output)).toEqual(['native@1.0.0'])
  await approveBuilds(dir, ['native@1.0.0'])
  const text = readFileSync(filename, 'utf8')
  expect(JSON.parse(text)).toEqual({
    name: 'dsh-profile-test',
    private: true,
    dependencies: { addon: '1.0.0' },
    allowScripts: { trusted: true, denied: false, 'native@1.0.0': true },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  })
  expect(Object.keys(JSON.parse(text) as Record<string, unknown>)).toEqual(['name', 'private', 'dependencies', 'allowScripts', 'dsh'])
  expect(text).toContain('\n  "dependencies": {\n    "addon": "1.0.0"\n  },')
  expect(text.endsWith('}\n')).toBe(true)
  expect(await recordPendingBuilds(dir, output)).toEqual([])
})

it.each([
  ['a denied package', { denied: false }, 'denied'],
  ['an approved package', { native: true }, 'native'],
])('refuses %s rather than overriding the decision', async (_label, allowScripts, name) => {
  const original = manifest({ allowScripts })
  const { dir, filename } = fixture(original)
  await expect(approveBuilds(dir, ['pending', name])).rejects.toThrow('stale-approval')
  expect(readFileSync(filename, 'utf8')).toBe(original)
})

it('preserves a file dependency selector as its own key', async () => {
  const name = '@scope/addon@file:../local addon'
  const { dir, filename } = fixture()
  expect(await recordPendingBuilds(dir, `ERR_NUB_IGNORED_BUILDS\n Ignored build scripts: ${name}\n`)).toEqual([name])
  await approveBuilds(dir, [name])
  expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({ allowScripts: { [name]: true } })
})

it.each([undefined, '{}\n', '{"name":"dsh-profile-test"}\n', '{"allowScripts":{}}\n'])('has no pending approval without a decision: %s', async (text) => {
  const { dir } = fixture(text)
  expect(await recordPendingBuilds(dir, '')).toEqual([])
  await approveBuilds(dir, [])
})

it.each(['[', '[]\n', 'null\n', '{"allowScripts":false}\n'])('rejects a malformed manifest without rewriting it: %s', async (text) => {
  const { dir, filename } = fixture(text)
  await expect(recordPendingBuilds(dir, '')).rejects.toThrow()
  await expect(approveBuilds(dir, ['native'])).rejects.toThrow()
  expect(readFileSync(filename, 'utf8')).toBe(text)
})

it('reports an unreadable manifest', async () => {
  const { dir, filename } = fixture()
  mkdirSync(filename)
  await expect(recordPendingBuilds(dir, '')).rejects.toThrow()
})

it('records the ignored build scripts a non-interactive run reported', async () => {
  const original = manifest({})
  const { dir, filename } = fixture(original)
  const output = [
    'Progress: resolved 2, reused 2, downloaded 0, added 2, done',
    'ERR_NUB_IGNORED_BUILDS',
    ' Ignored build scripts: native@1.0.0, @scope/other@file:../other, @scope/*',
  ].join('\n')

  expect(await recordPendingBuilds(dir, output)).toEqual(['native@1.0.0', '@scope/other@file:../other'])
  // The manifest records decisions only, so a failed run leaves the reported names to its own output.
  expect(readFileSync(filename, 'utf8')).toBe(original)
  expect(await recordPendingBuilds(dir, output)).toEqual(['native@1.0.0', '@scope/other@file:../other'])
  await approveBuilds(dir, ['native@1.0.0'])
  expect(JSON.parse(readFileSync(filename, 'utf8'))).toMatchObject({ allowScripts: { 'native@1.0.0': true } })
  expect(await recordPendingBuilds(dir, output)).toEqual(['@scope/other@file:../other'])
})

function gitPrepareRefusal(key: string, eol = '\n') {
  return [
    '[ERR_NUB_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package fetched from "https://example.com/sidechat.git": The git-hosted package "@scope/sidechat@0.2.0" needs to execute build scripts but nothing approved them.',
    '',
    'Add the package to "allowScripts" in your project\'s package.json to allow it to run scripts. For example:',
    `"allowScripts": { "${key}": true }`,
    '',
  ].join(eol)
}

function pnpmGitPrepareRefusal(key: string) {
  return [
    '[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package fetched from "https://example.com/sidechat.git"',
    '',
    'allowBuilds:',
    `  ${key}: true`,
    '',
  ].join('\n')
}

it.each([
  ['nub, LF', gitPrepareRefusal, '@scope/sidechat@git+https://example.com/sidechat.git#244b67419a80844f5fb1fd7971109b9c19a20b76'],
  ['nub, CRLF', (key: string) => gitPrepareRefusal(key, '\r\n'), '@scope/sidechat@git+https://example.com/sidechat.git#244b67419a80844f5fb1fd7971109b9c19a20b76'],
  ['nub, a subdirectory with a space', gitPrepareRefusal, '@scope/sidechat@git+file:///repo#244b67419a80844f5fb1fd7971109b9c19a20b76&path:plugin folder'],
  ['nub, an SSH user name', gitPrepareRefusal, '@scope/sidechat@git+ssh://git@example.com/sidechat.git#244b67419a80844f5fb1fd7971109b9c19a20b76'],
  ['pnpm workspace settings', pnpmGitPrepareRefusal, '@scope/sidechat@git+ssh://git@example.com/sidechat.git#244b67419a80844f5fb1fd7971109b9c19a20b76'],
])('records the key a run suggests for a git-hosted package it refused to prepare (%s)', async (_label, refusal, key) => {
  const { dir, filename } = fixture()
  expect(await recordPendingBuilds(dir, refusal(key))).toEqual([key])
  await approveBuilds(dir, [key])
  expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({ allowScripts: { [key]: true } })
})

it.each([
  '@scope/sidechat@git+https://user:token@example.com/sidechat.git#244b67419a80844f5fb1fd7971109b9c19a20b76',
  '@scope/sidechat@git+http://token@example.com/sidechat.git#244b67419a80844f5fb1fd7971109b9c19a20b76',
  '@scope/sidechat@git+ssh://git:secret@example.com/sidechat.git#244b67419a80844f5fb1fd7971109b9c19a20b76',
])('does not record a git key that carries a credential: %s', async (key) => {
  const { dir, filename } = fixture()
  expect(await recordPendingBuilds(dir, gitPrepareRefusal(key))).toEqual([])
  expect(await recordPendingBuilds(dir, `ERR_NUB_IGNORED_BUILDS\n Ignored build scripts: ${key}\n`)).toEqual([])
  expect(existsSync(filename)).toBe(false)
})

it.each([
  ['no report', 'Progress: resolved 1, reused 1, downloaded 0, added 1, done\n'],
  ['an empty report', 'ERR_NUB_IGNORED_BUILDS\n Ignored build scripts: \n'],
  ['only wildcards', 'ERR_NUB_IGNORED_BUILDS\n Ignored build scripts: @scope/*, native@?\n'],
])('leaves the manifest untouched for %s', async (_label, output) => {
  const original = manifest({ allowScripts: { decided: true } })
  const { dir, filename } = fixture(original)
  expect(await recordPendingBuilds(dir, output)).toEqual([])
  expect(readFileSync(filename, 'utf8')).toBe(original)
})

it('preserves decisions that are not package names', async () => {
  const { dir, filename } = fixture(manifest({ allowScripts: { '1': true } }))
  expect(await recordPendingBuilds(dir, 'ERR_NUB_IGNORED_BUILDS\n Ignored build scripts: native@1.0.0, 1\n'))
    .toEqual(['native@1.0.0'])
  await approveBuilds(dir, ['native@1.0.0'])
  expect(JSON.parse(readFileSync(filename, 'utf8'))).toMatchObject({
    allowScripts: { '1': true, 'native@1.0.0': true },
  })
})
