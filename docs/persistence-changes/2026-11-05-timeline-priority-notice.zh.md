---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-05-timeline-priority-notice

[English](2026-11-05-timeline-priority-notice.md) | 中文

## 概述

记录用户添加或取消紧急优先级时的时间线通知。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-timeline-priority-notice
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-28-manager-delivery-attribution"
    after: "811850dddf4d64d7be031dc19c29db3bbbf18fb80ea406647a3bb70a783a4d61"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-28-manager-delivery-attribution"
    after: "2d9fc245c491881b99b7feecca22f75a19ec95c93731cfb774503ebfd6d09b6d"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-28-manager-delivery-attribution"
    after: "ae34fb0f4a077c98640d56f478f6cba59e0458a27392f20705a1eb96e2c9ed5c"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-28-manager-delivery-attribution"
    after: "303b43e9802412e29a5bd35e9737e4e8f23543a799b613526c249f4948f8fcbc"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有消息保留原有来源和含义。时间线通知包含普通文本和来源标签。未加载时间线的读取方可保留未知来源并读取文本，无需应用任务更新。时间线将任务树、报告和讨论保存为会话日志中可忽略的 `plugin:timeline/*` 记录。未加载时间线的读取方会跳过这些记录。

<a id="verification"></a>
## 验证

时间线优先级测试验证仅用户修改紧急优先级时才排入通知。进程恢复测试验证写入进程意外退出后仍可恢复时间线状态。

<a id="dev-note"></a>
## 开发备注

无。
