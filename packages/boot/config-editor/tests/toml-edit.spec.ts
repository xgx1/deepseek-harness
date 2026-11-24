/** A TOML patch layer edited in place: one row's config changes, every other line stays. */
import { expect, it } from 'vitest'
import { parseEntryToml } from '@deepseek-ai/cordis-plugin-include'
import { editPatchRow } from '../src/toml-edit.ts'

interface Row {
  id?: string
  name?: string
  config?: unknown
  insert?: unknown
}

const layer = [
  '# MCP servers (migrated from OMP mcp.json).',
  '[[entry]]',
  '[[entry.insert]]',
  'id = "mcp-cbm"',
  'name = "@deepseek-ai/dsh-mcp-client"',
  '',
  '[entry.insert.config]',
  'serverName = "cbm"',
  '',
  '# Routing follows the model provider, not a local default.',
  '[[entry]]',
  'id = "web"',
  'name = "@deepseek-ai/dsh-web"',
  '',
  '[entry.config]',
  'searchProvider = "deepseek-official"',
  '',
  '[entry.config.reconnect]',
  'maxAttempts = 3',
  '',
  '[[entry]]',
  'id = "goal"',
  '',
].join('\n')

it('replaces one row config and keeps comments, sibling rows, and inserted entries', () => {
  const saved = editPatchRow(layer, { id: 'web', name: '@deepseek-ai/dsh-web' }, { searchProvider: 'http', fetchProvider: 'http' })
  expect(saved).toContain('# MCP servers (migrated from OMP mcp.json).')
  expect(saved).toContain('# Routing follows the model provider, not a local default.')
  expect(saved).toContain('serverName = "cbm"')
  expect(saved).not.toContain('[entry.config.reconnect]')
  const rows = parseEntryToml(saved) as Row[]
  expect(rows.find(row => row.id === 'web')?.config).toEqual({ searchProvider: 'http', fetchProvider: 'http' })
  expect(JSON.stringify(rows)).toContain('serverName')
  expect(JSON.stringify(rows)).not.toContain('maxAttempts')
})

it('drops an override-only row along with the comment block above it', () => {
  const saved = editPatchRow(layer, { id: 'web', name: '@deepseek-ai/dsh-web' }, undefined)
  expect(saved).not.toContain('id = "web"')
  expect(saved).not.toContain('Routing follows the model provider')
  expect(saved).toContain('id = "goal"')
})

it('keeps a row that carries more than the override', () => {
  const saved = editPatchRow('[[entry]]\nid = "web"\ndisabled = true\n\n[entry.config]\nsearchProvider = "http"\n', { id: 'web' }, undefined)
  expect(saved).toBe('[[entry]]\nid = "web"\ndisabled = true\n')
})

it('edits the last row carrying the id, which is the one the patch list reads', () => {
  const text = '[[entry]]\nid = "web"\n\n[entry.config]\nkeep = 1\n\n[[entry]]\nid = "web"\n\n[entry.config]\nstale = 2\n'
  const saved = editPatchRow(text, { id: 'web' }, { fresh: 3 })
  expect((parseEntryToml(saved) as Row[]).map(row => row.config)).toEqual([{ keep: 1 }, { fresh: 3 }])
})

it('appends the row when the layer has none, and writes the first row of an empty layer', () => {
  expect(editPatchRow('[[entry]]\nid = "goal"\n', { id: 'model', name: 'cordis:model' }, { model: 'changed' }))
    .toBe('[[entry]]\nid = "goal"\n\n[[entry]]\nid = "model"\nname = "cordis:model"\n\n[entry.config]\nmodel = "changed"\n')
  expect(editPatchRow('', { id: 'first' }, { count: 1 }))
    .toBe('[[entry]]\nid = "first"\n\n[entry.config]\ncount = 1\n')
})

it('refuses a layer it cannot map back to rows', () => {
  expect(() => editPatchRow('entry = [{ id = "first" }]', { id: 'first' }, { count: 1 })).toThrow('rows but 0 [[entry]] tables')
  expect(() => editPatchRow('[[entry]]\nid = "first"\n[[patch]]\nid = "second"\n', { id: 'first' }, { count: 1 })).toThrow('mixes')
  expect(() => editPatchRow('[[entry]]\nid = "first"\nconfig = {\n  count = 1,\n}\n', { id: 'first' }, { count: 2 }))
    .toThrow('cannot be edited in place')
})
