/**
 * Convert Cordis patch and entry files from the YAML dialect to the TOML one,
 * keeping every leading comment with the node it documents.
 *
 * ```sh
 * pnpm exec tsx scripts/convert-compositions-to-toml.ts <file.yml>...
 * ```
 *
 * A comment block above a node moves above that node's TOML table or key. The
 * output is written beside the input as `.toml`; the input file is left for the
 * caller to delete, so a conversion can be reviewed before it is committed.
 * @module scripts/convert-compositions-to-toml
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { stringify } from 'smol-toml'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

/** YAML tag this dialect turns into an expression node, matching `!!js`. */
const JS_TAG = 'tag:yaml.org,2002:js'

/** One node's source position, used to find the comment block above it. */
interface Anchor {
  /** Slash-joined path inside the emitted document, without the root key. */
  readonly path: string
  /** Zero-based source line of the node's key. */
  readonly line: number
}

/**
 * Convert a YAML node into plain data the TOML emitter accepts.
 * @param node - the YAML node to convert.
 * @param path - the node's path inside the document.
 * @param anchors - collector receiving every node's source line.
 * @param text - the whole source, for offset-to-line conversion.
 * @returns the plain value.
 */
function convert(node: unknown, path: readonly string[], anchors: Anchor[], text: string): unknown {
  if (node === null || node === undefined) return null
  if (isScalar(node)) {
    const value: unknown = node.value
    if (node.tag === JS_TAG) return `js:${String(value)}`
    return value === undefined ? null : value
  }
  if (isSeq(node)) {
    return node.items.map((item, index) => {
      const child = [...path, String(index)]
      const start = item !== null && typeof item === 'object' && 'range' in item ? (item.range as [number, number] | undefined)?.[0] : undefined
      if (start !== undefined) anchors.push({ path: child.join('/'), line: lineOf(text, start) })
      return convert(item, child, anchors, text)
    })
  }
  if (isMap(node)) {
    const out: Record<string, unknown> = {}
    for (const pair of node.items) {
      const key = String(isScalar(pair.key) ? pair.key.value : '')
      const child = [...path, key]
      const start = (pair.key as { range?: [number, number] } | null)?.range?.[0]
      if (start !== undefined) anchors.push({ path: child.join('/'), line: lineOf(text, start) })
      out[key] = convert(pair.value, child, anchors, text)
    }
    return out
  }
  return null
}

/** Zero-based line of a source offset. */
function lineOf(text: string, offset: number): number {
  let line = 0
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

/**
 * The comment block immediately above a line, skipping blank lines between the
 * block and the line it documents.
 * @param lines - source lines.
 * @param index - zero-based line index.
 * @returns the block, or `undefined` when there is none.
 */
function commentAbove(lines: readonly string[], index: number): string | undefined {
  const block: string[] = []
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      if (block.length === 0) continue
      break
    }
    if (!line.trimStart().startsWith('#')) break
    block.unshift(line.trimEnd())
  }
  return block.length === 0 ? undefined : block.join('\n')
}

/** The block of comment lines at the top of the file, or `undefined`. */
function headerComment(lines: readonly string[]): string | undefined {
  const block: string[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (block.length === 0) continue
      break
    }
    if (!line.trimStart().startsWith('#')) break
    block.push(line.trimEnd())
  }
  return block.length === 0 ? undefined : block.join('\n')
}

/**
 * Convert one composition file in place beside itself.
 * @param file - path to a YAML entry or patch file.
 * @returns the written path.
 */
export function convertFile(file: string): string {
  const text = readFileSync(file, 'utf8')
  const document = parseDocument(text)
  if (document.errors.length > 0) throw new Error(`${file}: ${document.errors[0]?.message ?? 'invalid YAML'}`)
  const anchors: Anchor[] = []
  const converted = convert(document.contents, [], anchors, text)
  const entries = Array.isArray(converted) ? converted : []
  const sourceLines = text.split('\n')
  const header = headerComment(sourceLines)
  const comments = new Map<string, string>()
  const documented = new Set<number>()
  for (const anchor of anchors) {
    // A sequence item and its first key share one line; the block belongs to the table.
    if (documented.has(anchor.line)) continue
    const block = commentAbove(sourceLines, anchor.line)
    if (block === undefined) continue
    documented.add(anchor.line)
    comments.set(anchor.path, block)
  }
  // A file whose first node carries the header block would otherwise repeat it.
  for (const [path, block] of [...comments]) if (block === header) comments.delete(path)

  const lines = stringify({ entry: entries }).split('\n')
  const out: string[] = header === undefined ? [] : [header, '']
  let entry = -1
  let insert = -1
  let table: string | null = null
  for (const line of lines) {
    const headerPath = /^\[\[?([^\]]+)\]\]?$/.exec(line)?.[1] ?? null
    if (headerPath === 'entry') {
      entry += 1
      insert = -1
      table = String(entry)
    } else if (headerPath === 'entry.insert') {
      insert += 1
      table = `${entry}/insert/${insert}`
    } else if (headerPath !== null && headerPath.startsWith('entry.insert.')) {
      table = `${entry}/insert/${insert}/${headerPath.slice('entry.insert.'.length).replace(/\./g, '/')}`
    } else if (headerPath !== null && headerPath.startsWith('entry.')) {
      table = `${entry}/${headerPath.slice('entry.'.length).replace(/\./g, '/')}`
    }
    let path: string | null = null
    if (headerPath === 'entry') path = String(entry)
    else if (headerPath !== null) path = table
    else if (table !== null && /^[A-Za-z0-9_."-]+\s*=/.test(line)) {
      path = `${table}/${line.slice(0, line.indexOf('=')).trim().replace(/^"|"$/g, '')}`
    }
    const block = path === null ? undefined : comments.get(path)
    if (block !== undefined) out.push(...block.split('\n'))
    out.push(line)
  }
  const target = file.replace(/\.ya?ml$/u, '.toml')
  writeFileSync(target, `${out.join('\n').trimEnd()}\n`)
  return target
}

for (const file of process.argv.slice(2)) process.stdout.write(`${convertFile(file)}\n`)
