# Agent Note: The authorization seam reaches the browser

Status: implemented

English | [中文](2026-09-11-authorization-remote-namespace.zh.md)

## Problem

`ctx.authorization` had exactly one consumer in the repository: `dsh-llm-pi-ai`, which registers a flow per installed provider that ships a login. Nothing called `begin()`. A service reaches a browser page only through a hand-written `TypertRemoteService` in `packages/api/*` — `credentials` has `CredentialsController`, `settings` has `SettingsController` — and authorization had none, so no surface this repository ships could start a sign-in. Every OAuth login pi-ai implements (Anthropic, OpenAI Codex, OpenRouter, xAI, Kimi) was unreachable, and the Models page could only offer the api-key field, which those providers do not accept.

The obstacle is not plumbing but shape. The other namespaces are request/response: a page asks, the Host answers, the call ends. A flow is a conversation — it reports a page to open, then asks what the human found there — and the human's part of it happens in a different browser tab, over an unbounded interval. A namespace that could only return a value had nothing to model that with.

## Decision

`AuthorizationController` owns the `authorization` namespace beside the other two in `dsh-api-settings-controller`. One `begin(key, method)` call **is** the attempt: it stays open for the whole conversation and settles with the seam's own outcome, so abandoning the call — a closed tab, a navigated-away page — aborts its signal and withdraws the attempt with no extra bookkeeping. What the flow says meanwhile leaves as three forwarded Cordis events (`api-authorization/notice`, `/prompt`, `/prompt-closed`), and the page answers each question with its own `answer(attempt, prompt, value)` call. The attempt and prompt ids are what tie the three wire pieces together, so a page running two sign-ins cannot answer the wrong question, and answering a question that is no longer open is refused rather than ignored.

`cancel(key)` exists beside the call's own signal because a Cancel button is a new request: the page pressing it holds no handle on the call it is cancelling. `list()` answers an empty list — not a failure — when no seam is mounted, so a deployment without one renders no sign-in rather than an error nobody can act on.

The browser half is a section of the Models page: `SignInStore` turns the three wire pieces into one renderable state per flow, and `SignInSection` renders the rows after the provider list. The rows are keyed by flow, not by provider route, because the seam is provider-neutral — one registration serves Z.AI, Anthropic, and Codex alike. The section renders nothing when no flow is registered, and the page's `signIn` prop is optional so a shell that injects none renders the page without the rows rather than not at all.

## Alternatives considered

**Reuse `ctx.userQuestions` for the prompts.** It already forwards a waterfall to the browser and has a UI that answers it, which would have removed most of the client work. It loses because that seam is agent-scoped: its answerers hang off a live agent's runtime root, and its UI is the chat's ask-user card. A sign-in started from Settings has no agent, and routing its questions into the conversation view would put them where the human is not looking.

**Return an attempt id from `begin` and poll for state.** A short call is easier to reason about on a request/response transport and survives a dropped connection. It loses on the thing that matters: the flow's own `AbortSignal` would no longer be tied to the caller, so a closed page would leave an attempt running until something else noticed, and the seam's one-attempt-per-key rule would start wedging on abandoned attempts. Holding the call makes the browser's liveness the attempt's liveness.

**A CLI sign-in command instead.** Much smaller, and enough to obtain a credential once. It loses because the surface people actually configure providers on is the Models page; a credential obtainable only from a terminal is not one a desktop user can get.

**Put the rows on each provider card through `settings.models.provider-card`.** More discoverable than a section, and that slot exists for adapter-family extras. It loses because the slot is the seat for plugins distributed *outside* this repository, and filling it from the package that declares it inverts the contract. A section keyed by flow also serves flows whose key names no configurable provider row.

## Consequences

Every login pi-ai ships becomes reachable, not only the Z.AI one this was built for: the Models page now lists whatever `ctx.authorization` holds. The cost is a namespace whose calls are long-lived, which is new for this Gateway — a sign-in occupies one request for as long as the human takes, and a transport that times out idle requests would break it in a way the short namespaces never showed.

`dsh-api-settings-controller` grows a third namespace and two new dependencies (the authorization seam and the uuid utility), and `dsh-api-remotes` forwards three more events. The client page gains a store and a section behind an optional prop, so its existing suites mount unchanged.
