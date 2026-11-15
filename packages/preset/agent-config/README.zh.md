---
description: "具名 agent 配置：一份文档决定每个项目的会话能用到哪些技能与 MCP 服务器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-config

[English](README.md) | 中文

## 概述

在 `$DSH_HOME/agent-configs.yaml` 里给配置起名，并记录每个项目选中哪几份。技能过滤器把选中配置的 glob 并进项目的允许列表，本服务则把选中集合之外的 MCP 服务器工具逐条屏蔽，因此一个会话只看得到它所在项目配置里点名的技能与 MCP 工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## 使用本包

### 文档格式

```yaml
configs:
  general:
    skills: ["git-*", "cbm-graph-first"]
    mcp: [cbm]
  unreal:
    skills: ["unreal-*", "ue*"]
    mcp: [unity, ue]
projects:
  /home/me/game: [general, unreal]
```

`configs` 把名字映射到定义：`skills` 是技能过滤器求值的允许 glob，`mcp` 是 MCP 的 `serverName`。`projects` 把绝对工作目录映射到它选中的配置名；不在该映射里的项目一份配置都没选，因此不允许任何 MCP server，技能过滤器也不加配置层、只按自己的 YAML 层判定。一份配置都没选的项目按空规则执行。

顶层出现未知键、选择不是字符串数组、定义不是映射，都会报解析错误并指出出错位置。

### 生效方式

- 技能：技能过滤器读取 `skillGlobs(cwd)`，把并集编译进项目的规则层，从而让选中的 glob 与项目层一样生效。
- MCP：在 agent 每一步之前，本服务屏蔽服务器不在选中集合里的 `mcp__<服务器>__*` 工具；晚注册的服务器在下一次 `tools/change` 时被补上。

### 最小组成

```yaml
- id: agent-configs
  name: '@deepseek-ai/dsh-agent-config'
```

本包没有插件配置项：文档路径固定为 `$DSH_HOME/agent-configs.yaml`。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

### 管辖按项目逐项开启

`selectionOf` 对未在文档里列出的工作目录返回 `undefined`，MCP 屏蔽把它当作空选择：一个 server 都不允许，所以未列出的检出看不到任何 MCP 工具。技能过滤器则不加配置层，技能可见性只由它的个人层与项目层 YAML 决定——要授予某个项目 MCP 工具，只能显式选配置。

### 只屏蔽，不断连

MCP 这一半与工具注册表相交，而非与 MCP 管理器相交：被选中的服务器保持连接，未选中的通过 `tools.restrict()` 装在 agent 作用域上的限制从工具视图里消失。每次 `tools/change` 都会先解除再重算，因此第一步时仍在连接的服务器不会漏出工具。

### 保留上次成功的解析

服务保留最近一次成功解析的文档，写坏文件只记一条警告，而不会静默解除全部限制；下一次成功读取会替换它。

</details>

-----

<a id="further-exploration"></a>

## 延伸阅读

- [技能过滤器](../../skill/skill-filter/README.zh.md) —— 消费所选 glob 的 provider。
- [工具注册表](../../core/tools/README.zh.md) —— 本包使用的 scoped restriction。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md) —— 屏蔽所匹配的 `mcp__<服务器>__` 工具名。

-----

<a id="model-experience"></a>

## 模型体验

### 受管辖的请求输入

#### 模型看到什么

`<available_skills>` 目录只列选中配置的 glob 允许的技能，工具 schema 只列选中服务器的 MCP 工具。两项输入的其他部分不变：留下来的技能或工具，名称、描述与顺序都保持原样。

#### Token 影响

两项输入都收缩到项目所选的范围。一个原本带着 300 条已安装技能目录、工具表里挂着全部已挂载 MCP 服务器的会话，之后每个请求只为配置好的子集付费。

#### KV Cache 影响

目录与工具块都属于请求前缀。改文档体现为下一个会话发布目录时的一次性前缀替换；运行中的会话保持它已发布的目录，因此其前缀保持稳定。

## Known Limitations and Deferred Work

- **未选中的 MCP 服务器仍然连接着。** 屏蔽只隐藏它们的工具，并不停止组成里挂载的客户端实例。引用计数的惰性挂载被推迟：连接是进程级共享的，而会话是并发的。
- **没有客户端界面。** 目前手改文档；预设 chip 旁的配置选择器被推迟。
- **选择按步骤解析，不按会话冻结。** 会话运行期间改文档，影响的是下一次目录读取与下一次工具刷新，而不是该会话已经发布的目录。

-----

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

测试只覆盖文档语法与解析规则（`tests/config.spec.ts`）；两处生效点由各自包的测试与出厂组成覆盖。MCP 屏蔽的真实组成测试是第一个待补的缺口，因为只有它能证明屏蔽落在请求之前。

</details>
