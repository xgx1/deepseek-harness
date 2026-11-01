---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-28-manager-delivery-attribution

[English](2026-10-28-manager-delivery-attribution.md) | 中文

## 概述

新增仅用于归属的 `session-manager` 来源类型，供管理端投递使用。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-manager-delivery-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "49be49f360fe06510c82ef0b016188df366542a4a70f706610f3673bf4407a02"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "32eabe9611ded77695b8484d1af35c20b1080fb463011319d6500a84aadadd02"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "f7e31bb7f1564c0dfe96637c7f281424da450bfbb0f4cf51ded9ef07559bbc24"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "a46f55ad2b36c79c4293f5ce67ef7d76c7d534ba2621b798ec53aa7279d258e2"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新类型只承担归属与重复抑制的元数据作用：没有管理插件的读取方会保留已记录的用户消息及其来源记录，该类型不带来校验、重放或授权要求。声明的来源策略未变化，Session header 版本也不变化，因此已有记录在双向读取时都保持可读。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-manager/tests：4 个文件、36 个测试通过。pnpm run gen-persistence-catalog 与 pnpm run verify-persistence-catalog：无差异。pnpm run build:lib:host：退出码 0。

<a id="dev-note"></a>
## 开发备注

无。
