---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-28-manager-delivery-attribution

English | [中文](2026-10-28-manager-delivery-attribution.zh.md)

## Summary

Adds the attribution-only `session-manager` source kind used by management deliveries.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The new kind is attribution and duplicate-suppression metadata only: readers without the manager plugin preserve the recorded user message and its source record, and the kind carries no validation, replay, or authority requirement. The declared source policy is unchanged and the Session header version does not change, so existing records remain readable in both directions.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-manager/tests: 4 files and 36 tests passed. pnpm run gen-persistence-catalog and pnpm run verify-persistence-catalog: clean. pnpm run build:lib:host: exit 0.

<a id="dev-note"></a>
## Dev Note

None.
