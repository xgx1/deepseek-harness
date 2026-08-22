# AGENTS.md — deepseek-harness-sx

本项目是 **DeepSeek Harness（DSH）的定制版本**，代号 `sx`。
以 `deepseek-ai/deepseek-harness` 为上游基线，做一系列优化配置，并对**掩码（含其引擎）**进行深度改动。

## 与上游的关系

- 上游：`deepseek-ai/deepseek-harness`（默认分支 `master`）。
- 本仓库：基于上游 fork 出的自有仓库，改动通过 PR 跟踪。
- **本文件的进程归属**：本目录的 `agents.md` 是我们自己的指令文件，
  用它对 DSH 自身的进程进行定制，避免与上游自带的 `AGENTS.md` 规范产生冲突。
  上游的工程规范完整保留在 `docs/AGENTS.md` 与 git 历史中，仅在需要回灌上游 PR 时遵循。

## 环境栈（三个运行时）

| 环境 | 版本 | 用途 |
|---|---|---|
| Node.js | v24.18.0（pnpm 11.18） | DSH 本体（TypeScript，pnpm workspace） |
| Python | 3.14.7 / 3.13.14（uv 0.12） | DSH Python SDK（`python/sdk`）、扩展与脚本 |
| .NET / C# | 9.0.317（scoop dotnet9-sdk） | 配套工具（如 unrealcli）与 .NET 侧开发 |

## 本版本目标改动

1. **优化配置**：对 DSH 的默认行为做系列优化（模型路由、会话、工具、沙箱等按需调整）。
2. **掩码深度改动**：深入更改掩码（mask）相关的实现，**包括其引擎**。
   具体改动范围按任务推进逐步落定，改动均放入 PR，一条 PR 一个主题。
3. 三环境协同：Node 跑 DSH 本体，Python 跑 SDK/扩展，.NET 跑配套工具。

## 工作约定

- 一个功能只做一个插件 / 一处改动，严禁多功能糅合。
- 动手前先搜本地与网上现成实现，尽量在既有代码上扩展，禁止从零重写。
- 改动须可逆、可回滚；注册类贡献通过 `ctx.effect()` / `ctx.on()` 等标准生命周期。
- 每次改动进入独立分支，通过 PR 提交，便于审查与回退。
- 完成后把经验固化到本项目 `agents.md`（本节即沉淀区）。
