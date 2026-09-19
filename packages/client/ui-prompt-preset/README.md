---
description: "The prompt-preset browser surfaces for users and maintainers editing rule stacks or switching a task's prompt preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-prompt-preset

English | [中文](README.zh.md)

## Summary

This package is the browser half of prompt presets: a settings section that edits a preset's ordered rule stack beside a live preview of the prompt it would produce, and a switcher in the task header that changes the preset a running task uses. Edits are staged and written only on save, so a broken rule is refused beside its field rather than after a round trip. The preview is always the Host's answer, drawn against the task the main view shows, because which sections exist depends on that task. A deployment storing no presets renders neither surface.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the `dsh.client` row to the Web roster; there is nothing to configure. The node half is an empty `apply` so the plugin appears in the Loader, and the browser half registers two surfaces:

| Surface | Slot | Position |
|---|---|---|
| Settings section | `settings.section` | `id: 'prompt-presets'`, `order: 22` — after Agent presets, before Archived tasks |
| Task switcher | `conversation.session.header.actions` | `id: 'prompt-preset'`, `order: -9` — right after the agent-preset label |

Both read one roster over `ctx.remote.promptPresets` and refresh together on a `settings/document-updated` for the `prompt-presets` namespace, on the Host's own `prompt-preset/changed`, and on `connection/reset`.

### The switcher is a control, not a label

The agent-preset surfaces split into a before-the-fact chip and a read-only header label, because a task's composition is fixed once it starts. A prompt preset is not: the system prompt is re-rendered every step, so the header offers a live menu and the copy says a change applies from the next turn and leaves sent messages alone.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | `apply`: dictionaries, both slot registrations, refresh wiring, preview targeting |
| [`src/client/section-store.ts`](src/client/section-store.ts) | The settings section's controller: roster, one draft, dialogs, debounced preview |
| [`src/client/seat-store.ts`](src/client/seat-store.ts) | The switcher's controller: the menu roster and the write |
| [`src/client/preset-model.ts`](src/client/preset-model.ts) | Pure draft model and the checks that decide whether Save is offered |
| [`src/client/PromptPresetSection.tsx`](src/client/PromptPresetSection.tsx) | The page: roster rail, editor, dialogs |
| [`src/client/RuleCard.tsx`](src/client/RuleCard.tsx) / [`RuleFields.tsx`](src/client/RuleFields.tsx) | One rule's chrome, and the fields each kind owns |
| [`src/client/PromptPreview.tsx`](src/client/PromptPreview.tsx) | Warnings, the section list, and the final prompt |
| [`src/client/TextArea.tsx`](src/client/TextArea.tsx) | Package-local multi-line field |
| [`src/client/locales.ts`](src/client/locales.ts) | The one home of this surface's copy |
| — | No runtime invariant companion is published: this package owns presentation and staging only, and every fact it renders is the Host's. |

### Why the preview is a Host call

A browser-side rule engine would be a second implementation of `applyRules`, and the two would drift. Instead the draft is sent as a document — not a stored id — so an unsaved edit is what the person sees, and the Host answers with the same transform a step would apply. Edits debounce, a monotonic generation drops a late reply, and the timer is cleared on teardown.

### Why rule text renders literally

Section and prompt text go into `<pre>`, never `MarkdownText`. A prompt carries `{{…}}` groups, fences, and headings that a Markdown renderer would interpret; the point of this pane is showing exactly what the model receives.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [prompt-presets package](../../preset/prompt-presets/README.md) — the Host store, the rule semantics, and the failure policy this page surfaces.
- [Prompt-presets subsystem](../../../docs/subsystems/prompt-presets.md) — the wire payloads both halves pass.
- [ui-agent-preset package](../ui-agent-preset/README.md) — the mode surfaces this one sits beside, and why that choice locks where this one does not.
- [Web Client architecture](../../../docs/subsystems/web-client.md) — the slot, props, and store discipline every surface here follows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the prompt preset a task runs under; the preset it selects owns every model-facing effect.

#### KV Cache effect

None directly. A switch made here writes through the Host, whose own contract records that a changed selection rewrites the committed `system/message` and starts a new request series.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The preview needs an open task** — it assembles for one task's own scope, so the page says so rather than guessing when the main view shows none.
- **No difference view over the final prompt** — the section list marks added, removed, and changed sections, but the prompt tab shows the result rather than a diff against the baseline.
- **Reordering is buttons, not dragging** — there is no shared drag affordance in `ui-primitives` to reuse, and per-rule move buttons are reachable from a keyboard without one.
- **The multi-line field is package-local** — `ui-primitives` ships no `TextArea`, and the two raw textareas elsewhere are different controls; promoting one belongs to the first change that genuinely needs it in two packages.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
