---
kind: upgrade-guide
description: "The built-in Context editor uses a new conversation view ID, so saved tab selections and links using context no longer select the editor."
---

# The built-in Context editor has its own view ID

English | [中文](guide.zh.md)

## Change

The built-in editor registers in `conversation.view` as `trajectory-context-editor` instead of `context`. A session with a saved selection of `context` opens the plugin tab with that ID if one is registered, or Chat otherwise. Session history is unchanged.

## Migration

1. To return to the editor, open the affected session and select **Context editor** once. The client remembers that selection for the session.
2. If your plugin opens the built-in editor by ID, change its target to `trajectory-context-editor`. Keep `context` if you target the `dsh-context` dashboard. With both installed, check that each opens its own view.
