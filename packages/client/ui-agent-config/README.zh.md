---
description: "新会话首屏的项目配置 chip：勾选这个项目的会话要带的配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-config

[English](README.md) | 中文

## 概述

在新会话行里、紧挨 Agent 预设 chip 之后加一个项目配置 chip。菜单列出 Host 声明的每个配置，每行注明它贡献什么，勾选即持久化这个项目的完整选择。选择是项目级的，因此对该工作目录之后的每个会话都生效。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

把这个插件和 `ui-conversation` 一起挂载，空白会话行就会在 Agent 预设 chip 旁边显示这个 chip。

chip 挂载时以及工作目录变化时读取当前项目的配置清单与选择。标签显示项目带了几个配置（未选任何配置前是 `配置：无`），菜单给每个已选行打勾，并且跨勾选保持打开，便于一次选好多个配置。每次勾选都写入完整替换选择；清空最后一项即让该项目回到不受管辖的状态。

项目没有工作目录、Host 没有声明任何配置、文档读不出来（解析错误或调用失败）时，chip 什么都不渲染。写入失败会把上一次的选择放回去。要注册一个贡献，需要 [ui-conversation](../ui-conversation/README.zh.md) 声明的 `conversation.hero.agentConfig` 座位，由外壳挂载。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

chip 是注册在 `conversation.hero.agentConfig` 上的一个 `single`/`session-maybe` 贡献，通过 `ctx.slots.inject('conversation.hero.agentConfig', …)` 注册，因此只在 `ui-conversation` 声明了该座位时出现。owner props 带项目工作目录；取回的数据放在组件本地状态里，因为没有别的读者。

注册的 inject 面拥有全部调用：`read(cwd)` 与 `save(cwd, selected)` 调 `ctx.remote.agentConfigs.getSelection` 与 `.setSelection`，并把被拒绝的 `RemoteResult` 和抛出的传输失败一并折叠成 `undefined`——对 chip 是同一个「没有内容可显示」的答案。Host 命名空间属于 [dsh-agent-config](../../preset/agent-config/README.zh.md)；本包既不读也不写那份配置文档。

勾选立即更新本地视图，调用落定后再由 Host 持久化的视图替换，因此菜单不必等一次往返就能回应点击；写失败的调用则把选择还原回勾选前的状态。

-----

<a id="further-exploration"></a>
## Further Exploration

- [Slots 参考](../../../docs/subsystems/slots.zh.md) —— 这个贡献背后的声明、作用域与 inject 面。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) —— 这种形态的浏览器插件应该落在哪一层。
- [dsh-agent-config](../../preset/agent-config/README.zh.md) —— 拥有配置清单并执行选择结果的 Host 侧。

-----

<a id="model-experience"></a>
## Model Experience

间接地，通过项目选中的那些配置生效：它们的技能与 MCP 贡献拥有各自对模型可见的能力。

#### KV Cache effect

选择变化只影响之后启动的会话；已在运行的会话保持启动时的工具集，其提示词与系统上下文不变。

## Known Limitations and Deferred Work

- 唯一入口是新会话行：运行中的会话不显示自己带的配置，改动项目选择对已经开始的会话没有影响。
- 控件保留最后一次成功读取的清单：对配置文档的外部修改要等控件重新挂载才会反映，本插件不订阅任何转发的 Host 事件。

### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

一次只发一个写：写入未落地时的第二次勾选会被丢弃，因为两个重叠的替换可能乱序到达 Host，把项目留在较早的选择上（`tests/agent-config-chip.client.spec.tsx`）。座位从会话骨架拿到 `cwd` 而不是自己读会话，所以即使项目还没有会话，控件也必须能工作。

</details>
