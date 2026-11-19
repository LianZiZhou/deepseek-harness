# Agent Note: The loop gives injected context a last-word admission point

Status: implemented

English | [中文](2026-11-18-context-admission-events.zh.md)

## Problem

A person who wants to switch off an injected notice, such as the model-switch notice, needs one place that sees every injection before it is committed. `agent/pre-step` is not that place. A waterfall listener's nesting is its registration order, and `prepend: true` makes the most recent registration outermost. `installModelSelection` registers its prepended listener on each Agent's scope when that Agent is created, which is after every plugin has loaded, so a plugin-level `agent/pre-step` listener can never wrap it: the notice is appended outside any filter.

Runtime-context sections have the same gap at a different layer. `ctx.systemPrompt.refreshContext()` re-resolves each section from its provider before every attempt, so a rewrite made in `system-prompt/assemble` or in `finalize()` is replaced before the loop projects the snapshot.

## Decision

The loop dispatches two waterfalls at fixed points, after every contribution and before anything is committed:

- `agent/admit-messages` runs once per entered step, over the batch `agent/pre-step` returned.
- `agent/admit-context` runs over the rendered runtime-context sections before each projection, at step preparation and before every attempt, so the same answer reaches both projection sites.

Both are ordinary waterfalls, so several listeners compose. What a listener drops is never committed and what it rewrites is committed as rewritten, which keeps **Model-visible ⟺ logged**. Sections are admitted before the snapshot comparison, so a changed rule produces a new snapshot at the next step and a dropped section's changes produce none.

Injected context keeps the lifecycle [separate context injection](2026-07-24-separate-context-injection-from-turn-execution.md) gives it; admission only decides what an entered batch commits. `dsh-context-injections` is the first listener: a fixed table of rows, each a volatile switch and a template per text shape, prefilled with the producer's wording and its runtime values as variables.

## Alternatives considered

**Filter in `agent/pre-step` with `prepend: true`.** Works only while no listener registers later, and per-Agent listeners always do. Rejected because the property needed is "sees the final batch", which registration order cannot provide.

**Register the filter per Agent on `agent/created`.** Runs after `installModelSelection`, but any `agent/created` listener that registers a pre-step listener after it moves outside again. Rejected for the same reason.

**Configure each producer.** Every producer would own its own switch and template. It keeps policy beside the text, but a person would have to find a setting in each of many packages, and a producer without one stays unswitchable. Rejected as the primary mechanism; a producer can still offer its own configuration.

**Rewrite in the system-prompt registry.** Covers sections but not notices, and `refreshContext()` would have to apply the rewrite too. Rejected because messages are not the registry's concern.

**Rewrite at the adapter.** Last before the wire, and it makes the log stop describing the request. Rejected on **Model-visible ⟺ logged**.

## Consequences

- Changing `agent-loop` added two dispatches per step and one per attempt; with no listener each resolves to its fallback.
- A listener that drops an injection does not tell its producer. A producer that records its own injections, such as the time reading, offers a dropped one again at later steps.
- Dropping a section whose provider is `required` is possible here, which `suppressRuntimeContext()` never allows; `dsh-context-injections` keeps required sections and only rewrites their text.

## Testing

- `packages/core/agent-loop/tests/context-admission.spec.ts` drops and rewrites a notice appended by an outermost agent-scoped pre-step listener, empties a first step without a model call, and admits sections at preparation and on every attempt.
- `packages/context/context-injections/tests/plugin.spec.ts` drives the shipped rows through a real loop, including a setting changed between steps.
