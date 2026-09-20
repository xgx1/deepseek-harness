---
description: "DeepSeek Harness 的技能可见性白名单过滤器：个人与项目级 YAML 规则决定模型目录列出哪些技能。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-filter

[English](README.md) | 中文

## 概述

用个人与项目级 allow/deny 通配规则过滤技能目录。被拒绝的技能仍然注册、仍可用 `/名称` 调用，但不再出现在模型目录里，从而把每次请求携带的目录压缩到当前项目真正需要的技能。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## 使用本包

出厂组合已把本包挂为 preset 插件。它自身没有配置项：规则写在两个 YAML 文件里，由 Owner Remote 读写。

### 何时选择它

当某个项目的 agent 只应看到已安装技能的一个子集时选择本包。要回答「技能从哪里发现」用 `dsh-skill-filesystem`，要回答「目录如何进入请求」用 `dsh-tool-skill`。

### 配置文件

个人配置位于 `$DSH_HOME/skill-filter.yaml`，对所有项目生效。项目配置位于 `<cwd>/.dsh/skill-filter.yaml`，一旦存在，对该工作目录整体替换个人规则。两个文件形状相同：

```yaml
allow:
  - "git-*"
  - "cbm-graph-first"
deny:
  - "git-rebase"
```

`allow` 必填；缺少 `allow` 的配置是解析错误。`deny` 可选。不含通配元字符的模式是具体技能名，同一文件内具体名优先于通配。被任一文件拒绝的技能仍可被用户调用：只是清掉了它的模型可见标记。

### 最小组合

```yaml
- id: skill-filter
  name: '@deepseek-ai/dsh-skill-filter'
```

挂载它的 preset 必须同时禁用默认的 filesystem provider，让发现只经过本包。`providerName` 覆盖注册的 provider 名，`customSkillDirs` 追加技能根目录，`watch` 保持对宿主本地技能目录的监听。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

### Provider 包装

`FilteredSkillProvider` 包装一个内部 `FileSystemSkillProvider`。内层返回的每个候选都会被打上本插件的 provider 名，因为注册表日后通过该名字解析候选的加载。`get()` 原样委托给内层。

### 规则合并

`filter.ts` 把每个配置层编译成 allow/deny 匹配器，并在三个来源间判定一个技能名：项目配置、个人配置、技能自身 frontmatter 的拒绝声明。项目规则压过个人规则，个人规则压过 frontmatter，同一文件内具体名压过通配，平局判拒绝。没有任何规则允许的名字一律拒绝，因为模型侧是默认拒绝。

### 目录失效

规则在每次目录收集时重读，但注册表会缓存已完成的收集。Owner Remote 在每次持久化写后发布通知，本插件订阅该通知以使自己的注册失效，下一次读取便应用新规则。

</details>

-----

<a id="further-exploration"></a>

## 延伸阅读

- [技能注册表](../skill/README.zh.md) — provider 注册、分层与目录缓存。
- [技能过滤控制器](../../api/skill-filter-controller/README.zh.md) — 读写配置文件的 Remote 属主。
- [ADR-0001](../../../docs/adr/0001-whitelist-skill-filter.zh.md) — 为什么模型侧默认拒绝。
- [ADR-0002](../../../docs/adr/0002-merge-frontmatter-into-filter.zh.md) — frontmatter 拒绝作为最弱规则。

-----

<a id="model-experience"></a>

## 模型体验

### 过滤后的目录

#### 模型看到什么

过滤后的目录：名字匹配某条允许规则的技能，减去被拒绝规则或技能自身 frontmatter 移除的部分。没有命中任何允许规则的技能不在其中。

#### Token 影响

目录收缩到允许集合。一个拒绝了半数已安装技能的工作区，会在每个携带目录的请求里省掉大致相应比例的目录字节。

#### KV Cache 影响

一次配置写会使该 provider 的目录失效，下一个请求追加一份替换目录。除此之外没有请求前缀变化。


## Known Limitations and Deferred Work

无。
- 两个文件都只有一对 allow/deny。按工具、按目录或带条件的规则需要本包未定义的 schema。
- 项目配置是整体替换个人规则，而不是逐条叠加，所以项目想多放行一个技能时必须重写个人清单。

- 个人配置解析失败时回落到上一份有效副本（缓存在配置文件旁）；项目配置没有缓存，读取时按缺失处理。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式:** 不发布伴随包。技能注册表拥有本包贡献的 provider 关系，组合与过滤测试套件直接覆盖被包装 provider 的目录与失效。

</details>
