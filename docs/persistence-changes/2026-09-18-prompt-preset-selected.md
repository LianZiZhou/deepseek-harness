---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-18-prompt-preset-selected

English | [中文](2026-09-18-prompt-preset-selected.zh.md)

## Summary

Adds the `prompt-preset/selected` session event, which records the prompt preset a session runs under and may change at any point in that session.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-18-prompt-preset-selected
baseline: false
changes:
  - root: "event:prompt-preset/selected"
    previous: null
    after: "de386d52c32c993646e6bedaa4f0a6d817ef74e7fdc0dce4288df95257041f67"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Additive vocabulary at the current writer version: the event is a new root with no predecessor, so no existing event's shape changed and no format bump is required. A reader from an older build meets an unrecognized required type and refuses to reconstruct, which is the repository's standing behavior for a new in-repo event type; the envelope's `ignorable` marker is reserved for out-of-repo types and `Session.append` cannot set it. Nothing model-visible is lost if the record is skipped in a reader that does add the type later, because the rendered prompt is separately durable as `system/message` text; the projection folded from these events decides only which preset a resumed or forked session re-applies.

<a id="verification"></a>
## Verification

`packages/preset/prompt-presets/tests/session.spec.ts` folds the projection over a selection sequence and a fork prefix; `packages/preset/prompt-presets/tests/override.spec.ts` pins the appended event and its ordering under concurrent selection; `pnpm run gen-persistence-catalog` regenerated the catalog, the schema, and `KNOWN_SESSION_EVENT_TYPES`.

<a id="dev-note"></a>
## Dev Note

None.
