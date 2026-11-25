---
kind: upgrade-guide
description: "pi-ai 1.6.1 removes chat model IDs and reduces token limits or reasoning options on some routes."
---

# pi-ai 1.6.1 chat model catalog changes

English | [中文](guide.zh.md)

## Change

DSH reports a missing catalog model when a saved `modelOverrides` entry names a removed ID. New overrides must name an ID in that provider's catalog. An explicit `models` entry for a removed ID loses the defaults it inherited from that catalog entry.

Each provider/model ID counts separately. The last two columns count IDs present in both versions. An ID can have both limits reduced.

| pi-ai upgrade | IDs added | IDs removed | Smaller context window | Lower maximum output |
|---|---:|---:|---:|---:|
| 1.5.0 to 1.6.0 | 169 | 63 | 14 | 16 |
| 1.6.0 to 1.6.1 | 63 | 65 | 12 | 13 |
| 1.5.0 to 1.6.1 | 230 | 126 | 22 | 24 |

In 1.6.0, `qwen-token-plan` and `qwen-token-plan-cn` dropped `deepseek-v3.2` and `deepseek-v4-flash`. In 1.6.1, both cut the output limit for `kimi-k2.7-code` from 262,144 to 16,384 tokens.

In 1.6.1, `openai` and `azure` each drop the same ten IDs, including `gpt-5-chat-latest` and `o4-mini`. On `opencode` and `opencode-go`, `longcat-2.5-free` appeared only in 1.6.0.

On `huggingface`, `MiniMaxAI/MiniMax-M2.5` drops from 204,800 context tokens and 131,072 output tokens to 65,536 for each in 1.6.1. On `openrouter`, `meta-llama/llama-3.1-8b-instruct` regains its 1.5.0 output limit of 117,964 after a limit of 16,384 in 1.6.0.

In 1.6.1, `radius/balanced` gains the `medium` and `xhigh` reasoning levels and loses `max`. GitHub Copilot's `claude-sonnet-5.5` loses `off`. Google Generative AI and Vertex now recognize vendor-prefixed Gemini 3+ IDs when detecting strict tool support.

Since 1.6.0, reasoning models on custom non-OpenAI Chat Completions routes use the `system` role for instructions by default.

## Migration

1. Find `chat:<id>` in your provider's JSON file to check the ID, `contextWindow`, and `maxTokens`. Compare the published catalogs for [1.5.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.5.0/dist/providers/data/), [1.6.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.0/dist/providers/data/), and [1.6.1](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.1/dist/providers/data/).
2. In Settings → Models, select a replacement your provider serves. For example, on `mistral`, replace `mistral-medium-3.5` with `mistral-medium-2604` or `mistral-medium-latest`.
3. In `cordis.patch.yml`, remove obsolete `providers.<provider>.modelOverrides.<id>` entries and update IDs under `providers.<provider>.models`. Adjust prompt and output budgets to the new limits and select a supported reasoning level.
4. If your Chat Completions gateway requires `developer`, set `compat.supportsDeveloperRole: true` on the route or model. Start the profile, confirm the selected model has no configuration diagnostic, and send a short prompt.
