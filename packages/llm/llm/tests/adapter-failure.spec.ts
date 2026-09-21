import { describe, expect, it } from 'vitest'
import { normalizeLlmFailure } from '../src/adapter-failure.ts'
import { LlmError } from '../src/index.ts'

describe('adapter failure normalization', () => {
  it('contains hostile non-Error coercion', () => {
    const thrown = { [Symbol.toPrimitive]: () => { throw new Error('coercion failed') } }
    expect(normalizeLlmFailure(thrown)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })

  it('normalizes empty primitive throws and data descriptors without values', () => {
    expect(normalizeLlmFailure('')).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
    expect(normalizeLlmFailure(null)).toEqual({ message: 'null', code: 'UNKNOWN' })

    const error = new Error('provider failed')
    Object.defineProperty(error, 'failure', { get: () => ({ message: 'ignored', code: 'IGNORED' }) })
    Object.defineProperty(error, 'code', { get: () => 'IGNORED' })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const accessorCode = Object.assign(new Error('provider failed'), {
      failure: { message: 'provider failed', code: 'FOREIGN' },
    })
    Object.defineProperty(accessorCode, 'code', { get: () => 'FOREIGN' })
    expect(normalizeLlmFailure(accessorCode)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const primitiveFailure = Object.assign(new Error('provider failed'), {
      failure: null,
      code: 'FOREIGN',
    })
    expect(normalizeLlmFailure(primitiveFailure)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('contains hostile Error property reflection', () => {
    const withFailure = new Error('provider failed') as Error & { failure: unknown; code: string }
    withFailure.failure = { message: 'provider failed', code: 'FOREIGN' }
    withFailure.code = 'FOREIGN'
    const hostileCode = new Proxy(withFailure, {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'code') throw new Error('code descriptor failed')
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
    expect(normalizeLlmFailure(hostileCode)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const hostileFailure = new Proxy(new Error('provider failed'), {
      getOwnPropertyDescriptor() { throw new Error('failure descriptor failed') },
    })
    expect(normalizeLlmFailure(hostileFailure)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('rejects malformed or accessor-backed failure snapshots', () => {
    const malformed = new Error('provider failed') as Error & { failure: unknown; code: string }
    malformed.failure = { message: 'provider failed', code: 'FOREIGN', requestId: '' }
    malformed.code = 'FOREIGN'
    expect(normalizeLlmFailure(malformed)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const accessorBacked = new Error('provider failed') as Error & { failure: unknown }
    accessorBacked.failure = Object.defineProperty({}, 'message', {
      get() { throw new Error('failure getter failed') },
    })
    expect(normalizeLlmFailure(accessorBacked)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('falls back when an Error message accessor throws', () => {
    const error = new Error('provider failed')
    Object.defineProperty(error, 'message', { get() { throw new Error('message getter failed') } })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })

  it('classifies a foreign error carrying an own HTTP status as a server-side failure', () => {
    const server = Object.assign(new Error('503 Service Unavailable'), { status: 503 })
    expect(normalizeLlmFailure(server)).toEqual({ message: '503 Service Unavailable', code: 'SERVER', status: 503 })

    const throttled = Object.assign(new Error('429 Too Many Requests'), { status: 429 })
    expect(normalizeLlmFailure(throttled)).toEqual({ message: '429 Too Many Requests', code: 'RATE_LIMIT', status: 429 })

    const requestTimeout = Object.assign(new Error('408 Request Timeout'), { status: 408 })
    expect(normalizeLlmFailure(requestTimeout)).toEqual({ message: '408 Request Timeout', code: 'TIMEOUT', status: 408 })

    const tooEarly = Object.assign(new Error('425 Too Early'), { status: 425 })
    expect(normalizeLlmFailure(tooEarly)).toEqual({ message: '425 Too Early', code: 'SERVER', status: 425 })

    const statusCodeField = Object.assign(new Error('500 Internal Server Error'), { statusCode: 500 })
    expect(normalizeLlmFailure(statusCodeField)).toEqual({ message: '500 Internal Server Error', code: 'SERVER', status: 500 })
  })

  it('keeps an accessor-backed or out-of-range status unclassified', () => {
    const accessorStatus = Object.assign(new Error('provider failed'), { status: 500 })
    Object.defineProperty(accessorStatus, 'status', { get: () => 500 })
    expect(normalizeLlmFailure(accessorStatus)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const outOfRange = Object.assign(new Error('provider failed'), { status: 42 })
    expect(normalizeLlmFailure(outOfRange)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const stringStatus = Object.assign(new Error('provider failed'), { status: '500' })
    expect(normalizeLlmFailure(stringStatus)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const trapped = new Proxy(Object.assign(new Error('provider failed'), { status: 500 }), {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'status') throw new Error('status descriptor failed')
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
    expect(normalizeLlmFailure(trapped)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('keeps a harness failure snapshot authoritative beside a foreign status', () => {
    const carried = Object.assign(new LlmError('gateway refused', 'INVALID_REQUEST'), { status: 503 })
    expect(normalizeLlmFailure(carried)).toEqual({ message: 'gateway refused', code: 'INVALID_REQUEST' })
  })
})
