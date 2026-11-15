/**
 * TOML dialect for Cordis entry files. A TOML document cannot be a bare array,
 * so the entry (or patch) list travels as an array of tables under one root
 * key, and a value stays literal until its owning Loader entry evaluates it by
 * carrying the `js:` prefix instead of YAML's `!!js` tag.
 * @module @deepseek-ai/cordis-plugin-include/toml
 */

import { parse, stringify, type TomlTable } from 'smol-toml'

/** Root key whose array of tables carries the entry list. */
export const ENTRY_ROOT_KEY = 'entry'

/** Root key accepted for a patch file's list. */
export const PATCH_ROOT_KEY = 'patch'

/** Prefix marking a string value as a JavaScript expression. */
export const JS_EXPRESSION_PREFIX = 'js:'

/**
 * Parse a TOML entry or patch file.
 * @param content - TOML source text.
 * @returns the entry or patch list, with expression markers restored.
 * @throws {Error} when the document has no entry or patch root array.
 */
export function parseEntryToml(content: string): unknown {
  const document: TomlTable = parse(content)
  const root = document[ENTRY_ROOT_KEY] ?? document[PATCH_ROOT_KEY]
  if (!Array.isArray(root)) {
    throw new Error(`Cordis TOML requires a [[${ENTRY_ROOT_KEY}]] array of tables`)
  }
  return markExpressions(root)
}

/**
 * Serialize an entry or patch list as TOML.
 * @param value - entry list, patch list, or entry fragment to serialize.
 * @returns TOML text ending with a newline.
 */
export function stringifyEntryToml(value: unknown): string {
  return stringify({ [ENTRY_ROOT_KEY]: unmarkExpressions(value) } as TomlTable)
}

/** Replace every prefixed string with the expression node the Loader evaluates. */
function markExpressions(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith(JS_EXPRESSION_PREFIX)
      ? { __jsExpr: value.slice(JS_EXPRESSION_PREFIX.length) }
      : value
  }
  if (Array.isArray(value)) return value.map(markExpressions)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) out[key] = markExpressions(child)
    return out
  }
  return value
}

/** Write expression nodes back as prefixed strings. */
function unmarkExpressions(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && '__jsExpr' in value) {
    const expression = (value as { __jsExpr?: unknown }).__jsExpr
    if (typeof expression === 'string') return `${JS_EXPRESSION_PREFIX}${expression}`
  }
  if (Array.isArray(value)) return value.map(unmarkExpressions)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) out[key] = unmarkExpressions(child)
    return out
  }
  return value
}
