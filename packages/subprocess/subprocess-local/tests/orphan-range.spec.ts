/**
 * Orphan-range rule tests: which stragglers a finished payload may leave behind,
 * and which of them must survive.
 *
 * The rule is the only thing standing between "transient scope lives 16 hours"
 * and "`setsid nohup UnrealEditor` died when its command returned", so both
 * directions are pinned here.
 */
import { describe, expect, it } from 'vitest'
import { classifyLeftovers, parseProcStat, reapDecisionReason, type LeftoverTask } from '../src/orphan-range.ts'

const task = (pid: number, session = pid, parent = 1): LeftoverTask => ({ pid, session, parent })

describe('parseProcStat', () => {
  it('reads pid/parent/session from a real stat line', () => {
    // Fields after "(comm)": state ppid pgrp session …
    const line = '4242 (node) S 1 4242 4242 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 11 0 12345 999 123 18446744073709551615'
    expect(parseProcStat(line)).toEqual({ pid: 4242, parent: 1, session: 4242 })
  })

  it('survives a comm containing spaces, digits and a closing paren', () => {
    // A deliberate hostile name: splitting the line naively yields the wrong pid.
    const line = '77 (evil ) 5 name)) R 12 77 77 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4242 0'
    expect(parseProcStat(line)).toEqual({ pid: 77, parent: 12, session: 77 })
  })

  it('reports undefined for absent, truncated and non-numeric input', () => {
    expect(parseProcStat(undefined)).toBeUndefined()
    expect(parseProcStat('no-parens-here')).toBeUndefined()
    expect(parseProcStat('12 (x) S 1')).toBeUndefined()
    expect(parseProcStat('x (x) S 1 2 3 4')).toBeUndefined()
  })
})

describe('classifyLeftovers', () => {
  it('reports an empty range', () => {
    expect(classifyLeftovers([])).toBe('empty')
  })

  it('reaps an inherited straggler that kept the payload session', () => {
    // MSBuild /nodeReuse:true shape: own pid, but the payload's session id.
    expect(classifyLeftovers([task(500, 400)])).toBe('reap')
  })

  it('keeps a detached survivor because one task leads its own session', () => {
    const tasks = [task(500, 400), task(600)]
    expect(classifyLeftovers(tasks)).toBe('keep')
  })

  it('keeps when the only task is detached', () => {
    expect(classifyLeftovers([task(600)])).toBe('keep')
  })

  it('names the pids that decided the verdict', () => {
    expect(reapDecisionReason([])).toBe('range empty')
    expect(reapDecisionReason([task(500, 400)])).toContain('pid=500')
    const kept = reapDecisionReason([task(500, 400), task(600)])
    expect(kept).toContain('detached survivor')
    expect(kept).toContain('pid=600')
    expect(kept).not.toContain('pid=500')
  })
})
