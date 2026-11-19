---
description: "The Context injections page in the dsh web client's Settings: switches and editable templates for the notices and runtime context injected into model requests."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-context-injections

English | [中文](README.zh.md)

## Summary

Open **Settings → Context injections** to choose which notices and runtime-context sections the harness adds to model requests, and to rewrite their text. The page edits the `context-injections` namespace of [`dsh-context-injections`](../../context/context-injections/README.md), stages every edit until **Save**, marks a value the user overrode, and offers to reset it to the deployment's default. The page exists while the Host serves that namespace.

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

The page lists two groups. **Notices and reminders** holds the messages added when something changes, such as **Model switch notice** and **Current time**; **Runtime context** holds the facts restated at the end of the conversation, such as **File access policy**, which states `danger-full-access`. Each row has a switch and folded templates: **Edit text** opens them, and a row with an edited template shows them open. A row whose producer writes several shapes, such as the four file policies, has one labelled template per shape. Each template starts as the producer's own wording and lists the variables it can use below it, such as `{{from}}` and `{{to}}`; `{{text}}` stands for the whole original, and an empty template sends the original. **Working directory** is always sent, so it shows no switch and only its template can change.

A changed switch or template shows **Overridden** with **Reset to default**, which restores the original wording. Nothing is written until **Save**; leaving the page drops the draft. A saved change applies from the next step of every task.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `context-injections` namespace through `ctx.configForms.get`, keeps the staged form in `ContextInjectionsController` over the shared `SettingsFormModel` of `ui-primitives` with one `settingsBooleanField` and one `settingsTextField` per row, and registers `ContextInjectionsSection` into the Settings shell's `settings.section` slot at order 23 through `ctx.configForms.whileServed`. The rows are spelled in `src/client/rows.ts` because a client package cannot import the Host package; a test checks them against the Host row table. The page's copy lives in this package's `settings.contextInjections` dictionary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [context-injections](../../context/context-injections/README.md) — what each row matches and how admission applies it.
- [ui-settings](../ui-settings/README.md) — the Settings shell, the `settings.section` slot, and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model, switch, and text-area fields the page renders.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the context-injections plugin whose fields the page edits; that plugin owns every model-facing effect.

#### KV Cache effect

None directly. A saved change reaches the Host, whose own contract records that it applies from the next step and that a changed section produces one new runtime-context snapshot at the history tail.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No preview** — the page shows no example of the original text a row would send; the task’s Context editor tab shows what was sent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
