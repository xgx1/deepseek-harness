import { describe, expect, it } from 'vitest'
import { codeForHttpStatus } from '../src/error.ts'

describe('codeForHttpStatus', () => {
  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [408, 'TIMEOUT'],
    [413, 'INVALID_REQUEST'],
    [425, 'SERVER'],
    [429, 'RATE_LIMIT'],
    [500, 'SERVER'],
    [502, 'SERVER'],
    [503, 'SERVER'],
    [504, 'SERVER'],
    [599, 'SERVER'],
    [400, 'HTTP_400'],
    [404, 'HTTP_404'],
    [418, 'HTTP_418'],
  ])('maps status %s to %s', (status, code) => {
    expect(codeForHttpStatus(status)).toBe(code)
  })
})
