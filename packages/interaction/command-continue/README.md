---
description: "The /continue command for interactive compositions: resume an interrupted turn without sending a new message."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-continue

English | [中文](README.zh.md)

## Summary

`dsh-command-continue` adds a `/continue` command to chat UIs and terminal front doors: when the last turn stopped short — a provider error, a network drop, a stop, a crash, the output cap, or a fork cut mid-turn — type it and the agent picks the work up again from the logged history, without you sending the model a "continue" message. A turn that completed normally has nothing to continue, and the command says so.

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

Type `/continue` after a turn was interrupted. The shipped `dsh` base mounts the command globally beside the command registry, so the Web composer and terminal front doors such as dsh-TUI offer it without further composition.

### Using the command

| Input | Result |
|---|---|
| `/continue` after an unfinished turn | `Continuing where the last turn stopped.` — a new turn starts whose first step adds no message, so the model is asked again from the history as it stands. |
| `/continue` when nothing is unfinished | `Cannot continue: <reason>.` — for example a completed last turn, a running session, or a session with no turn. |
| `/continue <anything>` | `Usage: /continue (no arguments)` |

After a stop that left part of a reply, that partial reply stays in history and the model continues from it; after an error, a crash, or a fork the history ends at the last user message or tool result, so the request is asked again cleanly. The Web client also shows a **Continue** button under the last turn when it is resumable; both paths call the same resume policy.

### Composing the command

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-continue
  name: '@deepseek-ai/dsh-command-continue'
```

The receiving Agent must implement the optional `Agent.resume()`, which the shipped agent loop does.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The handler reads `resumeDecision(agent)` from `@deepseek-ai/dsh-agent`, the one policy the Session Controller's `session.resume` Remote also uses: the Agent must implement `resume`, be idle, and have a last `turn/end` whose reason is `error`, `aborted`, `interrupted`, `max-tokens`, or `forked`. A resumable decision carries the bound `resume` action; the handler calls it and settles at once, and the resumed turn runs after the command's own lifecycle records. The loop's `resume()` lets that turn's first step admit no message, which an ordinary wake would close without a model call.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `/continue` registration, argument rejection, resume dispatch |
| — | No runtime invariant companion is published; this command adapter owns no state or event stream; the agent loop owns the resumed turn and the command registry owns registration and dispatch lifecycle. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Commands package](../commands/README.md) — the registry and dispatch contract behind chat commands.
- [Agent loop](../../core/agent-loop/README.md) — how a resumed turn steps without a new message.
- [Session Controller](../../api/session-controller/README.md) — the `session.resume` Remote behind the Web Continue button.

-----

<a id="model-experience"></a>
## Model Experience

### Resumed turn

#### What the model sees

No new message: the request is the logged history as it stands, ending at the last `user/message`, the `tool/result` batch, or the `assistant/message` a stop left marked `interrupted`. The slash input and its result never enter a model request.

#### Token effect

One ordinary request over the existing history; nothing is added to it.

#### KV Cache effect

An unchanged surface continues the request series, so the prefix cache is reused; a changed system prompt or tool set behaves as on any other step.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


- **Partial replies depend on the provider** — after a stop that left part of a reply, the request ends with an assistant message; providers that refuse a trailing assistant message fail that turn, which you can then continue again or answer normally.
- **Idle only** — `/continue` refuses while a turn is running; stop it first.
- **Command adapters only** — surfaces without `ctx.commands` use the Session Controller Remote instead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative; shipped behavior lives in the sections above and the package code.

- **No durable marker** — a resumed turn is recognizable only by its first step having no `user/message`; a dedicated marker event would let renderers label it.

</details>
