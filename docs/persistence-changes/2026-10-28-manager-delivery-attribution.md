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
## Compatibility

The new kind is attribution and duplicate-suppression metadata only: readers without the manager plugin preserve the recorded user message and its source record, and the kind carries no validation, replay, or authority requirement. The declared source policy is unchanged and the Session header version does not change, so existing records remain readable in both directions.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-manager/tests: 4 files and 36 tests passed. pnpm run gen-persistence-catalog and pnpm run verify-persistence-catalog: clean. pnpm run build:lib:host: exit 0.

<a id="dev-note"></a>
## Dev Note

None.
