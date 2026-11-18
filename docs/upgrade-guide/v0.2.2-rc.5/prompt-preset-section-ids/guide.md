---
kind: upgrade-guide
description: "Resolve section ID collisions in prompt presets and update exhaustive rule handlers."
---

# Prompt presets require unique section IDs

English | [中文](guide.zh.md)

## Change

A preset that used to create a second section with the same generated ID now skips the colliding rule. Two enabled creation rules cannot claim the same ID in a saved preset. Clients with exhaustive handlers for prompt rules or preview warnings must handle the `rewrite` rule and the `duplicate-section` and `invalid-section-id` warnings. Existing presets without collisions keep their generated IDs.

## Migration

1. Open the preset preview on an affected task. For a colliding `prepend` or `append`, set `sectionId` to an unused ID and update rules that target the created section. If the intent was to replace an existing section’s text, use `rewrite` with its exact `section` instead.
2. In a custom client, display the affected ID from a `duplicate-section` warning. Verify that the preview lists the intended section once and no longer reports a collision.
