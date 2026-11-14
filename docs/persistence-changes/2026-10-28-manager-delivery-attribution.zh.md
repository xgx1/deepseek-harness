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
    previous: "2026-10-27-retry-control-input"
    after: "4d5824726a7dc7c286e34516115f802acb6adc15f23dfb9d193237e9fd1e123e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "834ede754a72c958fc9f5ee1f531d8d5a7883e7d7858af8583ba2be66b890b54"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "1d27687384edc8445da26e32c25aa860f58a79206993775afcd2aaec1a14d367"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "bf51e8d7a5753c04e8856bb24311048de6d3572f42f6700e3c486740c4907108"
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
