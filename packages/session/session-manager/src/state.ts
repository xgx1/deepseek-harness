/** Durable management identities and pending cross-Session deliveries; task/chat state stays native. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Identity of one worker's original question call. */
export type ManagementQuestionId = Branded<'management-question-id'>

const sessionId = z.string().transform(value => brandString<SessionId>(value))
const workspaceId = z.string().transform(value => brandString<WorkspaceId>(value))
const callId = z.string().transform(value => brandString<ToolCallId>(value))
const messageId = z.string().transform(value => brandString<MessageId>(value))
const questionId = z.string().transform(value => brandString<ManagementQuestionId>(value))

/** Business question fields accepted by the managed worker's ordinary ask tool. */
export const questionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  header: z.string().optional(),
  detail: z.string().optional(),
  options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })).optional(),
  multi_select: z.boolean().optional(),
})

/** An explicit answer; empty selection without custom text leaves that item pending. */
export const answerSchema = z.object({
  id: z.string().min(1), selected: z.array(z.string()), custom: z.string().optional(),
})

/** Model/tool question value. */
export type ManagementQuestion = z.infer<typeof questionSchema>
/** Model/tool answer value. */
export type ManagementAnswer = z.infer<typeof answerSchema>

const linkSchema = z.object({
  workerId: sessionId, managerId: sessionId, workspaceId, agentPreset: z.string(),
  generation: z.number().int().nonnegative(), paused: z.boolean(), detached: z.boolean(),
  seenSeq: z.number().int(),
})

const creationSchema = z.object({
  managerId: sessionId, workerId: sessionId, workspaceId, agentPreset: z.string(),
  digest: z.string(), message: z.string().optional(), requestId: questionId.optional(),
  ready: z.boolean(),
})

const pendingQuestionSchema = z.object({
  id: questionId, workerId: sessionId, managerId: sessionId, generation: z.number().int(),
  callId, questions: z.array(questionSchema).min(1), answers: z.array(answerSchema),
  status: z.enum(['pending', 'answered', 'cancelled']),
  creation: z.object({ workspaceId, agentPreset: z.string(), message: z.string(), reason: z.string() }).optional(),
})

const deliverySchema = z.object({
  id: messageId, targetId: sessionId, workerId: sessionId, generation: z.number().int(),
  text: z.string().optional(), digest: z.string(), delivered: z.boolean(),
  attachmentSessionId: sessionId.optional(), attachmentSeq: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
})

/** One owner's explicit management relation, not a second task record. */
export type ManagedLink = z.infer<typeof linkSchema>
/** Creation transaction with a preallocated ordinary Session identity. */
export type PendingCreation = z.infer<typeof creationSchema>
/** Original question and incremental answer ledger. */
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>
/** Pending input plus durable receipt; delivered payloads are removed. */
export type PendingDelivery = z.infer<typeof deliverySchema>

/** Validated routing state; a single durable replacement commits related ledger changes together. */
export const managementStateSchema = z.object({
  links: z.record(z.string(), linkSchema),
  creations: z.record(z.string(), creationSchema),
  questions: z.record(z.string(), pendingQuestionSchema),
  deliveries: z.record(z.string(), deliverySchema),
  pausedManagers: z.array(sessionId),
})

/** Persisted non-chat management bookkeeping. */
export type ManagementState = z.infer<typeof managementStateSchema>

/** Domain owned by this opt-in plugin. */
export const managementDomain = defineDomain({
  name: 'session_manager', version: 1,
  tables: {},
  global: {
    schema: managementStateSchema,
    initial: { links: {}, creations: {}, questions: {}, deliveries: {}, pausedManagers: [] },
  },
})

/** Hash separate identity components without delimiter ambiguity.
 * @param parts - Ordered identities of the source operation.
 * @returns A deterministic native message identity.
 */
export function deliveryId(...parts: string[]): MessageId {
  return brandString<MessageId>(`manager-${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`)
}

/** Merge only explicit answers and reject identity mistakes or conflicting retries.
 * @param questions - Original question items.
 * @param previous - Previously committed answers.
 * @param incoming - New answer batch.
 * @returns Original-order answered items; skipped items remain absent.
 */
export function mergeAnswers(
  questions: readonly ManagementQuestion[], previous: readonly ManagementAnswer[], incoming: readonly ManagementAnswer[],
): ManagementAnswer[] {
  const answers = new Map(previous.map(answer => [answer.id, answer]))
  const seen = new Set<string>()
  for (const answer of incoming) {
    const question = questions.find(item => item.id === answer.id)
    if (question === undefined) throw new Error(`Unknown question: ${answer.id}`)
    if (seen.has(answer.id)) throw new Error(`Duplicate question answer: ${answer.id}`)
    seen.add(answer.id)
    if (answer.selected.length === 0 && !answer.custom?.trim()) continue
    if (!question.multi_select && answer.selected.length > 1) throw new Error(`Choose one option for ${answer.id}`)
    if (question.options !== undefined && answer.selected.some(value => !question.options?.some(option => option.label === value))) {
      throw new Error(`Unknown option for ${answer.id}`)
    }
    const old = answers.get(answer.id)
    if (old !== undefined && JSON.stringify(old) !== JSON.stringify(answer)) throw new Error(`Question ${answer.id} is already answered`)
    answers.set(answer.id, answer)
  }
  return questions.flatMap((question) => {
    const answer = answers.get(question.id)
    return answer === undefined ? [] : [answer]
  })
}

/** Truncate a report at a UTF-8 character boundary.
 * @param text - Source report text.
 * @param maxBytes - Complete byte budget available for the text.
 * @returns Valid UTF-8 text within the budget.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  return new TextDecoder().decode(Buffer.from(text).subarray(0, Math.max(0, maxBytes)), { stream: true })
}
