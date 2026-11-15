# Agent Note: 与 JSONL 并行的轻量 Turso 会话持久化后端

Status: implemented

[English](2026-11-15-turso-session-persistence.md) | 中文

## 问题

已发布产品把每个会话保存为压缩的 JSONL 日志，而 2026-08-30 为了让权威物理格式只有一个而移除了 SQLite 后端（[`2026-08-30`](../simplification/2026-08-30-jsonl-only-session-persistence.zh.md)）。因此希望把会话数据放进自己已在备份与查询的数据库的部署，没有任何受支持的存储；而已移除的那个后端也无法直接拿回来：句柄接缝在那之后被替换（−2266/+554 行），被移除的包面向的是一个已不存在的接口，其打包行加 zstd 的布局又与「未压缩、可独立读取的行」这一要求相冲突。

## 决定

`@deepseek-ai/dsh-session-persistence-turso` 在一个 Turso 数据库之上实现 `ctx.sessionPersistence`，每个已存储事件一行、写为纯 JSON 文本，不带打包或压缩层。Turso 仍然兼容 SQLite 文件格式，但提供的是异步驱动，因此本后端自己串行化写入，并等待每个事务完成。`SessionPersistence` 保持与后端无关，因此该后端与 JSONL 后端通过同一套 `runPersistenceContract` 套件，并且与它并存而不是取而代之：基础 bundle 仍保留 `session-persistence-jsonl`，由部署在自己的 profile patch 中选择本后端。

## 考虑过的替代方案

- **从历史中恢复被移除的后端。** 否决：1843 行源码面向 `PersistenceBackend`/`prepare()`/`BorrowedSessionSource`，这些接缝已不存在，外加一个其字节属于某种当前无人存储的物理格式的 zstd 字典。移植的代价大于面向今天接缝的全新实现。
- **让它成为唯一一方后端并删除 JSONL。** 否决（暂时）：59 个录制会话期望与格式迁移链都读 JSONL 产物，切换默认值会改写整套测试语料，此后每次上游的会话变更都会与本分支不一致。
- **在后端内保留只读 JSONL 导入器。** 否决：格式解码与迁移由 JSONL 包负责，通过它导入会把两个后端耦合起来；仍在使用的部署可以用仍选择 JSONL 的构建导出。

## 后果

两个一方后端现在都要满足同一个共享句柄约定，而本后端不做压缩，因此它的数据库比等价的压缩日志更大、增长也更快。写所有权只在后端实例内跟踪，因此「一个数据库文件只有一个宿主」是运维要求而非强制约束。JSONL 存储的会话无法被本后端读取：切换是靠导出完成的一次性单向迁移，不是迁移路径。
