import { describe, expect, it } from 'vitest'
import { deliveryId, mergeAnswers, truncateUtf8 } from '../src/state.ts'

describe('management routing records', () => {
  it('uses a stable delivery identity without concatenation collisions', () => {
    expect(deliveryId('worker:a', 'b')).toBe(deliveryId('worker:a', 'b'))
    expect(deliveryId('worker:a', 'b')).not.toBe(deliveryId('worker', 'a:b'))
  })

  it('keeps unanswered items pending and rejects unknown or conflicting replies', () => {
    const questions = [{ id: 'color', question: 'Color?' }, { id: 'size', question: 'Size?' }]
    const first = mergeAnswers(questions, [], [{ id: 'color', selected: ['blue'] }])
    expect(first).toEqual([{ id: 'color', selected: ['blue'] }])
    expect(mergeAnswers(questions, first, [{ id: 'size', selected: [] }])).toEqual(first)
    expect(mergeAnswers(questions, first, first)).toEqual(first)
    expect(() => mergeAnswers(questions, first, [{ id: 'unknown', selected: ['x'] }])).toThrow('Unknown question')
    expect(() => mergeAnswers(questions, first, [{ id: 'color', selected: ['red'] }])).toThrow('already answered')
    expect(mergeAnswers(questions, first, [{ id: 'size', selected: [], custom: 'large' }])).toHaveLength(2)
  })

  it('bounds multibyte reports without corrupting text', () => {
    expect(truncateUtf8('中文abc', 5)).toBe('中')
    expect(truncateUtf8('中文abc', 6)).toBe('中文')
    expect(truncateUtf8('ok', 6)).toBe('ok')
    expect(Buffer.byteLength(truncateUtf8('😀😀', 5))).toBeLessThanOrEqual(5)
  })
})
