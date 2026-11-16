# 智能体笔记：工作区工具链改用 nub

状态：已实现

[English](2026-11-16-nub-toolchain.md) | 中文

## 问题

本仓库此前基于 pnpm：`packageManager` 固定它，`pnpm-workspace.yaml` 声明成员、覆盖项与构建脚本白名单，每个脚本、门禁与 workflow 都调用 `pnpm`。pnpm 是基于 JavaScript 的包管理器，每条命令都要付出 Node 启动成本，而且它不能直接运行 TypeScript 文件，因此有 120 处脚本调用要在前面加 `tsx`。

## 决定

`nub pm use nub` 一次性迁移整个配置面：`package.json` 增加 `devEngines.packageManager`，以及工作区成员、`overrides`、`patchedDependencies` 与 `allowScripts`；`pnpm-workspace.yaml` 消失；`pnpm-lock.yaml` 改名为 `nub.lock` 且字节不变，因为 nub 写的是 pnpm v9 锁文件格式。脚本改用 `nub run`，用 `nub <file>` 取代 `tsx`，二进制用 `nubx`。

两项设置是关键。必须用 `node-linker=hoisted`：vendored loader 以同级目录方式解析 `node-addon-require-builtin` 及其平台包，nub 的 isolated 与 global-virtual-store 两种布局都不提供，而缺少由此得到的 `loader.internal` 时 HMR 拒绝启动。`strict-dep-builds=false` 保持原有"默认拒绝"策略：`allowScripts` 仍然决定哪些依赖可运行安装脚本，但未批准的脚本只告警，不再让安装失败。

所有旧名字的消费方都已跟进：读取工作区声明与锁文件的门禁（`check-workspace-constraints`、`gen-third-party-notices`、`local-bundle-registry`、`release/bump`、`cua-helper/build-inputs`、Python SDK exe 构建）、它们的夹具、两种语言的 `README`，以及 `AGENTS.md`——其 Toolchain 一节现在记录构建脚本白名单为何存在。

## 考虑过的其他方案

- **继续声明 pnpm，仅以兼容模式使用 nub。** 否决：nub 每次安装都会把 `pnpm-lock.yaml` 重写成另一种形态，工作树始终脏，而且没有东西声明仓库实际运行的工具链。
- **保留 isolated 布局，把三个可选的 vendor peer 提升到根 `devDependencies`。** 否决：hoisted 布局无需新增依赖就让原生绑定可解析。
- **在同一改动里迁移 CI workflow。** 暂缓：`pnpm` 在声明了其他包管理器的项目里拒绝运行（`ERR_PNPM_OTHER_PM_EXPECTED`），因此使用 `pnpm/action-setup` 与 `pnpm install --frozen-lockfile` 的 24 个 workflow 必须在本分支推送前改到 `nubjs/setup-nub` 与 `nub ci`；该重写无法在 GitHub 之外验证。

## 后果

- `pnpm` 在此检出中不再可用；`nub pm use pnpm` 可整体回退。
- 锁文件改名，仓库外任何硬编码 `pnpm-lock.yaml` 的地方需同步。
- 上游合并现在会在 `package.json`、`nub.lock` 与 CI workflow 上冲突——这是仓库不再随上游包管理器发布的代价。
- `nub` 处于 0.x，其解析器对该依赖图强制重解析会失败（两个被打补丁的包报 `ERR_NUB_UNUSED_PATCH`），所以 `nub install --force` 目前不是恢复手段。
