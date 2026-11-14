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
## Compatibility

The new kind is attribution and duplicate-suppression metadata only: readers without the manager plugin preserve the recorded user message and its source record, and the kind carries no validation, replay, or authority requirement. The declared source policy is unchanged and the Session header version does not change, so existing records remain readable in both directions.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-manager/tests: 4 files and 36 tests passed. pnpm run gen-persistence-catalog and pnpm run verify-persistence-catalog: clean. pnpm run build:lib:host: exit 0.

<a id="dev-note"></a>
## Dev Note

None.
