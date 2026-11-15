/** The Include plugin's TOML dialect parses and serializes entry lists. */

import { describe, expect, it } from 'vitest'
import { ENTRY_ROOT_KEY, JS_EXPRESSION_PREFIX, parseEntryToml, stringifyEntryToml } from '../vendor/include/src/toml.ts'
import { isJsExpr } from '../vendor/loader/src/index.ts'

describe('cordis TOML entries', () => {
  it('parses an array of tables under the entry root key', () => {
    const entries = parseEntryToml(`
[[${ENTRY_ROOT_KEY}]]
id = "persistence"
name = "@deepseek-ai/dsh-session-persistence-turso"

  [${ENTRY_ROOT_KEY}.config]
  path = "/var/lib/dsh/sessions.db"
`)
    expect(entries).toEqual([
      { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-turso', config: { path: '/var/lib/dsh/sessions.db' } },
    ])
  })

  it('turns a prefixed string into an expression node and back', () => {
    const entries = parseEntryToml(`
[[${ENTRY_ROOT_KEY}]]
id = "sessions"
root = "${JS_EXPRESSION_PREFIX}dshHomePath('sessions')"
`)
    const config = (entries as Array<{ root?: unknown }>)[0]?.root
    expect(isJsExpr(config)).toBe(true)
    expect(stringifyEntryToml(entries)).toContain(`root = "${JS_EXPRESSION_PREFIX}dshHomePath('sessions')"`)
  })

  it('refuses a document without an entry root', () => {
    expect(() => parseEntryToml('path = "x"')).toThrow(/requires a \[\[entry\]\]/)
  })
})
