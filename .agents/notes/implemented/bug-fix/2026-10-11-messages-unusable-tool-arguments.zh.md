# Agent Note: 保留不可用的 Messages 工具参数交由工具运行时处理

Status: implemented

[English](2026-10-11-messages-unusable-tool-arguments.md) | 中文

## 问题

DeepSeek Messages 会流式返回一个参数为不可用 JSON 的工具调用，同时仍报告 `stop_reason: tool_use`。长嵌套的 GenUI spec 最容易触发：多一个右括号，或提前写了一个 `}` 之后又继续写属性。[翻译器](../../../../packages/llm/llm-deepseek/src/protocols/messages/translate.ts) 在 `message_stop` 解析累积的 `input_json_delta`，并以 `MALFORMED_RESPONSE` 结束本次尝试；默认重试策略不重试该错误码，于是整个轮次终止，模型在本轮产出的内容全部丢弃。

## 决策

翻译器原样保留累积的工具参数，并以 `tool-calls` 结束——与从不校验参数的 Chat Completions 一致。[智能体循环](../../../../packages/core/agent-loop/src/tool-calls.ts) 本就把非法 JSON 保留为文本，因此工具运行时会以 `INVALID_ARGS` 拒绝该调用，模型可在同一轮内自行改正。提供方一侧的协议错误仍然失败：非对象的 `content_block.input`、未知的 delta 类型、没有打开块的 delta 属于载荷非法，而不是模型的失误。达到输出上限时的裁剪仍由[共享装配器](../../../../packages/llm/llm/src/assembler.ts)按原规则执行。

这取代了[历史工具输入说明](2026-09-16-messages-historical-tool-input.zh.md)中响应侧的校验规则。请求侧的兜底不变，且现在正好覆盖响应侧所保留的内容：可持久化的 Assistant 块保留原文，下一次 Messages 请求把该次调用的输入发送为 `{}`。不改变 Session 事件、持久化类型或协议配置。

## 考虑过的替代方案

**继续让本次尝试失败。** 该失败不可重试，模型看不到自己的错误，还要赔上整个轮次。

**修复 JSON。** 猜测缺失或多余的括号可能改变请求的操作——与[历史输入说明](2026-09-16-messages-historical-tool-input.zh.md) 拒绝修复请求输入是同一个理由。

**把 `MALFORMED_RESPONSE` 加入可重试错误码。** 重新采样内容层面的错误会丢掉该轮次的推理过程，而且可能再次产生同样的错误；模型手边其实已有确切的违规说明。

## 后果

一次非法的工具调用只花费一次工具错误和一次模型步进，而不是整个轮次。模型会看到带有 schema 违规列表的 `INVALID_ARGS` 以及它实际发送的参数，Session 日志保留该文本。工具绝不会带着猜测出来的参数运行。

验证覆盖翻译器单元用例（多余的右括号、被截断的对象、非对象 JSON：均原样保留并以 `tool-calls` 结束），以及一个组合测试：通过 Loader 加载插件、接上智能体循环与真实工具运行时，注入一段非法的 `input_json_delta` 流，断言轮次正常完成、结果带 `isError` 与 `INVALID_ARGS`，且下一次请求对该调用发送 `input: {}`。不新增无密钥的录制 Session 场景：`dsh-llm-replay` 用录制的会话记录充当模型脚本，因此快照无法触达响应翻译。本决策使其可达的那段恢复记录已被[非法工具历史场景](../../../../snapshots/session/deepseek-messages-invalid-tool-history/snapshot.yml) 录制：工具拒绝非法参数，轮次照常完成。
