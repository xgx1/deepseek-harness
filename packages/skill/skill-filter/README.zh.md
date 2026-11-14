---
description: "DeepSeek Harness 的技能可见性白名单过滤器：个人与项目级 YAML 规则决定模型目录列出哪些技能。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-filter

[English](README.md) | 中文

## 概述

用个人与项目级 allow 通配规则过滤技能目录：只保留任一层命中的技能。未被允许的技能两个调用标记都会被清掉——不再出现在模型目录里，也不能用 `/名称` 调用，更不会被注入上下文——从而把每次请求携带的目录压缩到当前项目真正需要的技能。

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

个人配置位于 `$DSH_HOME/skill-filter.yaml`，对所有项目生效。项目配置位于 `<cwd>/.dsh/skill-filter.yaml`，在该工作目录上累加个人规则：两层取并集，任一层允许的技能即可见。两个文件形状相同：

```yaml
allow:
  - "git-*"
  - "cbm-graph-first"
```

`allow` 必填；缺少 `allow` 的配置是解析错误。这份清单就是全部规则：没有命中的技能在两个界面上都不可见。写 `deny` 键同样是解析错误，过滤器已经没有这一项。不含通配元字符的模式只匹配同名技能。通配元字符（`*`、`?`、`[...]`）按通配匹配，因此 `unreal*` 覆盖所有 `unreal-` 技能。

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

`filter.ts` 把每个配置层编译成 allow 匹配器，并在三个来源间判定一个技能名：项目配置、个人配置、技能自身 frontmatter 的拒绝声明。两个配置层取并集——任一层允许即可见——没有任何规则允许的名字一律隐藏，因为模型侧是默认拒绝。frontmatter 拒绝是最弱来源：任一层配置允许即可覆盖它。

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

过滤后的目录：名字匹配任一层允许规则的技能，减去技能自身 frontmatter 移除的部分。没有命中任何允许规则的技能仍然注册，但不在目录里，`/名称` 与指令注入都到不了它。

#### Token 影响

目录收缩到允许集合。一个只允许半数已安装技能的工作区，会在每个携带目录的请求里省掉另一半大致相应比例的目录字节。

#### KV Cache 影响

一次配置写会使该 provider 的目录失效，下一个请求追加一份替换目录。除此之外没有请求前缀变化。


## Known Limitations and Deferred Work

无。
- 两个文件都只有一份 allow 清单。按工具、按目录或带条件的规则需要本包未定义的 schema。
- 两层取并集，因此项目无法隐藏个人配置允许的技能；该技能要从个人清单里去掉。

- 个人配置解析失败时回落到上一份有效副本（缓存在配置文件旁）；项目配置没有缓存，读取时按缺失处理。
- 只过滤本包自己那层发现：插件另行挂载的 skill provider（例如 OpenViking 记忆插件自带的 `openviking` provider）不走白名单，其中的技能始终可见。要让它们也受控，得把判定从 provider 包装挪到注册表合并处。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式:** 不发布伴随包。技能注册表拥有本包贡献的 provider 关系，组合与过滤测试套件直接覆盖被包装 provider 的目录与失效。

</details>
