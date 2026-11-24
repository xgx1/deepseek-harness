/**
 * One TOML patch layer's rows edited in place: only the edited row's `config`
 * tables change, so hand-written comments, key order, and the layer's other rows
 * survive a settings save.
 * @module @deepseek-ai/dsh-config-editor/toml-edit
 */

import { parseEntryToml, stringifyEntryToml, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/** A table header line, `[path]` or `[[path]]`, with an optional trailing comment. */
const HEADER = /^\s*(\[+)([^[\]]+?)(\]+)\s*(?:#.*)?$/

/** The array-of-tables header that starts one patch row. */
const ROW = /^\s*\[\[([^[\].\s]+)\]\]\s*(?:#.*)?$/

/** A row's own `config` key, written as `config = …` or as dotted `config.x`. */
const CONFIG_KEY = /^\s*"?config"?\s*[=.]/

/** A row-body line that carries nothing but the row's identity. */
const IDENTITY_KEY = /^\s*(?:id|name)\s*=/

/** One patch row's lines, `end` inclusive. */
interface RowBlock {
  readonly start: number
  readonly end: number
}

/**
 * Rewrite one row's configuration in a TOML patch layer.
 *
 * Omitting `next` resets the row: every row carrying the id loses its override,
 * and a row that existed only for the override is deleted along with the comment
 * block above it. Otherwise the last such row receives the new `config` tables, or
 * a fresh row is appended when the layer has none.
 * @param text - the layer's current source.
 * @param row - the Loader entry whose configuration changes.
 * @param next - the row's next configuration, or `undefined` to drop the override.
 * @returns the rewritten source; every line outside the changed row is unchanged.
 * @throws {Error} when the layer's rows and its `[[entry]]` tables disagree.
 */
export function editPatchRow(
  text: string,
  row: { id: string; name?: string | undefined },
  next: Record<string, unknown> | undefined,
): string {
  // The file's final newline is not a blank line the row's tables can leave behind.
  const terminated = text.endsWith('\n')
  const lines = (terminated ? text.slice(0, -1) : text).split('\n')
  const blocks: RowBlock[] = []
  let root: string | undefined
  for (const [at, line] of lines.entries()) {
    const header = ROW.exec(line)
    if (header === null) continue
    root ??= header[1]
    if (header[1] !== root) throw new Error(`patch layer mixes [[${header[1]}]] and [[${root}]] rows`)
    const previous = blocks.at(-1)
    if (previous !== undefined) blocks[blocks.length - 1] = { start: previous.start, end: at - 1 }
    blocks.push({ start: at, end: lines.length - 1 })
  }
  // Row order is the table order: a row's tables must precede the next row's header.
  const rows = (text.trim() === '' ? [] : parseEntryToml(text)) as PatchOptions[]
  if (rows.length !== blocks.length) {
    throw new Error(`patch layer has ${rows.length} rows but ${blocks.length} [[${root ?? 'entry'}]] tables to edit`)
  }
  const matches = rows.flatMap((candidate, index) => candidate.id === row.id && candidate.insert === undefined
    && (candidate.name === undefined || candidate.name === row.name) ? [index] : [])
  // A reset clears every row carrying the id; a value edit lands on the last one,
  // which is the row the composed patch list reads.
  const targets = new Set(next === undefined ? matches : matches.slice(-1))
  const out: string[] = []
  let cursor = 0
  blocks.forEach((block, index) => {
    out.push(...lines.slice(cursor, block.start))
    cursor = block.end + 1
    const blockLines = lines.slice(block.start, block.end + 1)
    if (!targets.has(index)) {
      out.push(...blockLines)
      return
    }
    const tail = tailStart(blockLines)
    const { kept, identityOnly, bodyEnd } = stripConfig(blockLines, root ?? '', tail)
    if (next === undefined && identityOnly) {
      // The comment block above the row documents nothing once the row is gone.
      while (out.at(-1)?.trim().startsWith('#') === true) out.pop()
      const rest = blockLines.slice(tail)
      if (out.at(-1)?.trim() === '') rest.shift()
      out.push(...rest)
      return
    }
    if (next === undefined || index !== matches.at(-1)) {
      out.push(...kept)
      return
    }
    const head = kept.slice(0, bodyEnd)
    while (head.length > 1 && head.at(-1)?.trim() === '') head.pop()
    out.push(...head, '', ...renderConfig(root ?? 'entry', next), ...kept.slice(bodyEnd))
  })
  out.push(...lines.slice(cursor))
  if (next !== undefined && targets.size === 0) {
    if (out.every(line => line.trim() === '')) out.length = 0
    else if (out.at(-1)?.trim() !== '') out.push('')
    out.push(...renderRow(root ?? 'entry', { id: row.id, ...(row.name === undefined ? {} : { name: row.name }), config: next }))
  }
  const rewritten = out.join('\n')
  return rewritten === '' || rewritten.endsWith('\n') ? rewritten : `${rewritten}\n`
}

/**
 * Find the trailing run of blank and comment lines, which document what follows
 * the row rather than the row itself.
 * @param block - the row's lines, header first.
 * @returns the index where that run starts.
 */
function tailStart(block: string[]): number {
  let tail = block.length
  while (tail > 1) {
    const line = (block.at(tail - 1) ?? '').trim()
    if (line !== '' && !line.startsWith('#')) break
    tail--
  }
  return tail
}

/**
 * Drop a row's `config` tables and its own `config` key, keeping the rest of its tables.
 * @param block - the row's lines, header first.
 * @param root - the layer's array-of-tables key.
 * @param tail - index where the lines documenting what follows start.
 * @returns the remaining lines, whether only the row's identity survives, and where its own table ends.
 * @throws {Error} when the row's `config` is a multi-line inline table this rewrite cannot follow.
 */
function stripConfig(block: string[], root: string, tail: number): { kept: string[]; identityOnly: boolean; bodyEnd: number } {
  const kept: string[] = [block[0] ?? '']
  let bodyEnd = 1
  let skipping = false
  let body = true
  for (let at = 1; at < block.length; at++) {
    const line = block[at] ?? ''
    const header = HEADER.exec(line)
    if (header !== null) {
      const [first, second] = header[2]?.split('.') ?? []
      skipping = first === root && second === 'config'
      body = false
    }
    if (skipping && at < tail) continue
    if (body && CONFIG_KEY.test(line)) {
      // shortcut: a `config` written as a multi-line inline table is refused, not rewritten.
      if (line.includes('{') !== line.includes('}')) throw new Error('an inline config table spanning lines cannot be edited in place')
      continue
    }
    kept.push(line)
    if (body) bodyEnd = kept.length
  }
  const identityOnly = kept.every((line, at) => at === 0 || line.trim() === '' || line.trim().startsWith('#') || IDENTITY_KEY.test(line))
  return { kept, identityOnly, bodyEnd }
}

/**
 * Render one `[[entry]]` row as this layer's TOML.
 * @param root - the layer's array-of-tables key.
 * @param body - fields of the row to write.
 * @returns the row's lines, without a trailing blank line.
 */
function renderRow(root: string, body: Record<string, unknown>): string[] {
  return stringifyEntryToml([body])
    .split('\n')
    .slice(0, -1)
    .map(line => line.replace(/^(\[+)entry\b/, `$1${root}`))
}

/**
 * Render a row's `config` tables under this layer's root key.
 * @param root - the layer's array-of-tables key.
 * @param config - the configuration to write.
 * @returns the table lines, without the row header.
 */
function renderConfig(root: string, config: Record<string, unknown>): string[] {
  return renderRow(root, { config }).slice(1)
}
