/**
 * File-reference discovery seam shared by host-backed user interfaces.
 *
 * @module @deepseek-ai/dsh-file-reference
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import type { FileReferenceCandidate } from './types.ts'

export { activeAtToken, formatFileMention } from './grammar.ts'
export type { ActiveAtToken, FileReferenceCandidate } from './types.ts'

/** Model guidance for path-only references selected by a user interface. */
export const FILE_REFERENCE_PROMPT = '带 @ 前缀的 token 是用户显式引用的路径。相对路径从工作区根解析；绝对路径指向宿主机上的文件或目录。结尾的斜杠表示目录：内容相关时列出它。其余都是文件：需要其内容时用 read 工具，读之前不要声称已经查看过。@"..." 用于引用含空格的路径。'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileReferences: FileReferenceService
  }
}

/** Host capability for cancellable file-reference discovery. */
export abstract class FileReferenceService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fileReferences')
  }

  /**
   * List file and directory candidates for one agent's working directory.
   * @param agent - target agent whose session cwd bounds discovery.
   * @param query - path text following `@` or `@"`.
   * @param signal - caller cancellation.
   * @returns deterministic path-only candidates.
   */
  abstract list(
    agent: Agent,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]>
}

export default FileReferenceService
