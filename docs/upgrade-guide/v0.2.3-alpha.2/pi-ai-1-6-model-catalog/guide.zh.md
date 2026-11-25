---
kind: upgrade-guide
description: "pi-ai 1.6.0 移除了部分聊天模型 ID，并降低了部分模型的 token 上限。"
---

# pi-ai 1.6.0 模型目录变更

[English](guide.md) | 中文

## 变更

pi-ai 1.6.0 的目录移除了以下聊天模型。已保存的 `modelOverrides` 若引用这些 ID，会提示目录中找不到模型。新增覆盖配置须使用目录中已有的 ID。显式声明的 `models` 条目若引用已移除的 ID，将失去目录默认值。

| 提供商 | 已移除的模型 ID |
|---|---|
| `fireworks` | `accounts/fireworks/models/gpt-oss-120b`, `accounts/fireworks/models/inkling`, `accounts/fireworks/models/nemotron-3-ultra-nvfp4`, `accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b` |
| `nvidia` | `deepseek-ai/deepseek-v4.1-flash`, `google/diffusiongemma-26b-a4b-it`, `meta/llama-3.2-11b-vision-instruct`, `meta/llama-3.2-90b-vision-instruct`, `mistralai/mistral-7b-instruct-v0.3`, `moonshotai/kimi-k2.6`, `nvidia/llama-3.1-nemotron-70b-instruct`, `nvidia/llama-3.1-nemotron-ultra-253b-v1`, `openai/gpt-oss-20b` |
| `opencode-go` | `glm-5.2` |
| `opencode` | `gemini-3-flash`, `gemini-3.1-pro`, `glm-5`, `glm-5.1`, `glm-5.2`, `glm-5.3-flash-free` |
| `openrouter` | `bytedance-seed/seed-1.6`, `bytedance-seed/seed-1.6-flash`, `bytedance-seed/seed-2.0-code`, `cohere/north-mini-code:free`, `inception/mercury-2`, `inception/mercury-2.5`, `inception/mercury-3`, `liquid/lfm-2.5-2.6b`, `liquid/lfm-2.5-2.6b:free`, `minimax/minimax-m1`, `minimax/minimax-m2`, `minimax/minimax-m2.1`, `qwen/qwen-2.5-7b-instruct`, `qwen/qwen3-vl-30b-a3b-thinking`, `stepfun/step-3.5-flash`, `thinkingmachines/inkling-small:free`, `thinkingmachines/inkling:free`, `x-ai/grok-build-0.1`, `xingchen-agi/xing4.0-29b-a4b:free` |
| `qwen-token-plan-cn` | `deepseek-v3.2`, `deepseek-v4-flash` |
| `qwen-token-plan` | `deepseek-v3.2`, `deepseek-v4-flash` |
| `vercel-ai-gateway` | `alibaba/qwen-3-235b`, `alibaba/qwen3-coder`, `alibaba/qwen3-next-80b-a3b-thinking`, `bytedance/seed-1.6`, `bytedance/seed-1.8`, `google/gemini-3.5-flash-batch`, `google/gemini-3.7-flash-batch`, `inception/mercury-2`, `inception/mercury-2.5`, `inception/mercury-coder-small`, `meituan/longcat-2.5-preview`, `minimax/minimax-m2`, `minimax/minimax-m2.1-lightning`, `minimax/minimax-m2.5-highspeed`, `minimax/minimax-m2.7-highspeed`, `nvidia/nemotron-3-nano-30b-a3b`, `poolside/laguna-s-2.1`, `spacexai/grok-build-0.1`, `xiaomi/mimo-v2.5`, `xiaomi/mimo-v2.5-pro` |

下列模型的目录上限降低。数值以 token 为单位，横线表示该项上限没有降低。

| 提供商/模型 | 上下文窗口 | 最大输出 |
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

对于自定义的 OpenAI 兼容 Chat Completions 网关，推理模型现在默认使用 `system` 角色发送指令。要求 `developer` 角色的网关需要显式配置。

## 迁移

1. 在「设置 → 模型」中，为正在使用的已移除 ID 选择替代模型。
2. 在 `cordis.patch.yml` 中删除失效的 `providers.<provider>.modelOverrides.<id>`，并更新 `providers.<provider>.models` 中的 ID。对于上限降低的模型，调整提示词和输出预算。
3. 如果网关要求使用 developer 角色发送指令，在对应路由或模型上设置 `compat.supportsDeveloperRole: true`。
4. 启动配置，确认模型没有配置诊断，并发送一条简短提示词。
