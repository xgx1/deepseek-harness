/** Provider-neutral classification of an error body that arrived without an HTTP status. */

import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  QUOTA_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'

/** Provider error fields both DeepSeek protocols read from an error envelope. */
export interface ProviderErrorFields {
  /** Provider-issued error code, when the body carries one. */
  readonly code?: string
  /** Provider-issued error type, when the body carries one. */
  readonly type?: string
  /** Provider-issued human-readable message, when the body carries one. */
  readonly message?: string
}

/**
 * Join an error envelope's fields into the one detail string the shared
 * classifiers match against.
 * @param fields - provider error code, type, and message text.
 * @returns the non-empty fields joined by a single space.
 */
export function providerErrorText(fields: ProviderErrorFields): string {
  return [fields.type, fields.code, fields.message]
    .filter((field): field is string => typeof field === 'string' && field.length > 0)
    .join(' ')
}

/**
 * Classify an error the provider delivered in band — an SSE `error` event or an
 * HTTP 200 body carrying an error envelope — where no HTTP status exists to
 * route on. An explicit 429 or rate-limit signal is throttling even when quota
 * wording accompanies it, because the 429 is the rate-limit instruction.
 * Terminal classes keep their own codes; every other provider failure is
 * `SERVER`, because the server reported it and retry policy, not this
 * classifier, owns whether that attempt is worth repeating.
 * @param fields - provider error code, type, and message text.
 * @returns the stable machine-routable failure code for that error body.
 */
export function inBandProviderErrorCode(fields: ProviderErrorFields): string {
  if (fields.type === 'authentication_error' || fields.type === 'permission_error') return 'AUTH'
  const detail = providerErrorText(fields)
  if (/\b429\b/.test(detail) || fields.type === 'rate_limit_error' || /\brate.?limit\b/i.test(detail)) return 'RATE_LIMIT'
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
  if (fields.type === 'invalid_request_error') return 'INVALID_REQUEST'
  return 'SERVER'
}
