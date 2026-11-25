---
kind: upgrade-guide
description: "pi-ai 1.6.0 removes chat model IDs and lowers token limits for some models."
---

# pi-ai 1.6.0 model catalog changes

English | [中文](guide.zh.md)

## Change

The following chat models leave the pi-ai catalog in 1.6.0. Stored `modelOverrides` for these IDs report a missing catalog model. New overrides require an ID present in the catalog. Explicit `models` entries for removed IDs lose their catalog defaults.

| Provider | Removed model IDs |
|---|---|
| `fireworks` | `accounts/fireworks/models/gpt-oss-120b`, `accounts/fireworks/models/inkling`, `accounts/fireworks/models/nemotron-3-ultra-nvfp4`, `accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b` |
| `nvidia` | `deepseek-ai/deepseek-v4.1-flash`, `google/diffusiongemma-26b-a4b-it`, `meta/llama-3.2-11b-vision-instruct`, `meta/llama-3.2-90b-vision-instruct`, `mistralai/mistral-7b-instruct-v0.3`, `moonshotai/kimi-k2.6`, `nvidia/llama-3.1-nemotron-70b-instruct`, `nvidia/llama-3.1-nemotron-ultra-253b-v1`, `openai/gpt-oss-20b` |
| `opencode-go` | `glm-5.2` |
| `opencode` | `gemini-3-flash`, `gemini-3.1-pro`, `glm-5`, `glm-5.1`, `glm-5.2`, `glm-5.3-flash-free` |
| `openrouter` | `bytedance-seed/seed-1.6`, `bytedance-seed/seed-1.6-flash`, `bytedance-seed/seed-2.0-code`, `cohere/north-mini-code:free`, `inception/mercury-2`, `inception/mercury-2.5`, `inception/mercury-3`, `liquid/lfm-2.5-2.6b`, `liquid/lfm-2.5-2.6b:free`, `minimax/minimax-m1`, `minimax/minimax-m2`, `minimax/minimax-m2.1`, `qwen/qwen-2.5-7b-instruct`, `qwen/qwen3-vl-30b-a3b-thinking`, `stepfun/step-3.5-flash`, `thinkingmachines/inkling-small:free`, `thinkingmachines/inkling:free`, `x-ai/grok-build-0.1`, `xingchen-agi/xing4.0-29b-a4b:free` |
| `qwen-token-plan-cn` | `deepseek-v3.2`, `deepseek-v4-flash` |
| `qwen-token-plan` | `deepseek-v3.2`, `deepseek-v4-flash` |
| `vercel-ai-gateway` | `alibaba/qwen-3-235b`, `alibaba/qwen3-coder`, `alibaba/qwen3-next-80b-a3b-thinking`, `bytedance/seed-1.6`, `bytedance/seed-1.8`, `google/gemini-3.5-flash-batch`, `google/gemini-3.7-flash-batch`, `inception/mercury-2`, `inception/mercury-2.5`, `inception/mercury-coder-small`, `meituan/longcat-2.5-preview`, `minimax/minimax-m2`, `minimax/minimax-m2.1-lightning`, `minimax/minimax-m2.5-highspeed`, `minimax/minimax-m2.7-highspeed`, `nvidia/nemotron-3-nano-30b-a3b`, `poolside/laguna-s-2.1`, `spacexai/grok-build-0.1`, `xiaomi/mimo-v2.5`, `xiaomi/mimo-v2.5-pro` |

The following catalog limits decrease. Values are tokens. A dash means that limit did not decrease.

| Provider/model | Context window | Maximum output |
|---|---:|---:|
| `huggingface/thinkingmachines/Inkling-Small` | — | 524288 |
| `mistral/ministral-3b-2512` | — | 131072 |
| `openrouter/deepseek/deepseek-r1-0528` | 128000 | 32000 |
| `openrouter/deepseek/deepseek-v4-flash` | — | 393216 |
| `openrouter/deepseek/deepseek-v4-flash-vision-exp` | 1048575 | — |
| `openrouter/google/gemma-3-27b-it` | — | 16384 |
| `openrouter/meta-llama/llama-3.1-70b-instruct` | — | 8192 |
| `openrouter/meta-llama/llama-3.1-8b-instruct` | — | 16384 |
| `openrouter/meta-llama/llama-3.3-70b-instruct` | 128000 | — |
| `openrouter/minimax/minimax-m2.5` | 196608 | — |
| `openrouter/minimax/minimax-m2.7` | 196608 | — |
| `openrouter/nvidia/nemotron-3-super-120b-a12b` | 262144 | 16384 |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b` | — | 16384 |
| `openrouter/qwen/qwen3-235b-a22b-2507` | 131072 | — |
| `openrouter/qwen/qwen3.5-397b-a17b` | — | 81920 |
| `openrouter/z-ai/glm-5.3-flash:batch` | 1048575 | — |
| `openrouter/z-ai/glm-5.3:batch` | 1048575 | — |
| `radius/glm-5.3` | — | 128000 |
| `radius/grok-4.7` | — | 450000 |
| `vercel-ai-gateway/alibaba/qwen3-next-80b-a3b-instruct` | — | 32768 |
| `vercel-ai-gateway/alibaba/qwen3.8-27b` | 262144 | — |
| `vercel-ai-gateway/minimax/minimax-m2.5` | — | 8192 |
| `vercel-ai-gateway/minimax/minimax-m2.7` | 196608 | — |
| `vercel-ai-gateway/minimax/minimax-m3.1-flash` | 1000000 | 524288 |
| `vercel-ai-gateway/moonshotai/kimi-k3.1-pro` | 1000000 | — |
| `vercel-ai-gateway/stepfun/step-5-preview` | 1000000 | 1000000 |

On a custom OpenAI-compatible Chat Completions gateway, reasoning models now send instructions with the `system` role by default. A gateway that requires `developer` needs an explicit override.

## Migration

1. In Settings → Models, select a supported replacement for each removed ID you use.
2. In `cordis.patch.yml`, remove obsolete `providers.<provider>.modelOverrides.<id>` entries and update IDs in `providers.<provider>.models`. Adjust prompt and output budgets for models with lower limits.
3. If your gateway requires developer-role instructions, set `compat.supportsDeveloperRole: true` on its route or model.
4. Start the profile, confirm its model has no configuration diagnostic and send a short prompt.
