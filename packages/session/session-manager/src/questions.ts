/**
 * Append-only Markdown question ledger for one management relation.
 *
 * A question never blocks its conversation: it is recorded here, the worker (or
 * manager) keeps going on a provisional decision, and the answer is appended to
 * the same document so the reasoning stays readable after the fact.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** One question item as it is written to the ledger. */
export interface LedgerQuestion {
  /** Stable question item identity inside the call. */
  id: string
  /** The question text itself. */
  question: string
}

/**
 * Path of one management relation's ledger.
 * @param dir - Directory holding every relation's ledger.
 * @param managerId - Managing conversation identity.
 * @returns Absolute path of the Markdown file.
 */
export function questionLogPath(dir: string, managerId: string): string {
  return join(dir, `${managerId}.md`)
}

/**
 * Append one block to a relation's ledger, creating the directory and file.
 * @param path - Ledger path from {@link questionLogPath}.
 * @param block - Markdown block, usually one question or one answer.
 * @returns Resolution once the block is durable enough for a reader.
 */
export async function appendLedger(path: string, block: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await appendFile(path, block.endsWith('\n') ? block : `${block}\n`, 'utf8')
}

/**
 * Render one recorded question as a ledger block.
 * @param input - Question identity, who asked, and its items.
 * @returns Markdown block describing an unanswered question.
 */
export function renderQuestion(input: {
  questionId: string
  workerId: string
  at: number
  items: readonly LedgerQuestion[]
}): string {
  const lines = [
    '',
    `## 待答 · ${new Date(input.at).toISOString()}`,
    `- 提问方: \`${input.workerId}\``,
    `- 问题 id: \`${input.questionId}\``,
    '',
  ]
  for (const item of input.items) lines.push(`- [${item.id}] ${item.question}`)
  lines.push('', '> 已按临时方案继续；答复到达后按答复重做受影响部分。', '')
  return lines.join('\n')
}

/**
 * Render one answer as a ledger block.
 * @param input - Question identity and the accepted answers.
 * @returns Markdown block describing the answer.
 */
export function renderAnswer(input: {
  questionId: string
  at: number
  answers: readonly { id: string; selected: readonly string[]; custom?: string | undefined }[]
}): string {
  const lines = [
    '',
    `### 答复 · ${new Date(input.at).toISOString()}`,
    `- 问题 id: \`${input.questionId}\``,
    '',
  ]
  for (const answer of input.answers) {
    const parts = [...answer.selected]
    if (answer.custom !== undefined && answer.custom.trim() !== '') parts.push(answer.custom.trim())
    lines.push(`- [${answer.id}] ${parts.join(' / ')}`)
  }
  lines.push('')
  return lines.join('\n')
}
