---
description: "Switches and replacement text for the context the harness injects into model requests, for users and maintainers deciding what the model is told."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-injections

English | [中文](README.zh.md)

## Summary

`dsh-context-injections` decides which injected context reaches the model and in what words. It covers two kinds of injection: notices and reminders that producers add to a step as user messages, such as the model-switch notice, the time reading, or the approval-policy change; and the named sections of the runtime-context snapshot, such as the file-access policy that states `danger-full-access`. Each one can be switched off or given replacement text, from the Context injections settings page or from `cordis.patch.yml`. A change applies from the next step without a remount.

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

| Row | Matches | Can be switched off |
|---|---|---|
| `modelSwitch` | messages from `model-selection` | yes |
| `timeContext` | messages from `time-context` | yes |
| `approvalNotice` | messages from `user-approval` | yes |
| `workingDirectoryNotice` | messages from `working-directory` | yes |
| `planModeNotice` | messages from `plan-mode` | yes |
| `repeatToolReminder` | messages from `repeat-tool-reminder` | yes |
| `agentInstructions` | messages from `agent-instructions` | yes |
| `skillCatalog` | messages from `skill-catalog` | yes |
| `tmuxContext` | messages from `tmux-context` | yes |
| `workingDirectory` | section `working-directory:current` | no; the section is required |
| `sandboxPolicy` | section `sandbox:policy` | yes |
| `approvalPolicy` | section `approval:policy` | yes |
| `subagentDelegation` | section `subagent:delegation` | yes |
| `harnessSource` | section `harness:source` | yes |
| `webSurface` | section `app:web-surface` | yes |

A message or section no row names, including a person's own prompt, passes through unchanged. A row whose producer is not composed has no effect.

### Configure

Each row owns `<row>Enabled` (default `true`; absent for `workingDirectory`) and `<row>Text` (default `''`). Every field is volatile.

```yaml
- id: context-injections
  name: '@deepseek-ai/dsh-context-injections'
  config:
    modelSwitchEnabled: false
    timeContextText: 'Clock: {{text}}'
    sandboxPolicyEnabled: false
```

An empty `<row>Text` sends the original text. Otherwise the text replaces it, and every `{{text}}` in it stands for the original; nothing else in it is interpreted, so other braces reach the model as written. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-context-injections) lists every field.

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
| [`src/rows.ts`](src/rows.ts) | The row table and the field-name rules |
| [`src/transform.ts`](src/transform.ts) | Pure drop and rewrite of messages and sections |
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

With the shipped defaults, every injection except the model-switch notice, unchanged. A switched-off notice is absent from the request and the log. A switched-off section is absent from the `<system-reminder>` runtime-context snapshot. A row with replacement text shows that text, with `{{text}}` expanded to what the producer wrote.

#### Token effect

Removed or replaced rather than added: a switched-off injection saves its tokens, and replacement text costs its own length instead of the original's.

#### KV Cache effect

Injections are appended at the history tail, so a change never rewrites earlier messages. A changed section switch or text produces one new runtime-context snapshot at the next step.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A fixed row table** — rows name the injections that are context about the session; content a session depends on, such as subagent results, team messages, job output, schedules, skill invocations, session references, compaction summaries, goal wrap-ups, hook output, PTC environment resets, tool availability changes, and Cordis plugin failures, has no row. Third-party plugins' injections and the experimental timeline plugin's required `timeline:*` sections have no row either. A new producer needs a row added here and on the settings page.
- **No producer variables** — replacement text sees only the producer's finished text as `{{text}}`, not the values it was built from, such as the model names in a switch notice.
- **The system prompt is out of scope** — system-prompt sections are edited through prompt presets.
- **Producers keep trying** — a producer that records its own injections, such as the time reading or project instructions, offers a dropped injection again at later steps; each is dropped again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative; shipped behavior lives in the sections above and the package code.

- **Row table duplication** — the settings page spells the row ids again because a client package cannot import a Host package; a test keeps both tables in step.

</details>
