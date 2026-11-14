# AGENTS.md

DeepSeek Harness 是一个全插件（all-plugin）的 Cordis agent harness。改 `packages/` 之前先读 [docs/architecture.md](docs/architecture.md)；写文档遵循 [docs/AGENTS.md](docs/AGENTS.md)。

## 预发布 API 与已发布的 Session 数据

公共 API 处于预发布阶段；每一处消费方都要同步更新。遵循[版本/状态](docs/session-format-status.md)与[类型确认](docs/cookbook/reviewing-persistence-type-changes.md)。[相邻迁移](.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md) 可以新增一个以版本命名的后继版本，但**绝不**移动、覆盖或删除已提交的代际；前任并不意味着回退或降级支持。SQLite 使用单调递增的 `SCHEMA_VERSION`。

[已声明的持久化类型变更](docs/cookbook/reviewing-persistence-type-changes.md)必须确认。

每一处外部可感知的破坏性变更，立刻记录进[升级指南](.agents/skills/dsh-create-upgrade-guide/SKILL.md)。

**应用启动。** 只有 `dsh` profile 能启动受支持的 Node 应用；包内 bin、demo 与公共 SDK 的 argv 逃逸一律禁止（[规则](docs/architecture.md#application-launch)）。

## 仓库布局

```
vendor/      内置（vendored）的 Cordis（vendor/README.md）
packages/    @deepseek-ai/dsh-<pkg> 工作区，位于 packages/<group>/<pkg>/
  core/                 agent/session API
  api/                  远端 BFF
  typert/               类型图
  llm/                  模型 provider
  shell/                命令执行
  subprocess/           子进程管理
  ssh/                  SSH 执行 provider
  terminal/             持久终端
  ptc-runtime/          PTC 执行
  sandbox/              进程隔离
  deliverables/         轮次交付物
  fs/                   文件系统访问
  lsp/                  语言服务器
  skill/                技能加载
  web/                  搜索/抓取工具
  computer-use/         计算机交互
  browser-use/          浏览器交互
  compaction/           上下文压缩
  context/              请求上下文
  subagent/             委派 agent
  team/                 共享任务协调
  jobs/                 后台任务
  bundle/               profile bundle
  workflow/             工作流执行
  todo/                 todo_write 工具
  plan/                 有记录的规划
  goal/                 会话目标
  schedule/             定时跟进
  preset/               agent 组合
  guard/                循环/工具守卫
  extensions/           运行时自我修改
  session/              持久会话
  session-query/        浏览/搜索/导出
  attachment/           二进制附件
  spill/                输出溢写
  storage/              非会话存储
  workspace/            工作区实体
  feedback/             人工反馈
  identity/             匿名身份
  settings/             用户设置
  credentials/          凭据/授权
  acp/                  仅自动化 ACP
  interaction/          人机交互
  boot/                 应用启动
  sdk/                  JSON-RPC SDK
  host/                 GUI 宿主
  client/               GUI 客户端
  mcp/                  外部工具
  experimental/         已评估、但不承诺产品支持的能力
  test-support/         测试基础设施
  util/                 零依赖工具
python/      Python SDK/运行时（python/README.md）
native/      @deepseek-ai/node-addon-system 源码（native/README.md）
benchmarks/  性能门禁
.agents/     Agent 工作流/笔记
docs/        文档（docs/AGENTS.md）
scripts/     门禁与生成器
website/     VitePress 文档投影
```

包分组：[packages/README.md](packages/README.md)。[实验状态](packages/experimental/README.md#status)与"可选交付"相互独立；非实验包需要产品使用或一份显式的[分类](scripts/product-package-policy.ts)。

## 命令

```sh
pnpm install            # pnpm workspaces，node >=24.9
pnpm run clean           # 删除构建产物与已删包留下的安全残留
pnpm run test           # 单元测试
pnpm run test:coverage  # CI 覆盖率门禁：packages/*/*/src 逐文件 100%
pnpm run test:e2e       # 真实 API 测试；没有 DEEPSEEK_API_KEY 时自动跳过
pnpm run test:expected  # owner 本地的进程期望
pnpm run test:snapshot  # 无 key 回放录制的会话，走已交付 profile；过滤：-t <name>
pnpm run test:snapshot:record  # 重新录制期望输出（需要 key）
pnpm run typecheck
pnpm run lint
pnpm run duplication    # 跨文件 TypeScript 克隆检测
pnpm run build          # build:artifacts + build:check，并发执行
pnpm run build:artifacts # 产物：tsc 产出 lib/types，tsdown 打运行时 bundle，Web
pnpm run build:check    # 用当前 build:artifacts 输出对 tests/scripts 做类型检查
pnpm run hygiene        # publint + workspace/package/dependency 检查 + NodeNext 消费方检查
pnpm run check:windows-wine  # 只在诊断已知 Windows 失败时用（需要 wine）；CI 负责该信号
pnpm run doc-sync       # 文档门禁（scripts/run-gates.ts）
pnpm run test:docs      # 快速文档检查（不构建；doc-quick 聚合）
pnpm run website:build  # VitePress 构建（兼作死链检查）
pnpm dsh --profile headless "task"  # 从源码跑一个任务（需要 DEEPSEEK_API_KEY）
pnpm run demo:ptc -- "task"  # headless PTC 模式运行（需要 key）
pnpm run dev:web | dev:desktop  # 先 build:artifacts 再启动；Web 还会在编辑时重建客户端 bundle。start:web | start:desktop 跳过构建
make web|dev-web|desktop|dev-desktop|build  # 同样的命令；ARGS='--no-open' 转发选项
```

### 宿主沙箱失败

如果某个必需的 `gh`、`pnpm`、构建、测试或生成器命令因沙箱拦截凭据、网络、IPC、文件监听或嵌套 `sandbox-exec` 而失败，用**最窄的**宿主提权重试同一条命令。必须拿到沙箱证据；绝不绕过测试失败或产品沙箱。

### 本地跑相关检查

推送前遵循 [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md)；只汇报真正跑过的命令。`gh stack sync` 之后立刻验证；检查通过前不合并。

- 证据要匹配表面：行为聚焦测试、模型/用户输出快照、文档改动跑 `doc-sync`、已发布路径跑构建后的冒烟、provider 改动跑真实 API e2e。
- 不要把全量套件当默认，也不要为提交或推送重复跑已通过的检查。CI 负责穷尽覆盖与平台矩阵；只有明确要求、诊断 CI、或改动不可约地涉及全仓时，才在本地全量彩排。
- `test:coverage`（不是 `test`）才是 CI 覆盖率门禁（[原因](docs/testing.md)）。
- 用 `build:artifacts` 开发；声称完成之前，在最新的 `build:artifacts` 之后跑 `build:check`，或者直接跑 `build`（[布局](docs/development.md#typescript-project-layout)）。
- **Web 浏览器自动化与 GIF 录制：** 用 `pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml` 启动，以使用[页面内目录选择器](apps/web/tests/pin-browse-picker.overlay.yml)；只有明确测试原生选择器行为时才省掉这个覆盖。

## 密钥 / .env

Windows 打包/签名：[必读](apps/desktop/windows-signing/README.md)。

真实 API 测试/demo 读取 `DEEPSEEK_API_KEY`、可选的 `DEEPSEEK_BASE_URL` 与根目录 `.env`。cordis.yml 允许插件 `config` 与条目 `disabled` 下使用 `!!js`（绝不用 `!js`）；其他元数据保持字面量，所以条件组合也要用 overlay（[primer](docs/cordis-primer.md#loader-configuration)）。绝不提交凭据。CI e2e 没有 key 时跳过；[testing.md](docs/testing.md) 负责 key 策略。

## 约定

- 包名用 `@deepseek-ai/dsh-<name>`；vendor 已[重定 scope](docs/rescope.md) 且 `private: true`。harness 包在 `peerDependencies`/`devDependencies` 里声明 `@deepseek-ai/cordis`。工作区依赖段用 DSH 的 `workspace:*`，vendor/native 用 `workspace:~`（[规则](.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)）。
- 全部 ESM（`"type": "module"`）。跨包用包名，本地相对导入用 `.ts`。配置子进程在纯 Node 下跑构建好的 `lib/`；源码回归用各自声明的启动器（[测试策略](docs/testing.md#test-subprocess-launch-modes)）。`dsh` CLI 的源码启动走 tsx 的 ESM-only hook（`node --import tsx/esm`）；它触达的模块必须保持 ESM（不允许 CJS-only 导出）（[源码启动契约](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)）。Raw/Web `cordis.yml` 里的裸插件必须出现在其解析清单的 `dependencies` 中；`verify-cordis-config` 强制这条。
- **注册即效果**：每个贡献都走 `ctx.effect()` / `ctx.on()`；registry 的 `register()` 返回 disposer，直接返回或通过其文档化的注册句柄。
- **带类型的事件用声明合并**与可合并扩展的映射。事件的 JSDoc 需要 `@mode` 与载荷的 `@param`。公共服务方法要文档化参数与非 void 返回值。`SessionEventMap` 的成员默认读时必填，除非信封带 `ignorable: true`。只有在既有判别符无法阻止不安全解释时才升 `SESSION_FORMAT_VERSION`；同版本变更要求读侧行为安全（[评审](.agents/notes/implemented/process/2026-10-08-session-reader-compatibility-review.md)）。
- **对判别标签做 switch。** 封闭联合以 `assertNever` 收尾；可合并扩展的联合走一条文档化的 default。
- **Waterfall 监听器必须调 `next()`** 才算委派；不调就短路整条链（[语义](docs/cordis-primer.md#cordis-waterfall-semantics)）。
- **模型可见 ⟺ 有日志**：任何进入模型请求的东西都必须能从会话日志重建；新增模型可见输入必须配一个会话事件。
- **会话投影**：创建、扩展、评审会话投影，或把 fold 助手迁移成投影时，遵循 [dsh-session-projection](.agents/skills/dsh-session-projection/SKILL.md)。
- **插件，不改循环**：新行为落在文档化的扩展点上；改 `agent-loop` 需要更新 docs/architecture.md。
- **一个能力接缝（capability seam）由 Service Definition / Service Provider / Consumer 三个角色组成。** 它是完整的，从不只是单个角色；只有角色各自独立演进时才拆分（[术语表](docs/glossary.md#capability-seam)）。
- **能删自家代码与测试时，优先用维护中的依赖，而不是手写**（[政策](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)）。
- **包边界上显式优于隐式**：默认值在拥有方实现里是显式的 `resolve(request): Spec` 步骤，绝不是 `run()` 里隐藏的 `?? default`（`dsh-shell` 的 request/spec 拆分就是模板）。
- **插件里不许硬编码可调参数**：随部署而变的选择是 `Config` 字段，可在 cordis.yml 里改并接受校验；`DEFAULT_*` 常量或测试钩子不算可配置。协议常量、外部规范与安全不变量保持固定。
- **配置错误要响亮失败**：自包含时在加载期，否则在最造可解析的点；绝不静默跳过缺失的引用对象。
- **跨边界的不透明 id 要带品牌**（来自 `dsh-brand` 的 `Branded<B>`），绝不用裸 `string`。
- **在带类型的同进程边界上信任 TypeScript。** 静态接口已经要求的取值，不要额外加运行时校验、回退行为或恶意输入测试；在 parser/config、排队、模型/工具 JSON、持久化/文件、worker、进程与 wire 边界上校验。
- **不许新增到 `unknown` 的断言**（`as unknown` 或 `<unknown>`）。保持或降低既有精确基线；替换处用带类型的值或校验（[规则](.agents/notes/implemented/process/2026-09-19-no-unknown-casts.md)）。
- **源平面与产物平面，绝不混用。** 静态门禁与测试通过 tsconfig `paths` 把工作区导入解析到 `src`，在干净树上通过；消费构建产物 `lib/` 的门禁要声明该依赖（[布局](docs/development.md#typescript-project-layout)）。
- **让编译面保持显式。** 同时有 Host 与 Client 程序的包暴露各面的叶子配置与一个只做 solution 的根；全仓程序喂给某个面配置，绝不喂根 solution（[布局](docs/development.md#typescript-project-layout)）。
- **错误处理：** 用带类型、结构化的失败与本地化、可操作的报告。定义处理归属、隔离与失败保证；停止依赖工作并显式报告不可信状态或未知结果。遵循 [dsh-error-handling](.agents/skills/dsh-error-handling/SKILL.md)。
- **空的 `catch` 要写明错误**与原因；其 `try` 保持一条语句。
- **注释保持本地。** 不要复述代码、扩张无关注释，或在没有本地需要时解释远处行为（[理由](.agents/skills/dsh-prose-standard/SKILL.md)）。
- **禁用 `prove` + `nance`**（[规则](.agents/notes/implemented/process/2026-08-26-ban-ambiguous-origin-label.md)）。
- **并列的值优先对称**；无法解释的不对称通常意味着漏了一次抽取。
- **测试描述行为，不描述正确性。** 过时行为连同其测试一起改；在 PR 里说明原因。
- **只在有持久决策理由时创建 Agent Notes**；机械/局部编辑豁免，包括局部 UI 改动（[范围](.agents/notes/README.md#when-to-write-one)）。归档笔记是冻结的：绝不编辑，也不当作现行权威（[归档政策](.agents/notes/README.md#archiving-and-deletion)）。
- **官方插件美术：** 官方与官方实验插件的图标使用 [dsh-official-plugin-artwork](.agents/skills/dsh-official-plugin-artwork/SKILL.md)；落地新图形前取得设计师批准。
- **客户端 UI 文案归 locale 所有。** 产品文本走带类型的字典与 `t` 或本地化原语 props；`verify-client-ui-i18n` 拒绝硬编码文案（[决策](.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)）。英文文案（含插件标题）用句首大写（[规则](.agents/skills/dsh-prose-standard/SKILL.md#required-coverage-by-prose-location)）。
- **UI 改动：** 用 [dsh-client-ui-ux](.agents/skills/dsh-client-ui-ux/SKILL.md) 作为设计与评审入口；只在需要时加载其参考文件。
- **测试策略**——[docs/testing.md](docs/testing.md)。每个非平凡的模型可见或产品用户可见改动都要更新一个无 key 的录制会话快照；[快照归属](snapshots/AGENTS.md) 保留顶层树给会话驱动的用例，其他期望输出留在 owner 本地。夹具在 macOS/Linux 回放；修夹具，不修 normalizer。
- **每个工具的 UI 呈现要提前设计。** Host presenter 保持纯函数；Web 卡片从原始事件与持久化结果元数据派生（[cookbook](docs/cookbook/adding-a-tool.md)）。
- **为能力接缝、生命周期路径与转录输出规划单元、e2e 与快照覆盖**；把缺失的快照 harness 支持包含在同一改动里。
- **两个 SDK 都投影循环。** agent-loop、session-lifecycle 与 `SessionEventMap` 的改动在同一 PR 里更新 TypeScript 与 Python SDK 的期望输出；`pnpm run test` 两者都不覆盖（[表面](docs/testing.md#when-a-snapshot-test-is-required)）。
- **刻意选择 PR 历史。** 独立改动拆开，先修引入问题的 PR。独立/堆叠分支可以 merge-forward 或 rebase。重写用 `--force-with-lease`，远端变动即中止，绝不用裸 `--force`；在接受更新的基之前保留进行中的 merge-forward 检查点（[理由](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)）。
- **标签：** 一个 PR 一个 `kind/*`、所有实质内容 `area/*`，以及原生 Issue Type（[分类法](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)）。
- **PR 描述：** 用 [dsh-pr-description](.agents/skills/dsh-pr-description/SKILL.md) 编写并更新每个 PR 描述。
- TODO 标记：按紧急度用 `FIXME`/`TODO`/`XXX`（[语义](docs/development.md)）。
- 文件以恰好一个结尾换行结束；`git diff --cached --check`（pre-commit）把这条作为门禁。

## 防御式模式

改包表面、远端服务、客户端组件或状态、会话（Session）行为，或生命周期、并发、子进程与拆除代码之前，先读 [docs/defensive-patterns/README.md](docs/defensive-patterns/README.md)。它的[评审原则](docs/defensive-patterns/README.md#why-these-rules)按产物适用。

## 类型安全与文档

一切都在 `strict: true` 与 `noImplicitAny` 下编译；每一处剩下的 `any` 都要解释为什么无法收窄。每个模块与导出都有一份简洁 JSDoc，说明其非显然契约；函数式导出包含 `@param`/`@returns`，由 `verify-export-jsdoc` 强制。继承声明的成员、插件协议 slot 与构造函数把文档留在声明处的 Service Definition、协议或类上。

注释与文档陈述完整契约与上下文，不是推理过程。用直接、具体的词。不要用隐喻。在写 `contract`、`boundary` 或 `shape` 之前，先问有没有更精确的词来命名对象：写 `response fields`、`JSON validation` 或 `ESM exports`，而不是 `response shape`、`validation boundary` 或 `module shape`。`contract` 只留给前置条件、后置条件、不变量、兼容承诺，以及其他调用方、被调方、实现方、provider 生产者或消费者所依赖的义务。字面意义上的进程、wire、安全、事务或生命周期边界可以保留。不要叙述控制流或测试，不要保留评审历史，不要复述代码。保留行为、失败、时序、归属与安全使用的事实；链接理由。决策用 [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md)。把可机械检查的不变量接进一个实际执行的顶层门禁，并证明每条改动过的验收路径都会拒绝无效用例。用窄而合理的例外，而不是全局禁用规则。

每个代码改动都伴随文档：一起更新受影响的 README 与 JSDoc 契约。例行的双语工作遵循 [docs/AGENTS.md](docs/AGENTS.md)；只有用户明确要求才能跑 `dsh-translate-docs`。现行状态散文、每段一行、每个事实一个家，以及字数预算都在那里。

## 编辑这些说明

`CLAUDE.md` 在根目录与 `packages/` 软链到 `AGENTS.md`；编辑真实文件。让每条规则自包含，同时链接高层文档。在清晰度仍能保持时压缩；当所需内容确实需要更多空间时，提高 `verify-doc-budgets` 的上限。

## 内置（vendoring）政策

`vendor/` 下的包是钉住版本的源码副本（上游 SHA 清单见 [vendor/README.md](vendor/README.md)）。按那里的同步流程更新；重新应用或退役记录的本地修改；重跑 `pnpm run test && pnpm run build`。
