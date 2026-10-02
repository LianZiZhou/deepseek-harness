---
description: "交互式组合中的 /continue 命令：不发送新消息即可继续被中断的轮次。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-continue

[English](README.md) | 中文

## 概述

`dsh-command-continue` 为聊天界面和终端前门添加 `/continue` 命令：上一轮次未完成就停止时——提供方报错、网络中断、手动停止、进程崩溃、达到输出上限或在轮次中途被 fork——输入它，agent 会从已记录的历史继续这部分工作，无需你再给模型发一条“继续”。正常完成的轮次没有可继续的内容，命令会如实说明。

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

轮次被中断后输入 `/continue`。随附的 `dsh` base 在命令注册表旁全局挂载此命令，因此 Web 输入框和 dsh-TUI 等终端前门无需额外组合即可使用。

### 使用命令

| 输入 | 结果 |
|---|---|
| 未完成轮次之后输入 `/continue` | `Continuing where the last turn stopped.`——开启新轮次，其第一步不添加任何消息，模型按当前历史重新作答。 |
| 没有未完成内容时输入 `/continue` | `Cannot continue: <reason>.`——例如上一轮次已完成、会话仍在运行或会话没有轮次。 |
| `/continue <任意内容>` | `Usage: /continue (no arguments)` |

手动停止后若留下部分回复，该部分回复保留在历史中，模型从它接着生成；报错、崩溃或 fork 之后历史结束于最后一条用户消息或工具结果，请求会干净地重新发出。上一轮次可继续时，Web 客户端还会在该轮次下方显示**继续生成**按钮；两条路径使用同一套继续策略。

### 组合命令

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-continue
  name: '@deepseek-ai/dsh-command-continue'
```

接收命令的 Agent 必须实现可选的 `Agent.resume()`，随附的 agent loop 已实现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

处理器读取 `@deepseek-ai/dsh-agent` 中的 `resumeDecision(agent)`，Session Controller 的 `session.resume` Remote 也使用同一策略：Agent 必须实现 `resume`、处于空闲，且最后一个 `turn/end` 的原因是 `error`、`aborted`、`interrupted`、`max-tokens` 或 `forked`。可继续的判定携带绑定好的 `resume` 动作；处理器调用它并立即结束，继续的轮次在命令自身的生命周期记录之后运行。loop 的 `resume()` 允许该轮次的第一步不接纳任何消息，而普通唤醒在这种情况下会不调用模型就关闭轮次。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：注册 `/continue`、拒绝参数、分派继续 |
| — | 不发布运行时 invariant companion；此命令适配器不拥有状态或事件流；继续的轮次归 agent loop，注册与分派生命周期归命令注册表。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Commands 包](../commands/README.zh.md)——聊天命令背后的注册与分派契约。
- [Agent loop](../../core/agent-loop/README.zh.md)——继续的轮次如何在没有新消息时执行一步。
- [Session Controller](../../api/session-controller/README.zh.md)——Web“继续生成”按钮背后的 `session.resume` Remote。

-----

<a id="model-experience"></a>
## 模型体验

### 继续的轮次

#### 模型看到什么

没有新消息：请求就是当前已记录的历史，结束于最后一条 `user/message`、`tool/result` 批次，或手动停止留下的、标记为 `interrupted` 的 `assistant/message`。斜杠输入及其结果从不进入模型请求。

#### Token 影响

基于现有历史的一次普通请求，不额外添加内容。

#### KV Cache 影响

surface 未变化时请求序列延续，前缀缓存得以复用；系统提示词或工具集变化时与其他步骤相同。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


- **部分回复依赖提供方**——手动停止留下部分回复时，请求以一条 assistant 消息结尾；拒绝末尾 assistant 消息的提供方会让该轮次失败，此后可以再次继续或正常回复。
- **仅限空闲时**——轮次运行中 `/continue` 会拒绝；请先停止。
- **仅限命令适配器**——没有 `ctx.commands` 的界面改用 Session Controller Remote。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文，明确不具权威性；已交付的行为以上文各节和包代码为准。

- **没有持久标记**——继续的轮次只能通过其第一步没有 `user/message` 来识别；专门的标记事件可以让渲染器为它加标签。

</details>
