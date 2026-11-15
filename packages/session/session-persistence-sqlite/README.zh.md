---
description: "为选择、配置或排查单数据库 Session 存储的宿主与维护者准备的 SQLite Session 持久化后端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

[English](README.md) | 中文

## 概述

`dsh-session-persistence-sqlite` 在一个 SQLite 数据库之上实现 `ctx.sessionPersistence`：每个已存储的 Session 对应 `sessions` 表中的一行（保存其 header），每个已存储的事件对应 `events` 表中的一行（保存该事件的 JSON 文本）。它既不压缩也不打包，因此任何 SQLite 客户端都能读到原始行。部署希望用单个可查询数据库取代按 Session 分文件时选它；希望运维以纯文本文件查看 Session 日志时选 `dsh-session-persistence-jsonl`。本后端不贡献提示词、工具或 schema。

## 目录

- [使用本包](#use-this-package)
  - [何时选用](#when-to-choose-it)
  - [配置](#configuration)
  - [可观察行为](#observable-behavior)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

## 使用本包

<a id="use-this-package"></a>

把它挂载为 `ctx.sessionPersistence` 的提供者；注入 Session 持久化服务的消费方无需改动，因为句柄约定与具体后端无关。

<a id="when-to-choose-it"></a>
### 何时选用

Session 数据应落在一个运维已在备份与查询的数据库里时选它。同步的 `node:sqlite` 驱动会在每次 append 时阻塞 JavaScript 线程（包括发布一批事件的事务），高写入频率时要把这一点计入预算。存储的行不压缩，因此数据库比等价的压缩日志更大。

<a id="configuration"></a>
### 配置

只有两个字段：数据库路径与日志模式。

```yaml
- id: session-persistence-sqlite
  name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /var/lib/dsh/sessions.db
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | SQLite 数据库文件路径，或 `:memory:` |
| `journalMode` | `wal` | 日志模式：`wal`、`delete`、`truncate` 或 `persist` |

`wal` 适合本地磁盘；回滚日志模式适合 WAL 的共享内存文件无法工作的文件系统，例如网络挂载。

<a id="observable-behavior"></a>
### 可观察行为

缺失的目录与数据库文件以仅属主可访问的权限创建（`0o700`/`0o600`）；已存在的数据库保留其权限。物理布局版本与当前版本不同的数据库会拒绝挂载。已创建的 Session 在首次 append 或 flush 之前只存在于进程内，因此从未写入过任何内容的 Session 在崩溃后并不存在。已解析的 `append` 即已持久；`flush` 只发布仍为空的已创建 Session。读取与写打开对本构建不认识的事件词汇 fail-closed，并在错误信息中指名被拒绝的事件类型。

-----

## 实现说明

<a id="understand-the-implementation"></a>

<details>
<summary>实现细节 —— 点击展开</summary>

后端是一个 `node:sqlite` 连接与两张 STRICT 表；句柄约定由 `@deepseek-ai/dsh-session-persistence` 定义。

### 设计要点

- **每个 Session 一行 header。** `sessions (id, header, inherited_event_count, revision)` 保存无损快照后的 header、fork 继承前缀长度，以及每次 append 都递增的计数器。
- **每个事件一行。** `events (session_id, seq, event)` 保存事件自身的 JSON 文本，因此一次读取就是一条有序 `SELECT`，没有解码层。
- **每批一个事务。** append 在同一个 `BEGIN IMMEDIATE` 中按需落 header 行、插入本批事件并推进 revision，因此被拒绝的批次不会留下任何行。
- **进程内可见性。** `create` 只在内存中记录 header；未 append 的 `close` 会丢弃它，所以已创建的 Session 对本实例可见、对另一个进程不可见，直到它写入为止。

### 打开顺序

打开时以 `0o700` 创建父目录、以 `0o600` 独占创建缺失的文件、应用 `PRAGMA foreign_keys = ON` 与日志模式、检查 `user_version`、创建两张表，最后才给全新数据库打版本戳，使中途失败留下未打戳的介质。

### 源码导览

- `src/index.ts` —— 服务、open/create/flush/stat/list、append 事务、句柄。
- `src/schema.ts` —— 打开顺序、布局版本、表结构。
- `tests/sqlite.spec.ts` —— 共享的 `runPersistenceContract` 套件加物理布局用例。

</details>

-----

## 延伸阅读

<a id="further-exploration"></a>

- [Session 持久化契约](../session-persistence/README.zh.md) —— 每个后端都要满足的句柄约定。
- [JSONL 后端](../session-persistence-jsonl/README.zh.md) —— 按 Session 分文件的替代方案。
- [仓库架构](../../../docs/architecture.zh.md) —— 持久 Session 状态在运行时中的位置。

-----

<a id="model-experience"></a>
## 模型体验

### 已存储的 Session 日志

#### 模型看到什么

SQLite 存储注册 `ctx.sessionPersistence`，不向实时请求提供提示词、工具 schema 或结果。它存储 agent 循环已经产生的事件，并通过 `SessionHandle.read` 把它们交还给恢复后的 loop，因此模型看到的正是该 Session 记录的历史，本后端不做重排、合并或插入任何文本。

#### Token 影响

实时请求不新增 token。恢复后的 agent 只因它本已拥有的历史付费，因为本后端既不增加上下文行，也不花 token 重写它。

#### KV Cache 影响

对实时请求前缀无影响。恢复后的 loop 在还原历史与当前 envelope 与先前一致时可复用 provider 缓存，而本后端不改变其中任何一项。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **单写者所有权只在进程内。** 后端按实例跟踪写所有权；两个进程对同一数据库做写打开不会被拒绝。一个数据库文件只由一个宿主使用。
- **不能导入 JSONL。** `dsh-session-persistence-jsonl` 存储的 Session 不会被读取；切换前请用仍带该后端的构建导出。
- **没有按 Session 的产物位置。** 快照只报告 `eventCount`，因此诊断无法指向单个 Session 文件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

无。

</details>
