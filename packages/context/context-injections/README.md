---
description: "Switches and replacement text for the context the harness injects into model requests, for users and maintainers deciding what the model is told."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-injections

English | [中文](README.zh.md)

## Summary

`dsh-context-injections` decides which injected context reaches the model and in what words. It covers two kinds of injection: notices and reminders that producers add to a step as user messages, such as the model-switch notice, the time reading, or the approval-policy change; and the named sections of the runtime-context snapshot, such as the file-access policy that states `danger-full-access`. Each can be switched off or rewritten from a template of the producer's own wording, with runtime values as `{{variables}}`, on the Context injections settings page or in `cordis.patch.yml`. A change applies from the next step without a remount.

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

The shipped `dsh` base mounts the row as `context-injections` and turns the model-switch notice off; every other injection is sent unchanged. The Web and Desktop apps edit it from **Settings → Context injections**, which [`dsh-client-ui-settings-context-injections`](../../client/ui-settings-context-injections/README.md) provides.

### Rows

| Row | Matches | Can be switched off | Shapes |
|---|---|---|---|
| `modelSwitch` | messages from `model-selection` | yes | one |
| `timeContext` | messages from `time-context` | yes | `known`, `unclear` |
| `approvalNotice` | messages from `user-approval` | yes | one |
| `workingDirectoryNotice` | messages from `working-directory` | yes | `changed`, `unavailable` |
| `planModeNotice` | messages from `plan-mode` | yes | `entered`, `left` |
| `repeatToolReminder` | messages from `repeat-tool-reminder` | yes | `first`, `repeated` |
| `agentInstructions` | messages from `agent-instructions` | yes | `loaded`, `trimmed`, `replaced`, `cleared`, `updated` |
| `skillCatalog` | messages from `skill-catalog` | yes | `catalog`, `catalogPartial`, `changed`, `changedPartial` |
| `tmuxContext` | messages from `tmux-context` | yes | one |
| `workingDirectory` | section `working-directory:current` | no; the section is required | one |
| `sandboxPolicy` | section `sandbox:policy` | yes | `readOnly`, `workspaceWrite`, `workspaceWriteRoots`, `fullAccess` |
| `approvalPolicy` | section `approval:policy` | yes | `ask`, `never` |
| `subagentDelegation` | section `subagent:delegation` | yes | one |
| `harnessSource` | section `harness:source` | yes | one |
| `webSurface` | section `app:web-surface` | yes | one |

A message or section no row names, including a person's own prompt, passes through unchanged. A row whose producer is not composed has no effect.

### Configure

Each row owns `<row>Enabled` (default `true`; absent for `workingDirectory`) and one template field per shape: `<row>Text` for a row with one shape, `<row><Shape>Text` for each named shape, such as `sandboxPolicyFullAccessText`. Every field is volatile.

```yaml
- id: context-injections
  name: '@deepseek-ai/dsh-context-injections'
  config:
    modelSwitchEnabled: false
    modelSwitchText: 'Now answering as {{to}} (was {{from}}).'
    sandboxPolicyEnabled: false
```

A template defaults to the producer's own wording, where each runtime value is a `{{variable}}`: `{{from}}` and `{{to}}` in the model-switch notice, `{{cwd}}` in the working-directory section. An injected text is matched against its row's shipped templates, the shape with the most constant text first, which recovers its variables; the person's template for that shape is then rendered with them. `{{text}}` always stands for the whole original. An empty template, or one equal to the shipped template, sends the original. A placeholder that names no variable, and any other braces, reach the model as written. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-context-injections) lists every field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin listens on the agent loop's two admission events. `agent/admit-messages` runs once per entered step after every `agent/pre-step` listener has settled and before any message is committed, so it sees notices that agent-scoped listeners such as `installModelSelection` append outermost; a `agent/pre-step` listener cannot be guaranteed that position. `agent/admit-context` runs over the rendered runtime-context sections before the loop compares them with the retained snapshot, both when a step is prepared and before every attempt. Both read the volatile Config on each call.

A dropped message is never committed, and a rewritten one is committed as rewritten, so the session log records exactly what the model received. A rewritten `snapshot`-form message also rewrites the sections that mirror its text. Because sections are admitted before the snapshot comparison, changing a section's switch or text produces a new snapshot at the next step, while a dropped section that changes produces none.

The plugin turns off the generic generated settings form for its entry, because the settings page package renders its own.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` and the admission listeners |
| [`src/settings.ts`](src/settings.ts) | Per-row reads of the volatile Config |
| [`src/rows.ts`](src/rows.ts) | The row table, each shape's shipped template, and the field-name rules |
| [`src/transform.ts`](src/transform.ts) | Pure drop and rewrite of messages and sections |
| [`src/template.ts`](src/template.ts) | Compile a shipped template, recover its variables from a text, and render a template |
| — | No runtime invariant companion is published; the plugin owns no state, and the agent loop owns admission and commit. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent loop](../../core/agent-loop/README.md) — where the admission events run.
- [Settings page](../../client/ui-settings-context-injections/README.md) — the Settings section that edits these fields.
- [Prompt presets](../../preset/prompt-presets/README.md) — the control over the system prompt itself, which this package does not touch.
- [Context admission Agent Note](../../../.agents/notes/implemented/architecture/2026-11-18-context-admission-events.md) — why the policy sits on the loop's admission events rather than on `agent/pre-step`.

-----

<a id="model-experience"></a>
## Model Experience

### Injected context

#### What the model sees

With the shipped defaults, every injection except the model-switch notice, unchanged. A switched-off notice is absent from the request and the log. A switched-off section is absent from the `<system-reminder>` runtime-context snapshot. A row with an edited template shows that template with its variables filled in from what the producer wrote.

#### Token effect

Removed or replaced rather than added: a switched-off injection saves its tokens, and an edited template costs its rendered length instead of the original's.

#### KV Cache effect

Injections are appended at the history tail, so a change never rewrites earlier messages. A changed section switch or text produces one new runtime-context snapshot at the next step.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A fixed row table** — rows name the injections that are context about the session; content a session depends on, such as subagent results, team messages, job output, schedules, skill invocations, session references, compaction summaries, goal wrap-ups, hook output, PTC environment resets, tool availability changes, and Cordis plugin failures, has no row. Third-party plugins' injections and the experimental timeline plugin's required `timeline:*` sections have no row either. A new producer needs a row added here and on the settings page.
- **Templates follow the shipped wording** — variables are recovered by matching the producer's text against the shipped templates. A text no shape matches, such as one a newer producer words differently, or rarer shapes such as an empty skill catalog or project instructions that fit no frame, is sent unchanged. `tests/templates.spec.ts` matches every injection in the recorded session snapshots, so a wording change upstream fails there.
- **Rewriting the tmux reading re-injects it** — the tmux plugin compares the committed reading with the current pane state, so a template that changes the reading after its first line makes every first step look like a change.
- **The system prompt is out of scope** — system-prompt sections are edited through prompt presets.
- **Producers keep trying** — a producer that records its own injections, such as the time reading or project instructions, offers a dropped injection again at later steps; each is dropped again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative; shipped behavior lives in the sections above and the package code.

- **Row table duplication** — the settings page spells the row ids again because a client package cannot import a Host package; a test keeps both tables in step.

</details>
