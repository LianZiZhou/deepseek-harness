---
description: "Z.AI GLM Coding Plan browser sign-in for users and maintainers who would rather not paste a Z.AI API key by hand."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-zai-coding-plan

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-zai-coding-plan` signs a human in to Z.AI's GLM Coding Plan through their browser and stores the key that comes out of it as the `zai` route's credential. Z.AI issues nothing an inference request can use directly: the browser conversation ends in a short-lived OAuth token, and the durable `id.secret` key is minted from it afterwards through Z.AI's business API. Because the product is an ordinary api key, this plugin contributes a login *method* to the flow [`dsh-llm-pi-ai`](../llm-pi-ai/README.md) already registers for its `zai` route rather than adding a provider — the models, the endpoint, and the stored record all stay that route's. It has no configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The [`dsh-base`](../../bundle/base/README.md) bundle mounts it beside the pi-ai adapter, so every base-backed profile already offers it: the method appears on the `zai` sign-in as **Sign in with Z.AI (GLM Coding Plan)**, ahead of pi-ai's own key prompt, so a surface that runs a flow's first method opens the browser. A profile composed by hand mounts the pair itself:

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      zai: {}
- name: '@deepseek-ai/dsh-llm-zai-coding-plan'
```

The route entry is what makes the signed-in models selectable; the plugin itself needs none, because signing in is what makes a route worth configuring. A composition that mounts no pi-ai adapter simply has no flow for the method to appear on.

### What the human does

1. A surface begins the `llm-pi-ai/zai` authorization with method `oauth`.
2. The plugin reports the `chat.z.ai` authorize page to open, and asks for the redirect address as a fallback in the same breath.
3. Whichever answer arrives first wins: a browser on this machine reaches the loopback listener on port 54548 and the question is withdrawn unanswered; a browser anywhere else ends on an unreachable address the human pastes back.
4. The plugin exchanges the code, mints the key, and the adapter stores it. The Z.AI console then lists a key named `deepseek-harness`.

Signing in again reuses that key rather than making another, so revoking it in the Z.AI console signs this harness out and leaves keys made by other clients alone.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Every endpoint below is one Z.AI's own desktop client calls; none is a published API, so a change on Z.AI's side is visible here as a failed sign-in rather than as a deprecation. The sequence is: authorization code from `chat.z.ai/api/oauth/authorize` (no PKCE), token exchange at `zcode.z.ai/api/v1/oauth/token` (a body carrying neither `grant_type` nor a verifier), business login at `api.z.ai/api/auth/z/login`, the account's default organization and project from `getCustomerInfo`, then find-or-create the key named `deepseek-harness` and read its secret back through the key collection's `copy` endpoint. The secret always comes from `copy`: the key list masks it, and a creation reply carries it only for some account states.

The loopback port is 54548 and is not configurable, because Z.AI matches the redirect against the address its own client registers — a port of this harness's choosing is refused at the authorize page, where the human can do nothing about it. Failing to bind that port is therefore a fallback to the pasted redirect, not a failed sign-in.

| Export | Role |
|---|---|
| `apply(ctx)` | Contributes the sign-in to the pi-ai `zai` route; the returned disposer withdraws it. |
| `runZaiSignIn(session, options?)` | Runs one sign-in and returns the minted key. `options` replaces the fetch implementation and the loopback port for tests. |
| `CALLBACK_PORT` | The registered loopback port, `54548`. |
| `KEY_NAME` | The name the minted key carries in the Z.AI console, `deepseek-harness`. |
| `ZaiSignInError` | Failure class; `code` is one of `ZAI_REJECTED`, `ZAI_HTTP`, `ZAI_NO_CODE`, `ZAI_STATE_MISMATCH`, `ZAI_NO_ACCESS_TOKEN`, `ZAI_NO_BUSINESS_TOKEN`, `ZAI_NO_PROJECT`, `ZAI_NO_KEY`, `ZAI_NO_SECRET`. |

<a id="model-experience"></a>
## Model Experience

None, as the sign-in only obtains the credential a request is authenticated with, and nothing it produces enters a model request as content.

#### KV Cache effect

Independent: this plugin issues no model request and changes no request prefix. A route whose credential changes sends the same prompt with a different header.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The endpoints are Z.AI's private ones** — the client id, the authorize page, the token body, and the whole business-API sequence mirror Z.AI's desktop client. Z.AI can change any of them without notice, and the sign-in then fails with the step that broke named in the error.
- **`zai-coding-cn` is not served** — the sign-in mints a key against `api.z.ai` only. A deployment on `open.bigmodel.cn` still enters its key by hand.
- **The key's name is fixed** — one account signing two harness installations in shares the single key named `deepseek-harness`, so revoking it signs both out.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The sign-in is verified against a routing fake rather than Z.AI itself: `tests/fake-zai.ts` answers the whole endpoint sequence, and `tests/composition.spec.ts` boots the shipping composition through the Loader to prove the method reaches the real flow. No test reaches Z.AI, so a change to their endpoints is caught by a human signing in, not by CI.

</details>
