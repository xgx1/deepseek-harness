# Agent Note：不采用 Ende 运行时

Status: rejected — 否决 Ende 运行时替换；改为落地 TypeScript 收紧、TOML 组合文件与 Turso 会话存储

[English](2026-11-15-full-ende-runtime-swap.md) | 中文

## 问题

「把整个代码库迁移到 ende 环境」这项要求，是要 DSH 跑在 [Ende](https://github.com/theende/ende) 上——Deno 的一个 fork（「面向 TypeScript 的现代运行时」，V8 + Rust + Tokio，用 `curl ende.sh/install.sh` 安装，以 `ende run --allow-net` 启动），`Deno` 全局保持永久别名，`ende.json`/`ende.lock`/`ENDE_*` 取代 `deno.json`/`deno.lock`/`DENO_*`（缺失时给弃用警告）。它的 README 直接写明限制：与 Deno 不同，它**不支持 npm 包、不支持 `node:*` 内建、不支持 CommonJS**。

## 提案

让 DSH 的每个进程——CLI、Web 服务、桌面外壳、插件、测试——都跑在 Ende 上，TypeScript 源码保持不变，由运行时承担模块加载与标准库。

## 决定

DSH 不采用 Ende 作为运行时。该要求由与之兼容的三部分满足——TypeScript 收紧为仅可擦除语法、配置迁移到 TOML、会话批量数据迁移到 Turso 数据库——运行时替换则以「已否决」记录在此。

## 备选方案

- **替换运行时并移植整个依赖图。** 否决的依据是测量而非口味：58 个不同的 `node:*` 说明符共 8540 处引用（`node:fs`、`node:path`、`node:child_process`、`node:sqlite`、`node:zlib` 等），跨 21818 个受跟踪文件、427 个 `package.json`、7474 个 TypeScript 文件（约 119k 行），外加一个 Electron 桌面应用与 React + Playwright 的 Web 应用。Ende 在设计上拒绝 npm 包与 `node:*`，所以移植等于替换 Node 本身，而不是让 DSH 适配 Ende。
- **只让 CLI 跑在 Ende 上。** 否决：CLI 加载的是同一张插件图，而 `node:*` 引用正落在图里，这个分界线并不存在。
- **保留一个「Ende 兼容」入口，实际仍跑 Node。** 否决：那只是改名而不改运行时，却宣称完成了一次没有发生的迁移。

## 后果

- 起决定作用的代价是可合并性：DSH 面向一个发布 Node 运行时的上游仓库维护，替换运行时会把此后每一次上游合并变成移植。无法合并的迁移不算这个代码库的迁移。
- 产品里没有任何叫 Ende 的东西。在这位用户的环境里，该字符串只作为技能预设名留在 `~/.dsh/agent-configs.yaml`，它只选择技能包，与运行时无关。
- 兼容的部分已落地：`tsconfig.base.json` 的 `erasableSyntaxOnly` 及参数属性改写（[TOML 记录](../../implemented/architecture/2026-11-16-toml-compositions.zh.md)）、TOML 组合文件、以及 Turso 会话存储（[2026-11-15](../../implemented/architecture/2026-11-15-turso-session-persistence.zh.md)）。
- 如果 Ende 某天补上 npm 与 `node:*` 兼容，这份记录即失效；在那之前，重跑上面的测量是重新开启讨论的便宜办法。
