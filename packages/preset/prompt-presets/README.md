---
description: "User-owned system-prompt override presets for users and maintainers choosing, authoring, or debugging a session's prompt transforms."
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-presets

English | [中文](README.zh.md)

## Summary

`dsh-prompt-presets` lets a person own the system prompt their sessions run under. A preset is a named, ordered rule stack: add text before or after the assembled prompt, replace it outright, remove sections by name, or rewrite matching text. A session switches presets at any point. The transform is the prompt registry's single final override, running after every other contribution and after a `complete: true` section is restored, so what a preset produces is what the model receives. Writes are bounds-checked; a rule that still cannot run at assembly is skipped with a warning rather than failing the turn.

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

Mount this row wherever agents run and a settings provider is composed; it provides `ctx.promptPresets`, the store every preset is read from and written to. Without a settings provider the row never activates, because a preset store with nowhere to store presets is not a degraded mode worth running.

### Configure the roster

```yaml
- name: '@deepseek-ai/dsh-prompt-presets'
  config:
    default: ''
    presets:
      terse:
        name: Terse
        description: Short answers, no preamble.
        rules:
          - kind: append
            text: Answer in at most three sentences.
```

| Field | Default | Meaning |
|---|---|---|
| `presets` | `{}` | Every stored preset, keyed by id. Volatile: an edit reaches the running store without a remount |
| `default` | `''` | Preset stamped into a blank session; `''` stamps none. Volatile, as above |
| `protectedSections` | `['tools:ptc-only', 'tool:structured_output']` | Sections a `replace` keeps and a `remove` may not name |
| `maxPresets` | `64` | Most presets one deployment stores |
| `maxRules` | `32` | Most rules one preset carries |
| `maxPatternLength` | `512` | Longest accepted regular-expression source |
| `maxTextBytes` | `16384` | Largest accepted rule text, in UTF-8 bytes. The shipped base bundle raises it to `65536` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-prompt-presets) is the exhaustive source for every accepted field.

Presets are this entry's own Config, not a separate settings document. The editor writes them into the active profile's `cordis.patch.yml` through the settings forms, and the Loader commits the two volatile fields into the running store without remounting it. A deployment that composes no settings service still reads and applies presets; the roster reports `writable: false` and every write is refused with `prompt-preset/read-only`. Presets a bundle ships cannot be deleted through the store.

A `prompt-presets` section of the removed `$DSH_HOME/settings.yaml` is imported into this entry on the first boot after the upgrade, as every other section is.

### Write a rule stack

Rules apply in array order, and each one sees what the one before it produced — including a section it created.

| Kind | What it does |
|---|---|
| `prepend` | Adds one section ahead of everything, so its text opens the rendered prompt |
| `append` | Adds one section after everything, so its text closes the rendered prompt |
| `insert` | Adds one section directly behind the section `after` names; an anchor nothing carries warns and lands the text at the end |
| `replace` | Makes its text the whole prompt, keeping only protected sections |
| `remove` | Drops sections by exact name |
| `substitute` | Rewrites matching text; `sections` restricts it, and absent or empty means every section |

Rule text is literal by default. Set `interpolate: true` on a text rule to resolve `{{provider}}`, `{{model}}`, and `{{cwd}}` in it; leaving it off is what keeps a pasted prompt containing braces from failing a turn. `enabled: false` keeps a rule stored without applying it.

### Choose a preset for a session

`select(agent, id)` records the choice in the session log and the next assembled step renders under it; `select(agent, null)` goes back to the untransformed prompt. Unlike an agent preset there is no blank-session lock — swapping tools mid-conversation would strand logged tool calls, while the system prompt is a surface node the next step re-renders. A switch never rewrites what the model already saw; it applies from the next turn.

A blank session with no choice of its own is stamped with the deployment `default` when its agent is created, as an ordinary recorded selection, so a resumed or forked session rebuilds the preset it actually ran rather than whatever the default happens to be later.

