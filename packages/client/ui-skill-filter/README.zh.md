---
description: "技能过滤界面：会话视图里目录与两层规则并排的整页、编辑同一批清单的设置页，以及展示合并规则的右侧栏标签页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-filter

[English](README.md) | 中文

## 概述

技能过滤规则的浏览器界面：会话视图里把会话技能目录与个人、项目两层 allow 清单摆在一起；设置页提供同一批清单；右侧栏标签页展示当前生效的合并规则，并挂同一张项目面板。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## 使用本包

出厂 Web 组合已挂载本包。会话开着时点会话视图标题栏里的**技能**页签打开整页，或在设置里打开**技能**编辑同一批清单，或从右侧栏指南打开**技能**查看合并视图与项目面板。

### 何时选择它

当问题是「用户如何编辑规则」时选择本包。规则引擎与配置文件归 `dsh-skill-filter`，传输归控制器。

### 各界面展示什么

会话页签把目录与两层规则摆在一起：页头统计技能总数与可见数，目录里的开关写项目草稿，项目与个人各一张卡、各有一次保存。设置页把个人 allow 模式渲染成可编辑行，为当前会话的工作目录挂上同一张项目面板，按名字前缀把会话目录分组以便整组放行，并列出每个技能的当前可见性与逐个允许开关——这里的开关写的是个人层。右侧栏标签页展示宿主报告的项目合并规则、标注哪一层存在，并用同一张面板编辑项目清单；没有项目配置时，项目草稿从当前生效的规则起步。

### 最小组合

```yaml
- id: ui-skill-filter
  name: '@deepseek-ai/dsh-client-ui-skill-filter'
```

目录半边需要会话：没有会话时界面会明说，而不是渲染一个空列表。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

### 同一个宿主面

两个界面调用同一个绑定到 `ctx.remote` 的面。每次调用把已落定的 `RemoteResult` 折进组件本地状态；组件不携带订阅机制，也没有跨渲染存活的 store。

### 草稿归属

每一层都是一个 hook（个人层 `usePersonalLayer`、单项目的 `useProjectLayer`）加上渲染它的面板，因此每个界面挂的都是同一份草稿模型。规则行是界面自己的草稿。保存写的是整层——文件不按字段合并——并重新发布被接受的副本，让行显示宿主最终保留的内容。项目面板是一个组件（`useProjectLayer` 加 `ProjectRulesPanel`），两个界面各挂一次，草稿、起步规则与保存路径只写一处：存在项目配置时取自项目配置，不存在时取自合并配置，因为两层取并集，草稿编辑的是项目层。

</details>

-----

<a id="further-exploration"></a>

## 延伸阅读

- [技能过滤控制器](../../api/skill-filter-controller/README.zh.md) — 这些界面调用的 Remote 命名空间。
- [右侧栏](../../../docs/subsystems/sidebar-right.zh.md) — 标签页组合、导航与生命周期。

-----

<a id="model-experience"></a>

## 模型体验

无。本包是浏览器侧 UI 插件层，不注册任何工具、提示段或会话事件。它编辑的规则通过 `dsh-skill-filter` 改变目录。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。


## Known Limitations and Deferred Work

无。
- 两层取并集，因此项目无法隐藏个人配置允许的技能；该技能要从个人清单里去掉。
- 两个界面都只展示隐藏技能的当前状态，不解释原因：被自身 frontmatter 隐藏与被合并规则隐藏在这里读起来一样。

- 目录取自会话，因此在还没有任何会话时打开设置页看不到技能列表。
- 项目面板同样要用会话的工作目录，因此设置页与会话页签都在有会话之后才渲染它。
- 目录里的开关在会话页签写项目层、在设置页写个人层：你所在的页面决定改的是哪个文件。
- 目录里也列出被隐藏的技能，方便在本页重新放行；隐藏技能消失的地方是 `/名称` 调用与模型目录。
- 空的允许清单存不下去：文件格式要求至少一个模式，因此两个面板都会禁用保存并说明原因；其他原因被拒时则原样显示宿主给的理由。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式:** 不发布伴随包。两个界面都通过 `skillFilter` Remote 命名空间读写，apply 与组件测试套件覆盖注册、销毁以及各界面自身的行为。

</details>
