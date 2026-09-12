/** First-party Host inspect providers registered by the Cordis tool package. */

import type { Context } from '@deepseek-ai/cordis'
import { HOST_BUILTIN_INSPECTION } from '@deepseek-ai/dsh-cordis-host-runner'
import type { CordisInspectProviderManifest, CordisInspectProviderView } from '@deepseek-ai/dsh-cordis-host-runner'
import type { HostCordisInspectProviderRegistration } from '@deepseek-ai/dsh-cordis-host-runner'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { EVENT_API, queryEventApi, queryServiceApi } from './api-catalog.ts'

const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false } as const
const ANY_OUTPUT = { description: 'JSON data owned by this inspect provider.' } as const
const SERVICE_INPUT = exactInput('service', 'Exact Service key. Omit it for the compact Service and method-signature directory.')
const EVENT_INPUT = exactInput('event', 'Exact Event name. Omit it for the compact Event and listener-signature directory.')
const SERVICE_OUTPUT = {
  description: 'Compact Service directory, or one exact Service contract with only its referenced type declarations.',
} as const
const EVENT_OUTPUT = {
  description: 'Compact Event directory, or one exact Event contract with only its referenced type declarations.',
} as const
const HOST_EVENTS = EVENT_API.filter(event => !event.name.startsWith('cordis/'))

/**
 * Construct Host providers over generated Catalogs, evaluator declarations, and live Tool scope.
 * @param ctx - Host context used for Agent-scoped live Tool queries.
 * @returns registrations for static catalogs and live Host capabilities.
 */
export function hostInspectProviders(ctx: Context): HostCordisInspectProviderRegistration[] {
  return [
    registration(
      'Service',
      'Progressive Host Service discovery: compact capability/signature directory, then one exact coding contract.',
      'listService',
      input => queryServiceApi(readExact(input, 'service')) as unknown as JsonValue,
      SERVICE_INPUT,
      SERVICE_OUTPUT,
    ),
    registration(
      'Event',
      'Progressive Host Event discovery: compact listener directory, then one exact event contract.',
      'listEvents',
      input => queryEventApi(readExact(input, 'event'), HOST_EVENTS) as unknown as JsonValue,
      EVENT_INPUT,
      EVENT_OUTPUT,
    ),
    registration('Builtin', 'Plain-JavaScript symbols available to a dynamic Host half.', 'listBuiltins', () => ({
      builtins: HOST_BUILTIN_INSPECTION,
      referencedTypes: [],
    } as unknown as JsonValue)),
    {
      manifest: {
        id: 'Tool',
        description: 'Tools visible to the requesting Agent, including scoped and dynamic registrations.',
        methods: [{
          name: 'listTools',
          description: 'Return every Tool schema currently callable by this Agent.',
          inputSchema: EMPTY_INPUT,
          outputSchema: ANY_OUTPUT,
        }],
      },
      query(method, _input, context) {
        if (method !== 'listTools') throw new Error(`unknown Tool inspect method "${method}"`)
        return Promise.resolve({ tools: ctx.tools.schemas(context.agent) } as unknown as JsonValue)
      },
    },
  ]
}

function registration(
  id: string,
  description: string,
  method: string,
  query: (input: JsonValue | undefined) => JsonValue | Promise<JsonValue>,
  inputSchema: JsonValue = EMPTY_INPUT,
  outputSchema: JsonValue = ANY_OUTPUT,
): HostCordisInspectProviderRegistration {
  return {
    manifest: {
      id,
      description,
      methods: [{
        name: method,
        description,
        inputSchema,
        outputSchema,
      }],
    },
    async query(requested, input) {
      if (requested !== method) throw new Error(`unknown ${id} inspect method "${requested}"`)
      return await query(input)
    },
  }
}

function exactInput(field: string, description: string): JsonValue {
  return { type: 'object', properties: { [field]: { type: 'string', description } }, additionalProperties: false }
}

function readExact(input: JsonValue | undefined, field: string): string | undefined {
  if (input === undefined || input === null || Array.isArray(input) || typeof input !== 'object') return undefined
  const value = input[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Register one first-party Host inspect provider, sharing an identical live
 * registration instead of failing on the duplicate id.
 *
 * Standing preset mounts live for the whole process, so two presets carrying
 * this package — the shipped `cordis` preset beside any locally authored copy
 * of it — both run their registration effects against the ONE process-global
 * `cordisInspect` instance. The four providers are share-safe: Service, Event,
 * and Builtin answer from static catalogs, and Tool resolves every query from
 * the requesting Agent rather than from the mounting scope. A registration
 * whose manifest is structurally equal to the live one therefore returns a
 * no-op disposer; any other collision still fails loud through `register`.
 * @param ctx - Host context whose `cordisInspect` registry owns the providers.
 * @param provider - one provider constructed by {@link hostInspectProviders}.
 * @returns the owning disposer, or a no-op when an equal provider is shared.
 */
export function shareInspectProvider(ctx: Context, provider: HostCordisInspectProviderRegistration): () => void {
  try {
    return ctx.cordisInspect.register(provider)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message !== `Host Cordis inspect provider "${provider.manifest.id}" is already registered`) throw error
    const registered = ctx.cordisInspect.list().find(
      candidate => candidate.platform === 'host' && candidate.id === provider.manifest.id,
    )
    if (registered === undefined || !sameManifest(registered, provider.manifest)) throw error
    return () => {}
  }
}

/** Structural manifest equality over ids, descriptions, and declared schemas. */
function sameManifest(left: CordisInspectProviderView, right: CordisInspectProviderManifest): boolean {
  return left.id === right.id
    && left.description === right.description
    && left.methods.length === right.methods.length
    && left.methods.every((method, index) => {
      // Lengths are equal above, so the index is in-bounds; the guard narrows
      // `noUncheckedIndexedAccess` without claiming more than the check.
      const other = right.methods[index]
      return other !== undefined
        && method.name === other.name
        && method.description === other.description
        && JSON.stringify(method.inputSchema) === JSON.stringify(other.inputSchema)
        && JSON.stringify(method.outputSchema) === JSON.stringify(other.outputSchema)
    })
}
