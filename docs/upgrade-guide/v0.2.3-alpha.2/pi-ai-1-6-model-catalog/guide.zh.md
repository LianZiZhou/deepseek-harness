---
kind: upgrade-guide
description: "pi-ai 1.6–1.7 移除了部分聊天模型 ID，降低了部分路由的 token 上限或减少了可选的推理级别。"
---

# pi-ai 1.6–1.7 聊天模型目录变更

[English](guide.md) | 中文

## 变更

已保存的 `modelOverrides` 条目若引用已移除的 ID，DSH 会提示目录中找不到该模型。新增覆盖配置须使用该提供商目录中已有的 ID。`models` 中显式声明的条目会失去从已移除的 ID 继承的默认值。

同一模型 ID 在不同提供商处分别计数。最后两列只统计两个版本中都存在的 ID。1.6.1 补丁版中，共有 21 个 ID 至少降低了一项上限。

| pi-ai 升级版本 | 新增 ID 数 | 移除 ID 数 | 上下文窗口缩小的 ID 数 | 最大输出降低的 ID 数 |
|---|---:|---:|---:|---:|
| 1.5.0 至 1.6.0 | 169 | 63 | 14 | 16 |
| 1.6.0 至 1.6.1 | 63 | 65 | 12 | 13 |
| 1.5.0 至 1.6.1 | 230 | 126 | 22 | 24 |
| 1.6.1 至 1.7.0 | 43 | 38 | 2 | 6 |

1.7.0 中，Qwen Token Plan 将 `qwen4-max-preview` 替换为 `qwen4-max`。Ant Ling 移除了 Ling 和 Ring 2.6 模型。Bedrock 上的 Kimi K3 和 K3.1 在重放时省略此前的推理。

1.6.0 中，`qwen-token-plan` 和 `qwen-token-plan-cn` 都移除了 `deepseek-v3.2` 和 `deepseek-v4-flash`。1.6.1 中，这两个提供商将 `kimi-k2.7-code` 的输出上限从 262,144 个 token 降至 16,384 个。

1.6.1 中，`openai` 和 `azure` 移除了相同的 10 个 ID，包括 `gpt-5-chat-latest` 和 `o4-mini`。`opencode` 和 `opencode-go` 在 1.6.0 中新增了 `longcat-2.5-free`，又在 1.6.1 中移除了这个 ID。1.6.1 还在 `opencode-go` 上新增了 `longcat-2.5`。

1.6.1 中，`huggingface` 的 `MiniMaxAI/MiniMax-M2.5` 上下文窗口从 204,800 个 token 缩至 65,536 个，最大输出也从 131,072 个 token 降至 65,536 个。`openrouter` 的 `meta-llama/llama-3.1-8b-instruct` 在 1.6.0 中最多输出 16,384 个 token，1.6.1 恢复了 1.5.0 的上限 117,964 个。

1.6.1 为 `radius/balanced` 新增了 `medium` 和 `xhigh` 推理级别，移除了 `max`。Bedrock、Cloudflare AI Gateway 和 Vercel AI Gateway 上的部分 Claude Opus 5.5 和 Sonnet 5.5 条目移除了 `off`，GitHub Copilot 的 `claude-sonnet-5.5` 也移除了这个级别。

从 1.6.0 起，自定义 Chat Completions 网关上的推理模型默认使用 `system` 角色发送指令。提供商 ID 为 `openai` 或基础 URL 包含 `api.openai.com` 时，默认角色为 `developer`。

Google Generative AI 和 Vertex 路由使用 pi-ai 的 `compat.supportsStrictMode` 默认值。1.6.1 根据模型 ID 判断是否支持严格工具调用时，也能识别带厂商前缀的 Gemini 3 及更高版本。[pi-ai 更新日志](https://github.com/earendil-works/pi/blob/v1.6.1/packages/ai/CHANGELOG.md)

## 迁移

1. 在提供商的 JSON 文件中搜索 `chat:<id>`，核对 ID、`contextWindow` 和 `maxTokens`。对照已发布的模型目录 [1.5.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.5.0/dist/providers/data/)、[1.6.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.0/dist/providers/data/)、[1.6.1](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.6.1/dist/providers/data/) 和 [1.7.0](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.7.0/dist/providers/data/)。
2. 在「设置 → 模型」中，选择提供商支持的替代模型。例如，在 `mistral` 上，将 `mistral-medium-3.5` 换成 `mistral-medium-2604` 或 `mistral-medium-latest`。
3. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中，删除失效的 `providers.<provider>.modelOverrides.<id>` 条目，并更新 `providers.<provider>.models` 中的 ID。根据新上限调整提示词和输出预算。如果所选模型移除了路由中配置的 `reasoning` 级别，改用该模型支持的级别。
4. 如果 Chat Completions 网关要求使用 `developer` 角色，在对应路由或模型上设置 `compat.supportsDeveloperRole: true`。
5. 打开配置，确认所选模型没有配置诊断，并发送一条简短提示词。
