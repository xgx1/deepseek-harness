# 智能体笔记：工作区工具链改用 nub

状态：已实现

[English](2026-11-16-nub-toolchain.md) | 中文

## 问题

本仓库此前基于 pnpm：`packageManager` 固定它，`pnpm-workspace.yaml` 声明成员、覆盖项与构建脚本白名单，每个脚本、门禁与 workflow 都调用 `pnpm`。pnpm 是基于 JavaScript 的包管理器，每条命令都要付出 Node 启动成本，而且它不能直接运行 TypeScript 文件，因此有 120 处脚本调用要在前面加 `tsx`。

## 决定

`nub pm use nub` 一次性迁移整个配置面：`package.json` 增加 `devEngines.packageManager`，以及工作区成员、`overrides`、`patchedDependencies` 与 `allowScripts`；`pnpm-workspace.yaml` 消失；`pnpm-lock.yaml` 改名为 `nub.lock` 且字节不变，因为 nub 写的是 pnpm v9 锁文件格式。脚本改用 `nub run`，用 `nub <file>` 取代 `tsx`，二进制用 `nubx`。

两项设置是关键。必须用 `node-linker=hoisted`：vendored loader 以同级目录方式解析 `node-addon-require-builtin` 及其平台包，nub 的 isolated 与 global-virtual-store 两种布局都不提供，而缺少由此得到的 `loader.internal` 时 HMR 拒绝启动。`strict-dep-builds=false` 保持原有"默认拒绝"策略：`allowScripts` 仍然决定哪些依赖可运行安装脚本，但未批准的脚本只告警，不再让安装失败。

所有旧名字的消费方都已跟进：读取工作区声明与锁文件的门禁（`check-workspace-constraints`、`gen-third-party-notices`、`local-bundle-registry`、`release/bump`、`cua-helper/build-inputs`、Python SDK exe 构建）、它们的夹具、两种语言的 `README`，以及 `AGENTS.md`——其 Toolchain 一节现在记录构建脚本白名单为何存在。

CI 也跑在 nub 上。原先使用 `pnpm/action-setup` 的 24 个 workflow 改用 `nubjs/setup-nub@v0` 并以 `nub ci` 安装；以锁文件为键的 store 路径步骤与 `actions/cache` 步骤全部删除，因此每条流水线不再缓存包管理器；ReFS 上传递 `--package-import-method=clone` 的 Windows 分支随 pnpm 一起退役。`scripts/ci-workflow.spec.ts` 与 `scripts/preview-workflow.spec.ts` 同步更新，并新增一条守卫测试：任何 workflow 都不得提到 pnpm，且每个运行 nub 的 job 必须先安装 nub。

构建与门禁脚本改为解析它们继承到的启动器，而不再查找 pnpm 的 JavaScript 入口：`scripts/release/process.ts` 的 `nubCommand()` 与 `scripts/pm-invocation.ts` 的 `pmInvocation()` 依次取 `npm_execpath`、`NUB_BIN`、`PATH` 上的 nub；发布打包在成员目录内逐个执行 `nub pack`，因为 nub 没有递归 pack。

可执行文件的载体是例外。`nub` 没有 `pnpm deploy` 的对应能力，因此 Python SDK 与 SSH helper 两条通道用固定版本的 pnpm 暂存生产闭包，该 pnpm 从包中解析而非取自 `PATH`（`scripts/executable-packaging.ts` 的 `pnpmCommand()`）；`pnpm` 作为根 `devDependency` 正是为了这一处调用。nub 也不允许声明了却未使用的补丁：`^1.3.0` 与 `^2.0.1` 两个范围已开始解析到被打补丁的版本之外，因此 `overrides` 固定 `@earendil-works/pi-ai@1.3.0` 与 `mdast-util-gfm-autolink-literal@2.0.1`，让两个补丁都保持生效。

nub 的转译器不接受 TypeScript 的 Stage 3 装饰器（oxc 的已知限制，oxc-project/oxc#9170），因此 `nub <file>` 无法加载声明了装饰器的模块。工具目录与 v3 事件词表会导入带装饰器的包，仍走 `nubx tsx`——`tsx` 因此与 CLI 的 tsx 源码启动一起保留为依赖；其余脚本直接在 nub 上跑。pre-push 钩子执行 `nub run typecheck`，所以推送时 `PATH` 里要有 nub。

## 考虑过的其他方案

- **继续声明 pnpm，仅以兼容模式使用 nub。** 否决：nub 每次安装都会把 `pnpm-lock.yaml` 重写成另一种形态，工作树始终脏，而且没有东西声明仓库实际运行的工具链。
- **保留 isolated 布局，把三个可选的 vendor peer 提升到根 `devDependencies`。** 否决：hoisted 布局无需新增依赖就让原生绑定可解析。

## 后果

- 文档在同一改动里跟进：402 个 Markdown 文件的命令行被改写（`pnpm install` 变 `nub install`，`pnpm run` 变 `nub run`，`pnpm exec tsx` 变 `nub`，`pnpm --filter <pkg> run <script>` 变 `nub run -F <pkg> <script>`，`pnpm-lock.yaml` 变 `nub.lock`），现行散文也一并迁移：贡献者上手、插件发布指引与各包 README 都改述 nub 的规则。[`docs/upgrade-guide/v0.2.2-rc.4/nub-toolchain/guide.zh.md`](../../../../docs/upgrade-guide/v0.2.2-rc.4/nub-toolchain/guide.zh.md) 给出面向用户的迁移步骤；已归档的 Agent Note 按政策保持冻结。一段常驻规则进入根 `AGENTS.md`，其字数上限因此从 2,080 提到 2,140，而不是删掉这个文件本该承载的规则。
- 可执行包装通道是 pnpm 仍在运行的唯一之处；去掉这处调用需要一套为生产闭包设计的 nub 原生暂存方案。
- `pnpm` 在此检出中不再可用；`nub pm use pnpm` 可整体回退。
- 锁文件改名，仓库外任何硬编码 `pnpm-lock.yaml` 的地方需同步。
- 上游合并现在会在 `package.json`、`nub.lock` 与 CI workflow 上冲突——这是仓库不再随上游包管理器发布的代价。
- `nub` 处于 0.x：`nub install --force` 会重解析整张依赖图、升级所有范围并改写锁文件，所以它不是陈旧安装的恢复手段。
