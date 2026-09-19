---
description: "The preset group map: per-session agent composition and system-prompt overrides, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/preset

English | [中文](README.zh.md)

## Summary

The preset group provides the two choices a session makes for itself. An agent preset is a directory holding one `agent.cordis.yml`, and a session composed from one runs that preset's tools, prompt sections, and skills while every other session keeps its own: `agent-presets` owns the roster and the guarded per-agent mount, and `persona` supplies the row that lets a preset change an agent's identity and not only its tools. A prompt preset is the user's own ordered transform over the assembled system prompt, selectable per session and switchable at any point; `prompt-presets` owns it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-presets`](agent-presets/README.md) | Preset roster, discovery over trusted and user roots, per-agent composition, copy-only authoring | `ctx.agentPresets` |
| [`persona`](persona/README.md) | The composable persona row a preset mounts to shadow or replace the deployment persona | — |
| [`prompt-presets`](prompt-presets/README.md) | The user's own ordered system-prompt transforms, selectable per session and switchable at any time | `ctx.promptPresets` |

-----

<a id="related-documentation"></a>
## Related documentation

- [`AgentPresets` reference](../../docs/subsystems/core.md#ctxagentpresets--agentpresets) — discovery, mounting, inheritance, and recomposition.
- [Scope subsystem](../../docs/subsystems/scope.md) — scope keys and the parent chain the mount uses to join agents.
- [System prompt subsystem](../../docs/subsystems/system-prompt.md) — how preset prompt sections register and assemble, and the final-override seam `prompt-presets` occupies.
- [Prompt-presets subsystem](../../docs/subsystems/prompt-presets.md) — the rule vocabulary and the wire payloads this group’s prompt overrides pass.
- [Per-session agent presets note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md) — design rationale and alternatives.

The presets the deployment ships live in [`agent-presets/presets/`](agent-presets/presets) — one directory per preset, and that directory listing is the roster; naming them here too would be a second list to keep in step.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
