---
description: "框架注入模型请求的上下文的开关与替换文本，供决定模型被告知哪些内容的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-injections

[English](README.md) | 中文

## 概述

`dsh-context-injections` 决定哪些注入的上下文会到达模型、以什么措辞到达。它覆盖两类注入：生产方以用户消息形式加入某一步的提示与提醒，例如模型切换提示、时间读数或审批策略变更；以及运行时上下文快照中的具名段落，例如说明 `danger-full-access` 的文件访问策略。每一项都可以关闭或设置替换文本，可在“上下文注入”设置页或 `cordis.patch.yml` 中修改。修改从下一步开始生效，无需重新挂载。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随附的 `dsh` 基础组合以 `context-injections` 挂载此条目，并关闭模型切换提示；其余注入原样发送。Web 与桌面应用通过 **设置 → 上下文注入** 编辑它，该页面由 [`dsh-client-ui-settings-context-injections`](../../client/ui-settings-context-injections/README.zh.md) 提供。

### 条目

| 条目 | 匹配 | 可否关闭 |
|---|---|---|
| `modelSwitch` | 来自 `model-selection` 的消息 | 可以 |
| `timeContext` | 来自 `time-context` 的消息 | 可以 |
| `approvalNotice` | 来自 `user-approval` 的消息 | 可以 |
| `workingDirectoryNotice` | 来自 `working-directory` 的消息 | 可以 |
| `planModeNotice` | 来自 `plan-mode` 的消息 | 可以 |
| `repeatToolReminder` | 来自 `repeat-tool-reminder` 的消息 | 可以 |
| `agentInstructions` | 来自 `agent-instructions` 的消息 | 可以 |
| `skillCatalog` | 来自 `skill-catalog` 的消息 | 可以 |
| `tmuxContext` | 来自 `tmux-context` 的消息 | 可以 |
| `workingDirectory` | 段落 `working-directory:current` | 不可以；该段落是必需的 |
| `sandboxPolicy` | 段落 `sandbox:policy` | 可以 |
| `approvalPolicy` | 段落 `approval:policy` | 可以 |
| `subagentDelegation` | 段落 `subagent:delegation` | 可以 |
| `harnessSource` | 段落 `harness:source` | 可以 |
| `webSurface` | 段落 `app:web-surface` | 可以 |

没有条目命名的消息或段落（包括用户自己的提问）原样通过。生产方未被组合时，对应条目不起作用。

### 配置

每个条目拥有 `<row>Enabled`（默认 `true`；`workingDirectory` 没有此字段）与 `<row>Text`（默认 `''`）。所有字段都是 volatile 的。

```yaml
- id: context-injections
  name: '@deepseek-ai/dsh-context-injections'
  config:
    modelSwitchEnabled: false
    timeContextText: 'Clock: {{text}}'
    sandboxPolicyEnabled: false
```

`<row>Text` 为空时发送原文。否则用它替换原文，其中每个 `{{text}}` 代表原文；其余内容都不做解释，因此其他花括号会原样到达模型。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-context-injections)列出了全部字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

插件监听 agent 循环的两个准入事件。`agent/admit-messages` 在每个进入的步骤中运行一次，时机在所有 `agent/pre-step` 监听器完成之后、任何消息提交之前，因此能看到 `installModelSelection` 这类 agent 作用域监听器在最外层追加的提示；`agent/pre-step` 监听器无法保证处于这一位置。`agent/admit-context` 在循环把渲染出的运行时上下文段落与已保留的快照比较之前处理这些段落，在准备步骤时以及每次请求尝试之前都会运行。两者每次调用都读取 volatile 配置。

被丢弃的消息从不提交，被改写的消息按改写后的内容提交，因此会话日志记录的正是模型收到的内容。被改写的 `snapshot` 形式消息还会改写与其文本一致的段落。由于段落在快照比较之前准入，修改某个段落的开关或文本会在下一步产生新的快照，而被丢弃的段落发生变化时不会产生快照。

插件为自己的条目关闭通用的自动生成设置表单，因为设置页包会渲染自己的表单。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` 与准入监听器 |
| [`src/settings.ts`](src/settings.ts) | 逐条读取 volatile 配置 |
| [`src/rows.ts`](src/rows.ts) | 条目表与字段命名规则 |
| [`src/transform.ts`](src/transform.ts) | 对消息与段落的纯丢弃和改写 |
| — | 不发布运行时不变量伴随件；插件不持有状态，准入与提交由 agent 循环负责。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Agent 循环](../../core/agent-loop/README.zh.md)——准入事件运行的位置。
- [设置页](../../client/ui-settings-context-injections/README.zh.md)——编辑这些字段的设置分区。
- [提示词预设](../../preset/prompt-presets/README.zh.md)——对系统提示词本身的控制，本包不涉及系统提示词。
- [上下文准入 Agent Note](../../../.agents/notes/implemented/architecture/2026-11-18-context-admission-events.zh.md)——为什么该策略位于循环的准入事件上，而不是 `agent/pre-step` 上。

-----

<a id="model-experience"></a>
## 模型体验

### 注入的上下文

#### 模型看到什么

在随附默认值下，除模型切换提示外的所有注入原样到达。关闭的提示不会出现在请求和日志中。关闭的段落不会出现在 `<system-reminder>` 运行时上下文快照中。设置了替换文本的条目显示该文本，其中 `{{text}}` 展开为生产方写出的原文。

#### Token 影响

是移除或替换而非增加：关闭的注入省下它的 token，替换文本按自身长度计费而不是按原文长度。

#### KV Cache 影响

注入追加在历史末尾，因此修改不会改写更早的消息。段落开关或文本的修改会在下一步产生一份新的运行时上下文快照。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **固定的条目表**——条目只命名那些描述会话情况的注入；会话依赖的内容，例如子代理结果、团队消息、作业输出、计划任务、技能调用、会话引用、压缩摘要、目标收尾说明、hook 输出、PTC 环境重置、工具可用性变更和 Cordis 插件故障，都没有条目。第三方插件的注入和实验性 timeline 插件的必需 `timeline:*` 段落同样没有条目。新的生产方需要在这里和设置页中各加一条。
- **没有生产方变量**——替换文本只能通过 `{{text}}` 看到生产方写好的文本，看不到构成它的值，例如切换提示中的模型名。
- **系统提示词不在范围内**——系统提示词的段落通过提示词预设编辑。
- **生产方会继续尝试**——自行记录注入的生产方（例如时间读数或项目指令）会在后续步骤再次提供被丢弃的注入，每次都会再被丢弃。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文，明确不具权威性；已发布行为以上文各节和包代码为准。

- **条目表重复**——由于客户端包不能导入 Host 包，设置页再次写出了条目 id；有测试保证两张表一致。

</details>
