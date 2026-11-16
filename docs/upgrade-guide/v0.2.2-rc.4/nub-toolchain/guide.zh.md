---
kind: upgrade-guide
description: 工作区工具链改为 nub；本检出不再运行 pnpm，workspaces 与构建授权移入 package.json，锁文件改名为 nub.lock。
---

# 工作区工具链改为 nub

[English](guide.md) | 中文

## 变更

本检出改用 [nub](https://nubjs.com)，不再是 pnpm。`nub install` 取代 `pnpm install`，`nub run <script>` 取代 `pnpm run <script>`，`nubx <bin>` 取代 `pnpm exec <bin>`。nub 在 `package.json#devEngines.packageManager` 中声明自己；pnpm 在本检出直接拒绝运行，报 `ERR_PNPM_OTHER_PM_EXPECTED`。

三个文件移动或消失：

- `pnpm-workspace.yaml` 已删除，`workspaces`、`overrides`、`patchedDependencies` 与 `allowScripts` 移入根 `package.json`。各包的清单未变。
- `pnpm-lock.yaml` 改名为 `nub.lock`，内容仍是 pnpm v9 锁文件格式，差异可读。
- `.npmrc` 保留工作区的链接设置——`node-linker=hoisted`、`auto-install-peers=true`、`strict-dep-builds=false`——并新增 `minimum-release-age-exclude`，为在 nub 默认 24 小时最短发布期内发布的包放行。

安装脚本默认被拒绝执行。`package.json#allowScripts` 列出必须运行的脚本（`esbuild`、`lefthook`、`node-pty`）；需要脚本的新依赖会被 nub 报告，在你允许之前一直保持阻断。

已发布 SDK 的使用方不受影响；有两处载体仍刻意为 pnpm 保留位置：`apps/desktop` 内嵌 pnpm，Python SDK 与 SSH helper 的可执行文件通道用 `pnpm deploy` 组装生产闭包，nub 没有对应能力。

## 迁移

1. 安装 nub：`curl -fsSL https://nubjs.com/install.sh | bash`，然后在检出里运行 `nub install`。CI 里原先的 `pnpm install --frozen-lockfile` 改为 `nub ci`。
2. 改写本地命令：`nub run build`、`nub run test`、`nubx vitest run <path>`、`nub run -F <package> <script>`。翻译复合 pnpm 调用前，先看 `nub --help` 里的 `--cwd`、`-F`、`-P`。
3. 把本地保留的仓库级设置移入 `package.json`（`workspaces`、`overrides`、`patchedDependencies`、`allowScripts`），包管理器开关留在 `.npmrc`。不要恢复 `pnpm-workspace.yaml`。
4. 确认：`nub ci` 成功，`nub run build:check` 无错误，`nub --version` 输出 0.11.1 或更高，且 `git status` 没有改写 `nub.lock`。

要回退，运行 `nub pm use pnpm`：它恢复本次迁移替换掉的 pnpm 声明；但请保留执行它的分支，两套布局不适合互相合并。
