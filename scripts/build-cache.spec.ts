import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gateInputHash, readGateStamp, writeGateStamp } from './build-cache.ts'

const roots: string[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'build-cache-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('gateInputHash', () => {
  it('ignores unchanged trees and reacts to a write', () => {
    const root = scratch()
    mkdirSync(join(root, 'pkg/src'), { recursive: true })
    writeFileSync(join(root, 'pkg/src/index.ts'), 'export const a = 1')
    const first = gateInputHash(root, ['pkg/src'])
    expect(gateInputHash(root, ['pkg/src'])).toBe(first)
    writeFileSync(join(root, 'pkg/src/index.ts'), 'export const a = 2')
    expect(gateInputHash(root, ['pkg/src'])).not.toBe(first)
  })

  it('treats a missing tree as empty', () => {
    const root = scratch()
    expect(gateInputHash(root, ['does/not/exist'])).toBe(gateInputHash(root, []))
  })
})

describe('gate stamps', () => {
  it('round-trips a hash and ignores a torn file', () => {
    const root = scratch()
    expect(readGateStamp(root, 'web')).toBeUndefined()
    writeGateStamp(root, 'web', 'abc')
    expect(readGateStamp(root, 'web')).toBe('abc')
    writeFileSync(join(root, '.cache/build-gates/web.json'), '{not json')
    expect(readGateStamp(root, 'web')).toBeUndefined()
  })
})