Any front door that dispatches the command registry — the Web composer and terminal front doors alike — also gets `/prompt-preset` when [`dsh-commands`](../../interaction/commands/README.md) is composed:

| Line | Effect |
|---|---|
| `/prompt-preset` | Reports the session's preset, the default, and the stored ids. |
| `/prompt-preset <id>` / `/prompt-preset off` | Switches the receiving session, exactly as `select` does. |
| `/prompt-preset default <id>` / `/prompt-preset default off` | Changes the default for new sessions through the settings forms; read-only without a settings service. |

Terminal front doors that complete command arguments get Tab completion of these words — preset ids with their descriptions, `off`, and `default` — from [`src/completion.ts`](src/completion.ts), which registers with dsh-TUI's optional `tuiCommandTrees` service when one is mounted and reads the live roster on every request.

`off` and `default` are keywords, so a preset stored under either id is reachable only through the Remote API. The command is not `/preset`, because terminal front doors already use that name for agent presets and a registry command would shadow theirs.

### Preview before committing

`preview(agent, id, signal)` assembles twice for that session's own scope — once with no preset, once with the candidate — and returns both rendered prompts, the candidate's sections with the rule that created each, and everything the candidate could not do as written. The assemblies are marked as previews, so drawing one cannot disturb a step the session is running.

### What a rule cannot do

Writes fail loud: an unusable pattern, a flag outside `gimsu`, a bound exceeded, a removal naming a protected section, or a default naming an absent preset all reject with `prompt-preset/invalid`. Assembly is contained: a rule that still cannot run is skipped with a warning, the rest apply, and a preset whose result could not render is dropped for that assembly alone.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

Two decisions carry the package. The transform is registered through `ctx.systemPrompt.finalize()` rather than as a `system-prompt/assemble` listener, because a listener is neither last by contract nor able to outrank a registered `complete: true` section — the shipped `minimal` agent preset has one. And the preset a session runs is read from its durable `promptPreset` projection on every assembly rather than cached per agent, so resume and fork need no seeding code and the log is the only source.

One registration covers every session: the override is global and unscoped, and per-session behavior comes from reading each assembly's own agent. That also covers agents created before this row loaded.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service entry: `Config` with its two volatile fields, the final override, blank-session stamping, the `@Remote` face, the `/prompt-preset` command |
| [`src/completion.ts`](src/completion.ts) | `/prompt-preset` argument completion for terminal front doors, typed structurally against dsh-TUI's `tuiCommandTrees` |
| [`src/rules.ts`](src/rules.ts) | The rule vocabulary and `applyRules`, a pure transform over assembled sections |
| [`src/schema.ts`](src/schema.ts) | Runtime schemas plus the bounds and protections a schema cannot express |
| [`src/session.ts`](src/session.ts) | The `prompt-preset/selected` event and the `promptPreset` projection |
| [`src/types.ts`](src/types.ts) | Client-safe wire payloads, failure codes, and declaration merges |
| — | No runtime invariant companion is published: the diagnostics companion reports faults loudly, and this package's one cross-check is deliberately warn-only (see [The committed-prompt check](#the-committed-prompt-check)). |

### The committed-prompt check

The override returns the prompt; the loop renders it, replaces surface node 0, and the session commits it as `system/message`. The committed text therefore arrives through a path this package does not control, which makes it an independent reading of the guarantee the override makes.

The store keeps a digest of each prompt it produced for a session and compares the next committed `system/message` against them. A text matching none of them means something rewrote the prompt after the final override ran. It logs one warning per session and never interrupts: the step has already run by the time the message is committed, and failing a turn over a reporting mismatch would be worse than the mismatch. Digests, not prompts, are retained, and the set is dropped as soon as a commit has been checked. A preview records nothing — its assembly carries `preview: true`.

### The render probe

