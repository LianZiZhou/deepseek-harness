---
description: "preset 组地图：按会话的 agent 组装与系统提示词覆盖，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/preset

[English](README.md) | 中文

## 概述

preset 组提供一个会话为自己做出的两项选择。agent preset 是一个目录，内含一份 `agent.cordis.yml`；由它组装的会话使用该 preset 的工具、提示词段落与 skill（技能），而其他会话仍各自使用自己的：`agent-presets` 拥有名单与受防护的按 agent 挂载，`persona` 提供让 preset 不止能改变 agent 的工具、也能改变其身份的那一行。prompt preset 则是用户自有的、对组装后系统提示词的有序变换，可按会话选择并随时切换；`prompt-presets` 拥有它。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`agent-presets`](agent-presets/README.zh.md) | preset 名单、对受信任根目录与用户根目录的发现、按 agent 组装、仅通过复制创建 preset | `ctx.agentPresets` |
| [`persona`](persona/README.zh.md) | preset 挂载的可组装人设行，用于遮蔽或替换部署级人设 | — |
| [`prompt-presets`](prompt-presets/README.zh.md) | 用户自有的有序系统提示词变换，可按会话选择并随时切换 | `ctx.promptPresets` |

-----

<a id="related-documentation"></a>
## 相关文档

- [`AgentPresets` 参考](../../docs/subsystems/core.zh.md#ctxagentpresets--agentpresets)——发现、挂载、继承与重组。
- [Scope 子系统](../../docs/subsystems/scope.zh.md)——scope key，以及挂载接入 agent 时所用的父链。
- [系统提示词子系统](../../docs/subsystems/system-prompt.zh.md)——preset 提示词段落如何注册与组装，以及 `prompt-presets` 占据的最终覆盖接缝。
- [提示词预设子系统](../../docs/subsystems/prompt-presets.zh.md)——本组提示词覆盖所传递的规则词汇与 wire 载荷。
- [按会话组装 agent preset 的 Agent Note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.zh.md)——设计理由与备选方案。

部署交付的 preset 位于 [`agent-presets/presets/`](agent-presets/presets)——一个 preset 一个目录，那份目录列表就是名单；在这里再列一遍只会多出一份需要同步的名单。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
