# Agent Note: Contributed pi-ai logins, and the Z.AI GLM Coding Plan sign-in

Status: implemented

English | [中文](2026-09-11-contributed-pi-ai-logins.zh.md)

## Problem

A model vendor can offer a browser sign-in that the upstream pi-ai catalog does not implement. Z.AI is the case that forced the question: `@earendil-works/pi-ai` ships a `zai` provider whose only authentication is an api key read from a stored credential or `ZAI_API_KEY`, while a GLM Coding Plan subscriber's credential is obtained by signing in at `chat.z.ai` and minting a key from the resulting token. Waiting for upstream is not a plan — the flow exists in a downstream fork of pi-ai's source and not in any published version — so the harness needs a way to add one vendor's sign-in without forking the adapter.

The authorization seam makes that a structural question rather than a packaging preference. It allows exactly one flow per credential record, and `dsh-llm-pi-ai` already claims `llm-pi-ai/<provider id>` for every installed route. A second plugin registering a flow for `llm-pi-ai/zai` is refused with `DUPLICATE_FLOW`; a plugin registering its own record under its own scope holds a credential the `zai` route never reads. The only key pi-ai's `zai` provider authenticates with is the one `dsh-llm-pi-ai` stores.

## Decision

`dsh-llm-pi-ai` exposes `contributePiAiLogin(ctx, contribution)`: another plugin adds one login **method** to the flow this package already registers for an installed route, naming the route, the method id and label, and a `run(session)` that resolves with `{ apiKey }`. The adapter writes the record; the contributor never touches the credential plane, so `dsh-llm-pi-ai` remains the single writer of every record written in its format, and a contribution carries no pi-ai type at all.

A route's flow is re-registered when its contributed set changes, which withdraws an attempt already running for it — a picker must not offer a method the running flow cannot serve. Contributed methods sit ahead of pi-ai's own api-key prompt and behind pi-ai's own OAuth, so a surface that runs a flow's first method reaches a browser conversation when one exists. The contribution registry is keyed weakly by context root, so two compositions in one process never see each other's contributions, and each contribution is registered through `ctx.effect`, so it leaves with its plugin. Contributing to a route pi-ai does not ship refuses with `UNKNOWN_PI_AI_ROUTE`, a colliding method id with `DUPLICATE_LOGIN_METHOD`, and a run that resolves with an empty key fails the attempt with `EMPTY_CONTRIBUTED_KEY` rather than reporting an authorization that stored nothing.

`@deepseek-ai/dsh-llm-zai-coding-plan` is the first consumer and owns the Z.AI protocol end to end: the authorization code from `chat.z.ai`, the token exchange at `zcode.z.ai`, the business login and key provisioning at `api.z.ai`, and the loopback listener on port 54548 raced against a pasted redirect. It has no configuration. The port is fixed because Z.AI matches the redirect against the address its own desktop client registers, and the minted key is named `deepseek-harness` so signing in twice reuses one key and revoking it never disturbs a key another client made.

## Alternatives considered

**Implement the Z.AI sign-in inside `dsh-llm-pi-ai`.** The smallest diff, and the one the credential-ownership rule points at, since that package owns the record. It loses because the package is the pi-ai boundary — its whole contract is that nothing pi-ai-specific escapes and nothing vendor-specific enters — and one vendor's private endpoints in it would make the next vendor's a precedent rather than a decision.

**Ship a separate package with its own route.** A plugin registering a flow for a route key pi-ai does not ship (`zai-coding-plan`, mirroring the upstream fork's provider id) needs no change to the adapter at all. It loses on the model catalog: `buildProvider` inherits endpoint, protocol, and models only when the route key *is* a pi-ai catalog id, so such a route must hand-declare `api`, `baseURL`, and the whole GLM model table — a copy that drifts from pi-ai's own `zai` catalog on every upgrade, and a second set of GLM models in the user's model picker.

**Upgrade `@earendil-works/pi-ai`.** Checked rather than assumed: `zai-coding-plan` is absent from every published version through 0.85.1 — the provider data ships `zai` and `zai-coding-cn` only, `zai.js` declares `envApiKeyAuth`, and `dist/auth/oauth/` holds no Z.AI flow. The implementation lives in a downstream fork of pi-ai's source, so no upgrade delivers it.

**Let the contribution return pi-ai's own `Credential` union.** Rejected for want of a consumer: every login that could be contributed today ends in an api key, and widening the contract to a union the contributor would have to import from pi-ai reintroduces exactly the coupling this seam removes. A contributed OAuth grant is one field addition away when something needs one.

**Paste-only, with no loopback listener.** Simpler, and correct for a harness a human reaches over the network. It loses the common case: on a local install the redirect completes the sign-in with nothing for the human to copy. Racing the two costs one `AbortController` and the seam already defines prompt withdrawal for exactly this.

## Consequences

A vendor sign-in is now an ordinary package: `dsh-llm-zai-coding-plan` is ~350 lines that know nothing about pi-ai, and the next one copies its shape. The cost is a public extension point on `dsh-llm-pi-ai` that must stay compatible, and one behavior change on the `zai` route — its flow's first method becomes the browser sign-in wherever this plugin is mounted, so a surface that silently runs the first method opens a browser where it previously prompted for a key.

Z.AI's endpoints are private ones mirrored from its desktop client. No test reaches Z.AI: `tests/fake-zai.ts` answers the whole sequence and `tests/composition.spec.ts` boots the shipping composition through the Loader, so a change on Z.AI's side is found by a human signing in rather than by CI. `zai-coding-cn` (`open.bigmodel.cn`) is deliberately not served; that deployment still enters a key by hand.
