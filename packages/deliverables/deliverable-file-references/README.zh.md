---
description: "为 Web 和 SDK agent 提供共用的文件链接与结果交付说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-deliverable-file-references

[English](README.md) | 中文

## 概述

Agent 在 Web 和 SDK 会话中接收相同的文件链接与结果交付说明。宿主能够提供链接或已交付文件时，可使用这段指导。它增加一个固定的系统提示词段落；文件访问与渲染仍由宿主负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 和 `sdk` bundle 独立于 `present` 工具挂载本插件。自定义组合仅需提供 `systemPrompt`：

```yaml
- id: deliverable-file-references
  name: '@deepseek-ai/dsh-deliverable-file-references'
```

本包没有配置字段。执行文件交付时，需单独挂载 [`dsh-tool-present`](../tool-present/README.zh.md)。禁用本行即可省略这段指导。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[插件入口](src/index.ts)按共享的 `DELIVERABLE_FILE_REFERENCES` 顺序注册 `ui:deliverable-file-references`。卸载时 Cordis 移除该段落。本插件不读取文件，也不启动 GUI 或传输服务。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [系统提示词](../../core/system-prompt/README.zh.md)——段落组装与顺序。
- [Present 工具](../tool-present/README.zh.md)——可执行的文件交付声明。
- [Web 交付](../../client/ui-deliverables/README.zh.md)——文件卡片与文件打开。

<a id="model-experience"></a>
## 模型体验

### 文件引用指导

#### 模型看到的内容

每次组装均包含同一个静态段落：

##### 共用指导

```markdown
在最终答复里优先直接展示主要结果，并配一句简要说明。当图片有助于说明或对比时用 ![描述](<path/to/image.png>)；提到某张图片或列出文件时用 [描述](<path/to/image.png>)。Markdown 里的文件目标用尖括号包住，尤其是含空格的路径。不要只是为了列出改过的源文件就调用 present，也不要为了看 diff 视图是否出现而跑命令。当单独访问对用户有帮助时，用 present 发布完整交付物，包括图片、Office 文档、表格与幻灯片。支持文件卡片的宿主可以展示所发布的文件，并提供预览与打开操作。避免重复已经内联展示过的结果，除非单独的卡片能带来额外价值。在命令、配置表达式与代码块之外，每次提到已存在的文件（含重复提及与表格里的）都要链接到它的完整路径——相对工作目录或绝对路径；已知行号时在目标后追加 #L24 或 #L24-L30。标签用文件名或能区分的别名，只补足以区分文件的父目录，不要把完整路径写进标签。默认只用名字；需要精确位置时在标签后追加 :24 或 :24–30，行号后缀不带 # 或 L。
```

#### Token 影响

挂载期间增加一个固定段落，不增加工具 schema 或额外模型请求。

#### KV Cache 影响

该段落跨轮次保持 first-party 顺序 9000。挂载、移除或修改它会改变组装后的提示词前缀；它不增加逐轮变化的值。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 指导要求宿主支持文件链接或交付；本插件不实现渲染、文件访问或 `present` 工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
