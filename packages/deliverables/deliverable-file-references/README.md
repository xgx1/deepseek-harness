---
description: "Give Web and SDK agents shared instructions for linking files and delivering results."
kind: "package-reference"
---

# @deepseek-ai/dsh-deliverable-file-references

English | [中文](README.zh.md)

## Summary

Agents receive the same file-link and result-delivery instructions in Web and SDK sessions. Use this guidance when a host can expose links or delivered files. It adds one fixed system-prompt paragraph; hosts retain responsibility for file access and rendering.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web and `sdk` bundles mount this plugin independently of the `present` tool. Custom compositions need only `systemPrompt`:

```yaml
- id: deliverable-file-references
  name: '@deepseek-ai/dsh-deliverable-file-references'
```

There are no configuration fields. Mount [`dsh-tool-present`](../tool-present/README.md) separately to execute file deliveries. Disable this row to omit its guidance.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [plugin entry](src/index.ts) registers `ui:deliverable-file-references` at the shared `DELIVERABLE_FILE_REFERENCES` order. Cordis removes the section on unload. It reads no files and starts no GUI or transport.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [System prompts](../../core/system-prompt/README.md) — section assembly and ordering.
- [Present tool](../tool-present/README.md) — executable file-delivery declarations.
- [Web deliverables](../../client/ui-deliverables/README.md) — file cards and file opening.

<a id="model-experience"></a>
## Model Experience

### File-reference guidance

#### What the model sees

Each assembly includes the same static paragraph:

##### Shared guidance

```markdown
在最终答复里优先直接展示主要结果，并配一句简要说明。当图片有助于说明或对比时用 ![描述](<path/to/image.png>)；提到某张图片或列出文件时用 [描述](<path/to/image.png>)。Markdown 里的文件目标用尖括号包住，尤其是含空格的路径。不要只是为了列出改过的源文件就调用 present，也不要为了看 diff 视图是否出现而跑命令。当单独访问对用户有帮助时，用 present 发布完整交付物，包括图片、Office 文档、表格与幻灯片。支持文件卡片的宿主可以展示所发布的文件，并提供预览与打开操作。避免重复已经内联展示过的结果，除非单独的卡片能带来额外价值。在命令、配置表达式与代码块之外，每次提到已存在的文件（含重复提及与表格里的）都要链接到它的完整路径——相对工作目录或绝对路径；已知行号时在目标后追加 #L24 或 #L24-L30。标签用文件名或能区分的别名，只补足以区分文件的父目录，不要把完整路径写进标签。默认只用名字；需要精确位置时在标签后追加 :24 或 :24–30，行号后缀不带 # 或 L。
```

#### Token effect

One fixed paragraph while mounted, with no tool schema or extra model request.

#### KV Cache effect

The paragraph stays at first-party order 9000 across turns. Mounting, removing, or changing it changes the assembled prompt prefix; it adds no per-turn values.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Guidance requires a host that supports file links or deliveries; this plugin does not implement rendering, file access, or the `present` tool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