`substitute` is the one rule that can produce text the registry cannot render: it can inject `{{` into a section that does interpolate. The override therefore renders its own result before returning it and, on a throw, returns the untransformed assembly with a `render-failed` warning. A stored document must never be able to make a session unrunnable.

### Why warnings are codes

Apply-time and preview warnings travel as a discriminant plus the rule or section that located it, never as a sentence. Product copy is locale-owned, so the client renders the wording; `detail` carries only non-localizable engine text, such as a regular-expression compiler message.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the package-level contract is not enough.

- [System-prompt subsystem](../../../docs/subsystems/system-prompt.md) — the assembly this package overrides, and the `PromptFinalizer` seam it occupies.
- [agent-preset-registry package](../agent-preset-registry/README.md) — the other per-session choice, and why that one locks after the first turn.
- [persona package](../persona/README.md) — the composition-authored persona a preset can override.
- [Final override Agent Note](../../../.agents/notes/implemented/architecture/2026-09-18-prompt-final-override.md) — why one contribution may have the last word.
- [Prompt-presets Agent Note](../../../.agents/notes/implemented/architecture/2026-09-19-user-owned-prompt-presets.md) — why a rule stack, why selection is free, and why writes fail loud while assembly does not.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-prompt-presets) — every accepted field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### The prompt transform

#### What the model sees

Whatever the session's preset produces, and nothing else from the prompt registry. With no preset selected the model sees the assembly exactly as every other contribution built it. With one selected, the model sees that assembly after the preset's rules: text the rules added opens or closes the prompt, a `replace` leaves only the deployment's protected sections plus the rule's own text, a `remove` drops the named sections, and a `substitute` rewrites matching text in those that remain. The text is the user's, so this package pins none of it; the sections it creates are named `prompt-preset:<kind>-<index>` and their text is literal unless the rule asked for interpolation. A rule that cannot run is skipped and the model sees the rest of the stack applied; a result that could not render leaves the model seeing the untransformed prompt.

#### Token effect

Replaced rather than added: a preset decides the whole prompt, so the cost is its result rather than a delta. It is bounded by the deployment's `maxRules` and `maxTextBytes` for what rules add, and a `replace` can make the prompt smaller than it would otherwise be.

#### KV Cache effect

Prefix-stable while the selection and the preset's stored rules both stay put: an unchanged rendering leaves the system node untouched. A selection change, an edit to the selected preset, and a cleared selection each rewrite the rendered prompt, which the loop commits as a `system/message` replacement — invalidating reuse from the first changed token, and starting a new request series. Because a preset can rewrite the opening section, a change is more likely to move the earliest tokens than a contribution that only appends.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when a prompt preset is a poor fit. They are current package constraints, not a task backlog.

- **A rule anchors to a section, never to an order** — `insert` places text behind a section it names by exact string, so a preset that wants a position rather than a neighbour, or a match on part of a name, has no way to ask for it. There is also no `before`: put the text after the preceding section instead.
- **`remove` matches exact names only** — no prefix or glob, because the preview lists every name and a second pattern grammar would add the regular-expression safety surface again for no new reach.
- **No preview without a live agent** — a preview assembles for the session's own scope, and a scope with no agent leaves `{{model}}` and `{{cwd}}` unregistered, so rendering would throw. A settings surface previews against a session the user picks.
- **No execution budget on a pattern** — length, rule count, and text size are bounded, but Node cannot time out a regular expression, so a pathological pattern hangs the turn of the person who wrote it. That argument holds only while presets stay local to their author; importing or sharing them needs a real budget first.
- **A write pins the whole preset map into the profile** — a Cordis patch replaces a complete entry config, so after the first edit, presets a later bundle version adds do not reach this profile until the entry's override is reset. A bundle preset is still refused for deletion, read from the inherited layer rather than from the live value.
- **Rules reach the prompt, never the tool schemas** — hiding a tool is `ctx.tools.restrict()`, which keeps presentation, lookup, and execution aligned; a preset that removed a tool's guidance section would leave the tool callable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
