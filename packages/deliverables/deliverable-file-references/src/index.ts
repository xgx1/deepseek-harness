/** Shared file-delivery guidance for clients that render desktop-style file references. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Loader identity. */
export const name = 'deliverable-file-references'

/** Prompt registry shared by the Web and SDK desktop compositions. */
export const inject = ['systemPrompt']

/** Static Web guidance for primary outputs and existing-file references. */
const FILE_REFERENCE_PROMPT = '在最终答复里优先直接展示主要结果，并配一句简要说明。'
  + '当图片有助于说明或对比时用 ![描述](<path/to/image.png>)；提到某张图片或列出文件时用 [描述](<path/to/image.png>)。Markdown 里的文件目标用尖括号包住，尤其是含空格的路径。'
  + '不要只是为了列出改过的源文件就调用 present，也不要为了看 diff 视图是否出现而跑命令。'
  + '当单独访问对用户有帮助时，用 present 发布完整交付物，包括图片、Office 文档、表格与幻灯片。支持文件卡片的宿主可以展示所发布的文件，并提供预览与打开操作。'
  + '避免重复已经内联展示过的结果，除非单独的卡片能带来额外价值。'
  + '在命令、配置表达式与代码块之外，每次提到已存在的文件（含重复提及与表格里的）都要链接到它的完整路径——相对工作目录或绝对路径；已知行号时在目标后追加 #L24 或 #L24-L30。'
  + '标签用文件名或能区分的别名，只补足以区分文件的父目录，不要把完整路径写进标签。默认只用名字；需要精确位置时在标签后追加 :24 或 :24–30，行号后缀不带 # 或 L。'

/**
 * Register the desktop file-reference guidance without mounting a GUI.
 * @param ctx - context carrying the prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'ui:deliverable-file-references',
    order: ctx.systemPrompt.getSectionOrder('DELIVERABLE_FILE_REFERENCES'),
    text: FILE_REFERENCE_PROMPT,
  })
}
