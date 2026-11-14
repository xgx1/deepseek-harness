---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-05-timeline-priority-notice

English | [中文](2026-11-05-timeline-priority-notice.zh.md)

## Summary

Records a Timeline notice when the user adds or removes urgent priority.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing messages keep their source and meaning. Timeline notices carry ordinary text and a source label. Readers without Timeline can keep the unknown source and read the text without applying a task update. Timeline stores task trees, reports, and discussions in the session log as ignorable `plugin:timeline/*` records. Readers without Timeline skip these records.

<a id="verification"></a>
## Verification

Timeline's priority tests check that only user edits to urgent priority enqueue a notice. The process recovery test checks that Timeline state survives an interrupted writer.

<a id="dev-note"></a>
## Dev Note

None.
