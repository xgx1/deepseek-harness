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
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "3b7bea090ccfd34d3dbaf6711962194aaa482434ec5bc12f2759a85099bc3cb1"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "d000f07ef7735255fa051b9069300fdcbfd15e729ab6d4208da7c9eea168a7ae"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "debb72d4943e53ff5c2205e51365b84154f6d309c913df97f824b7462b5c0cc9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "df803dd120cf576b4c91634a202354a4b8efa6ca00992af50102275aaac0dda5"
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
