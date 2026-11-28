---
kind: upgrade-guide
description: "pi-ai 1.6–1.7 removes chat model IDs and reduces token limits or reasoning options on some routes."
---

# pi-ai 1.6–1.7 chat model catalog changes

English | [中文](guide.zh.md)

## Change

DSH reports a missing catalog model when a saved `modelOverrides` entry names a removed ID. New overrides require an ID in the provider's catalog. Explicit `models` entries lose any defaults inherited from removed IDs.

Each provider/model ID counts separately. The last two columns count IDs present in both versions. In the 1.6.1 patch, 21 IDs have at least one lower limit.

| pi-ai upgrade | IDs added | IDs removed | Smaller context window | Lower maximum output |
|---|---:|---:|---:|---:|
| 1.5.0 to 1.6.0 | 169 | 63 | 14 | 16 |
| 1.6.0 to 1.6.1 | 63 | 65 | 12 | 13 |
| 1.5.0 to 1.6.1 | 230 | 126 | 22 | 24 |
| 1.6.1 to 1.7.0 | 43 | 38 | 2 | 6 |

In 1.7.0, Qwen Token Plan replaces `qwen4-max-preview` with `qwen4-max`. Ant Ling retires its Ling and Ring 2.6 models. Bedrock Kimi K3 and K3.1 omit earlier reasoning on replay.

In 1.6.0, `qwen-token-plan` and `qwen-token-plan-cn` dropped `deepseek-v3.2` and `deepseek-v4-flash`. In 1.6.1, both cut the output limit for `kimi-k2.7-code` from 262,144 to 16,384 tokens.

In 1.6.1, `openai` and `azure` drop the same ten IDs, including `gpt-5-chat-latest` and `o4-mini`. Both `opencode` and `opencode-go` added `longcat-2.5-free` in 1.6.0 and drop it in 1.6.1. The patch adds `longcat-2.5` on `opencode-go`.

On `huggingface`, `MiniMaxAI/MiniMax-M2.5` drops from 204,800 context tokens and 131,072 output tokens to 65,536 for each in 1.6.1. On `openrouter`, `meta-llama/llama-3.1-8b-instruct` regains its 1.5.0 output limit of 117,964 tokens. In 1.6.0 it allowed 16,384.

In 1.6.1, `radius/balanced` gains the `medium` and `xhigh` reasoning levels and loses `max`. Some Claude Opus 5.5 and Sonnet 5.5 entries on Bedrock, Cloudflare AI Gateway, and Vercel AI Gateway lose `off`, as does GitHub Copilot's `claude-sonnet-5.5`.

Since 1.6.0, reasoning models on custom Chat Completions gateways use the `system` role for instructions by default. They default to `developer` if the provider ID is `openai` or the base URL contains `api.openai.com`.

Google Generative AI and Vertex routes use pi-ai's default for `compat.supportsStrictMode`. In 1.6.1, pi-ai recognizes vendor-prefixed IDs for Gemini 3 and later when detecting strict tool support. [pi-ai changelog](https://github.com/earendil-works/pi/blob/v1.6.1/packages/ai/CHANGELOG.md)

## Migration

1. Find `chat:<id>` in your provider's JSON file to check the ID, `contextWindow`, and `maxTokens`. Compare the published catalogs for [1.5.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.5.0/dist/providers/data/), [1.6.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.0/dist/providers/data/), [1.6.1](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.1/dist/providers/data/), and [1.7.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.7.0/dist/providers/data/).
2. In Settings → Models, select a replacement your provider serves. For example, on `mistral`, replace `mistral-medium-3.5` with `mistral-medium-2604` or `mistral-medium-latest`.
3. In `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, remove obsolete `providers.<provider>.modelOverrides.<id>` entries and update IDs under `providers.<provider>.models`. Adjust prompt and output budgets to the new limits. If the selected model drops your route's `reasoning` level, choose one it offers.
4. If your Chat Completions gateway requires `developer`, set `compat.supportsDeveloperRole: true` on the route or model.
5. Open the profile, check that the selected model has no configuration diagnostic, and send a short prompt.
