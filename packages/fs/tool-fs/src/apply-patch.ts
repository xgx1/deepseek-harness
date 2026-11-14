/** Multi-file patch tool over the guarded patch executor. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { executePatch } from './patch/index.ts'
import { patchOutputSchema, patchToolValue, renderPatch, patchPresentationMeta } from './apply-patch-output.ts'
import { presentPatchCall, presentPatchResult } from './apply-patch-presentation.ts'
import type { FsEscalationArgs, FsSandboxController } from './sandbox.ts'

/** Model arguments after tool-schema validation. */
interface ApplyPatchArgs extends FsEscalationArgs { input: string }

/**
 * Register the patch tool and scope-aware guidance using the shared mutation controller.
 * @param ctx - plugin effect scope and filesystem services.
 * @param sandbox - per-call policy resolver and denial mapper.
 */
export function applyApplyPatchTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:apply_patch', order: ctx.systemPrompt.getSectionOrder('TOOL_APPLY_PATCH'),
    text: ({ scope }) => ctx.tools.get('apply_patch', scope) === undefined ? ''
      : '跨文件或被拆开的多个区域有改动时，优先用 apply_patch，而不是多次单独的 edit 调用。'
        + '给每个 hunk 足够的上下文行，让它在当前文件里只匹配到一处。'
        + '整块补丁先整体检查（语法、hunk 匹配、缺失文件），被拒绝的补丁不产生任何改动；'
        + '一旦开始应用，操作按顺序执行，遇到第一个失败即停止，且不回滚，所以必要时先重新读取受影响的文件再重试。',
  })
  ctx.tools.register(defineTool({
    name: 'apply_patch',
    description: 'Create, update, delete, or move UTF-8 text files with one patch; '
      + 'prefer it over multiple edit calls when a change spans several files or separated regions.',
    parameters: {
      input: { type: 'string', required: true,
        description: 'Patch text: start with *** Begin Patch and end with *** End Patch. '
          + 'Use *** Add File: path with + lines; *** Update File: path, optionally followed by *** Move to: path, '
          + 'with @@ or @@ context and space-prefixed context, + added, or - removed lines; '
          + '*** End of File anchors the last hunk to the file end. Use *** Delete File: path to delete. '
          + 'Paths are relative to the Session working directory.',
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: patchOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderPatch(value) }],
      presentationMeta: (_args, value) => patchPresentationMeta(value),
    },
    async execute(args: ApplyPatchArgs, exec) {
      const sandboxPolicy = await sandbox.resolvePolicy('apply_patch', args, exec)
      return patchToolValue(await executePatch(ctx, sandbox, exec, { patch: args.input, sandboxPolicy }))
    },
    presentCall: args => presentPatchCall(args.input),
    presentResult: (_args, result) => presentPatchResult(result),
  }))
}
