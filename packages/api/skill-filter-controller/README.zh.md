---
description: "技能过滤配置面的 Remote 属主：读写个人与项目级 YAML 配置文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-skill-filter-controller

[English](README.md) | 中文

## 概述

`skillFilter` 命名空间的宿主 Remote 属主。它用 provider 插件读取规则时使用的同一批函数读写个人与项目级技能过滤 YAML 文件，并在每次持久化写后发布通知，使 provider 的目录失效。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## 使用本包

出厂 Web 组合把本包挂在 settings 控制器旁边。客户端通过装配好的 `ctx.remote.skillFilter` 命名空间访问它。

### 何时选择它

当某个界面必须读取或持久化技能过滤规则时选择本包。当问题是「规则如何过滤目录」时选择插件包。

### Remote 面

| Method | Request | Result |
| --- | --- | --- |
| `getPersonal` | — | The personal layer, with `exists`, a parse `error`, and its `config` |
| `setPersonal` | The complete replacement config | The persisted config as re-read from disk |
| `getProject` | `{ cwd }` | The project layer for that working directory |
| `setProject` | `{ cwd, config }` | The persisted project config |
| `getEffective` | `{ cwd }` | Which layers exist and the merged config |

每次写的 `allow` 必填且必须是非空字符串数组；`deny` 可选。被拒绝的写返回 Remote 失败码 `skill-filter/rejected` 并带上原因，且不落盘。

### 最小组合

```yaml
- id: skill-filter-controller
  name: '@deepseek-ai/dsh-api-skill-filter-controller'
```

客户端装配挂载生成的命名空间贡献；不装技能过滤插件的宿主组合同样能读写配置，因为文件就是全部状态。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

### 写前校验

`setPersonal` 与 `setProject` 在打开任何文件之前，先按文件格式校验线上配置。该校验与插件包里的 `readConfigFile` 一致，因此 provider 会拒绝的值永远到不了磁盘。

### 写后发布

属主持有一个监听器集合。每次成功写都会通知它，插件包通过共享服务存储订阅——provider 跑在 preset fiber 里，而属主在宿主面，上下文事件无法跨越这条边界。监听器失败被容纳并记日志，绝不抛给调用方。

</details>

-----

<a id="further-exploration"></a>

## 延伸阅读

- [技能过滤插件](../../skill/skill-filter/README.zh.md) — 应用规则的 provider。
- [技能过滤界面](../../client/ui-skill-filter/README.zh.md) — 设置页与右侧栏标签页。
- [Typert 协议](../../typert/protocol/README.zh.md) — Remote 属主、方法与失败码。

-----

<a id="model-experience"></a>

## 模型体验

无。本包只读取、校验并持久化配置文件，不注册任何工具、提示段或会话事件；被存规则产生的过滤行为归 `dsh-skill-filter`。

#### KV Cache 影响

无；一次写本身不改变任何请求前缀，由此产生的替换目录由 provider 的目录失效负责。


## Known Limitations and Deferred Work

无。
- 该命名空间不提供单技能判定视图：需要解释「某个技能为何被隐藏」的界面要分别读合并配置与会话目录。

- 写操作不跨层事务化。替换个人配置绝不会动项目配置，调用方想同时改两份就发两次调用。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式:** 不发布伴随包。配置文件是唯一权威状态，命名空间测试套件覆盖属主暴露的每次读取、写入与拒绝。

</details>
