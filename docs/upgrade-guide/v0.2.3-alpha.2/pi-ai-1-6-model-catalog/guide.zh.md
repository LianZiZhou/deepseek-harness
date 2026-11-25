---
kind: upgrade-guide
description: "pi-ai 1.6.1 移除了部分聊天模型 ID，降低了部分路由的 token 上限或减少了可选的推理级别。"
---

# pi-ai 1.6.1 聊天模型目录变更

[English](guide.md) | 中文

## 变更

已保存的 `modelOverrides` 条目若引用已移除的 ID，DSH 会提示目录中找不到该模型。新增覆盖配置须使用该提供商目录中已有的 ID。在 `models` 中显式声明的条目若引用已移除的 ID，将失去从该目录条目继承的默认值。

同一模型 ID 在不同提供商处分别计数。最后两列只统计两个版本中都存在的 ID。同一 ID 的两项上限都可能降低。

| pi-ai 升级版本 | 新增 ID 数 | 移除 ID 数 | 上下文窗口缩小的 ID 数 | 最大输出降低的 ID 数 |
|---|---:|---:|---:|---:|
| 1.5.0 至 1.6.0 | 169 | 63 | 14 | 16 |
| 1.6.0 至 1.6.1 | 63 | 65 | 12 | 13 |
| 1.5.0 至 1.6.1 | 230 | 126 | 22 | 24 |

1.6.0 中，`qwen-token-plan` 和 `qwen-token-plan-cn` 都移除了 `deepseek-v3.2` 和 `deepseek-v4-flash`。1.6.1 中，这两个提供商将 `kimi-k2.7-code` 的输出上限从 262,144 个 token 降至 16,384 个。

1.6.1 中，`openai` 和 `azure` 各自移除了相同的 10 个 ID，包括 `gpt-5-chat-latest` 和 `o4-mini`。`opencode` 和 `opencode-go` 的 `longcat-2.5-free` 只出现在 1.6.0 中。

1.6.1 中，`huggingface` 的 `MiniMaxAI/MiniMax-M2.5` 上下文窗口从 204,800 个 token 缩至 65,536 个，最大输出也从 131,072 个 token 降至 65,536 个。`openrouter` 的 `meta-llama/llama-3.1-8b-instruct` 在 1.6.0 中最多输出 16,384 个 token，1.6.1 恢复了 1.5.0 的上限 117,964 个。

1.6.1 为 `radius/balanced` 新增了 `medium` 和 `xhigh` 推理级别，移除了 `max`。GitHub Copilot 的 `claude-sonnet-5.5` 移除了 `off`。Google Generative AI 和 Vertex 在判断模型是否支持严格工具调用时，现在也能识别带厂商前缀的 Gemini 3 及更高版本的模型 ID。

从 1.6.0 起，自定义的非 OpenAI Chat Completions 路由上，推理模型默认使用 `system` 角色发送指令。

## 迁移

1. 在提供商的 JSON 文件中搜索 `chat:<id>`，核对 ID、`contextWindow` 和 `maxTokens`。对照已发布的模型目录 [1.5.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.5.0/dist/providers/data/)、[1.6.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.0/dist/providers/data/) 和 [1.6.1](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.1/dist/providers/data/)。
2. 在「设置 → 模型」中，选择提供商支持的替代模型。例如，在 `mistral` 上，将 `mistral-medium-3.5` 换成 `mistral-medium-2604` 或 `mistral-medium-latest`。
3. 在 `cordis.patch.yml` 中，删除失效的 `providers.<provider>.modelOverrides.<id>` 条目，并更新 `providers.<provider>.models` 中的 ID。根据新上限调整提示词和输出预算，并选择模型支持的推理级别。
4. 如果 Chat Completions 网关要求使用 `developer` 角色，在对应路由或模型上设置 `compat.supportsDeveloperRole: true`。启动配置，确认所选模型没有配置诊断，并发送一条简短提示词。
