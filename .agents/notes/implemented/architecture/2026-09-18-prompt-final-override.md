# Agent Note: One contribution has the last word on the system prompt

Status: implemented

English | [中文](2026-09-18-prompt-final-override.zh.md)

## Problem

`ctx.systemPrompt` admits many contributions and resolves them cooperatively, which is right for the contributions it was built for: a tool registers its guidance section, a preset shadows the persona slot, a listener rewrites what the others produced. Nothing in that design lets one contribution be *decisive*, and a user-facing prompt override has to be.

Two mechanisms defeat a `system-prompt/assemble` listener that tries:

- **A registered `complete: true` section outranks every listener.** `assemble()` runs the waterfall, then restores the effective complete section as the sole section. The shipped `minimal` agent preset mounts `dsh-persona` with `complete: true`, so on that preset a listener's transform is discarded without a trace.
- **Listener nesting is registration order.** A waterfall listener is outer or inner depending on when its plugin loaded and whether it passed `prepend`; the last plugin to register with `prepend: true` speaks outermost. No contract makes any particular listener last, so "our transform wins" would hold by accident and stop holding when composition changes.

Below the registry there is no honest seam either: `agent/request` states outright that it cannot mutate messages, and rewriting the request in an `llm/stream` listener breaks **Model-visible ⟺ logged**, which a runtime invariant asserts.

A second, smaller problem blocks the same feature. Drawing a preview of "what would this override produce" means assembling again for a live agent's scope, and two listeners write per-agent state from their post-`next()` position: `installModelSelection` records the selection `agent/request` later reads, and `dsh-session-reference` records the route it prepares references against. A preview between a step's assembly and its request would hand that step a snapshot no prompt rendered under.

## Decision

`ctx.systemPrompt.finalize(provider)` registers **the** final override. It runs after the assembly waterfall, after an effective complete section has been restored, and after runtime-context suppression; what it returns is exactly what `assemble()` returns.

It is a sole-owner registration, not a second waterfall. A scoped override shadows a global one, exactly as a section name does, and a second registration in the same layer throws. `SoleEntry` in `@deepseek-ai/dsh-scope` holds it beside the `NamedEntries` and `AnonymousEntries` the other prompt tables use.

The finalizer owns preserving `tools`, `contexts`, and `variables` — the loop reads all three — and owns the validity of the sections it emits, because the invariant companion validates the waterfall's result and the finalizer runs after it.

`AssembleContext` gains `preview?: boolean`. It marks an assembly no request will use; `installModelSelection` and `dsh-session-reference` skip their per-agent writes when it is set and still return their normal transformed assembly, so a preview renders the same sections, tools, and variables a real step would.

## Alternatives considered

**A second waterfall, `system-prompt/finalize`.** More composable and more like the rest of the registry, and it reintroduces the exact defect: two finalize listeners have the same ordering ambiguity as two assemble listeners, so nothing would be decisive. Rejected because the property being bought is "exactly one contribution decides", and a registration-time error is how that becomes checkable rather than conventional.

**Take over the `complete` slot instead.** A scoped section registered under the same name as the preset's complete section would shadow it, with no core change. Rejected: it deletes the preset's persona even for an override that only prepends, it splits one feature across two mechanisms whose orderings disagree (a registered section is sorted; a listener is not), and a second complete section anywhere makes `assemble()` throw, failing the turn.

**Rewrite the request at the adapter.** Genuinely last before the wire, and it makes the log stop describing the request. Rejected on **Model-visible ⟺ logged**.

**Let the preview accept the stale writes as idempotent.** They usually are. Rejected because the failure they are not is a silently mis-routed model request, and the gate is three lines.

**Reuse the last live assembly instead of assembling again.** Avoids the core change entirely by caching what the finalizer last received, but it cannot answer for a session that has not stepped yet, and it shows the previous step's sections rather than the candidate's. Rejected as less accurate for the surface that exists to be accurate.

## Consequences

- Exactly one contribution can decide the delivered prompt for a given scope, and a composition that tries to add a second fails at registration rather than silently losing one.
- A `complete: true` section is no longer the end of the line: it is the input the override receives. A deployment-authored override outranks a preset's persona, which is the point.
- The invariant companion's coverage stops at the waterfall result. A finalizer that emits duplicate or empty section names is not caught there; its owner is responsible, as the API states.
- `finalize` is a deployment-authored seam, not a contribution mechanism. Ordinary plugins still register sections, which compose; the README says so, because a plugin reaching for `finalize` to add a paragraph would deny the slot to whoever actually needs it.
- Assemblies can now be drawn for inspection without disturbing a running agent, which is what makes a live prompt preview safe to ship.

## Testing

- `packages/core/system-prompt/tests/finalize.spec.ts` pins the override running after the waterfall, after the complete-section restore, and after runtime-context suppression; the returned value being authoritative; asynchronous providers; the duplicate refusal in the global and scoped layers with each layer's own diagnostic; scope shadowing in both directions; idempotent disposal restoring prior behavior; and the `system-prompt/change` emission on registration and disposal.
- `packages/core/scope/tests/store.spec.ts` (`SoleEntry`) pins the single retention, the refusal that leaves the retained value alone, and the spent undo that cannot clear a later registration.
- `packages/core/agent/tests/model-selection.spec.ts` (`renders a preview assembly without recording the route it snapshots`) and `packages/context/session-reference/tests/session-reference.spec.ts` (`ignores a preview assembly, so a drawn preview cannot change the prepared route`) pin the `preview` gate on both writes.
