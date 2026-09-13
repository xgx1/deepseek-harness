# Agent Note: developer worktree 双实例自举开发（不打断生产）

Status: implemented
Archived: 2026-09-13

[English](2026-09-08-developer-worktree-non-disruptive-self-development.md) | 中文

## 问题

本机跑着一个承载实时 Agent 工作的生产 `dsh web` 实例，而 DSH 本体又在持续开发。全局 `dsh` 软链指向主 checkout 构建出的 `apps/cli/lib/bin.js`，主工作区里的源码改动或重建会无声地变成生产进程下次重启后执行的代码；任何第二个实例若共用 `~/.dsh`，还会互相争抢会话与锁。开发需要一条碰不到生产进程及其状态的车道。

## 决策

本机所有 DSH 自举开发都在独立 git worktree（`developer`，`dev` 分支）进行；主工作区（`master`）专供生产，只通过合并变更。第二个 `dsh web` 实例跑 dev worktree 自己的产物，独占端口、隔离 `DSH_HOME`，并通过 `~/.dsh/dsh-env.sh` 复用生产 API key。

浏览器侧改动免重启迭代：`pnpm dev:web`（[scripts/dev-web.ts](../../../../scripts/dev-web.ts)）监听源码并重建 client bundles 与 `apps/web/dist`，dev 服务端 stat-poll 这些产物并向浏览器广播 `rebuilt`。host 侧改动只需重启 dev 实例；tsx 源码启动（`node --import tsx/esm apps/cli/src/bin.ts web`）免去重建直接吃 host 源码。

已验证的 dev 改动上线 = 主工作区 `git merge dev` → 重建主工作区（旧进程仍在内存中服务，安全）→ 重启 `dsh-web.service`——唯一打断生产的步骤。watcher 绝不能与同树的 `pnpm run build` 并发：两者写同一批 `lib/` 与 `apps/web/dist`。

## 备选方案

- **dev 实例只用构建产物跑。** 贴合生产行为，但每次客户端改动都要重建加重启。不作为日常循环；watcher 启动前的一次 bootstrap `pnpm run build` 仍是前提。
- **两个实例共享状态目录。** 否决：跨进程争抢会话、锁与缓存。
- **一律源码启动。** 否决为默认：tsx 每次启动都付转译成本，浏览器 bundle 仍需 watcher；保留为 host 侧迭代手段。

## 后果

- 本机特有实况（路径、端口、`dsh-web.service`）在根 `AGENTS.md` 标注 "this host only"；术语在根 `CONTEXT.md` 词汇表。
- 操作规程在项目技能 `dsh-dev-loop`、`dsh-merge-deploy-master`、`dsh-master-hotfix-sync`（`.agents/skills/`）。
- 健康状态的验证标准：双端口都返回 200，watcher 报出其监听包集，生产重启在数秒内完成且 dev 实例不受影响。
