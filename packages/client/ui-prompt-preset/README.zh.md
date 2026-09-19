---
description: "面向编辑规则栈或切换任务提示词预设的用户与维护者的提示词预设浏览器界面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-prompt-preset

[English](README.md) | 中文

## 概述

本包是提示词预设的浏览器一半：一个设置区块，在实时预览旁编辑某个预设的有序规则栈；以及任务标题栏中的切换器，用于改变正在运行的任务所使用的预设。编辑先暂存、仅在保存时写入，因此无法使用的规则在其字段旁就被拒绝，而不是在一次往返之后。预览始终是 Host 自己的回答，并针对主视图正在展示的任务绘制，因为存在哪些小节取决于该任务的组合。不存储任何预设的部署两个界面都不渲染。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把 `dsh.client` 行加入 Web 名册即可，没有需要配置的项。node 一半是空的 `apply`，只为让插件出现在 Loader 中；浏览器一半注册两个界面：

| 界面 | 插槽 | 位置 |
|---|---|---|
| 设置区块 | `settings.section` | `id: 'prompt-presets'`、`order: 22`——在 Agent 预设之后、已归档任务之前 |
| 任务切换器 | `conversation.session.header.actions` | `id: 'prompt-preset'`、`order: -9`——紧随 agent-preset 标签之后 |

两者都通过 `ctx.remote.promptPresets` 读取同一份名册，并在 `prompt-presets` 命名空间的 `settings/document-updated`、Host 自己的 `prompt-preset/changed`，以及 `connection/reset` 时一起刷新。

### 切换器是控件，不是标签

agent-preset 的界面分成事前的 chip 与只读的标题栏标签，因为任务的组合一旦开始就被固定。提示词预设不是：系统提示词每一步都会重新渲染，因此标题栏提供实时菜单，文案也明说改动自下一轮起生效、已发送的消息不受影响。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | `apply`：词典、两处插槽注册、刷新接线、预览目标 |
| [`src/client/section-store.ts`](src/client/section-store.ts) | 设置区块的控制器：名册、一份草稿、对话框、防抖预览 |
| [`src/client/seat-store.ts`](src/client/seat-store.ts) | 切换器的控制器：菜单名册与写入 |
| [`src/client/preset-model.ts`](src/client/preset-model.ts) | 纯草稿模型，以及决定是否提供「保存」的检查 |
| [`src/client/PromptPresetSection.tsx`](src/client/PromptPresetSection.tsx) | 页面：名册栏、编辑器、对话框 |
| [`src/client/RuleCard.tsx`](src/client/RuleCard.tsx) / [`RuleFields.tsx`](src/client/RuleFields.tsx) | 单条规则的外框，以及各类型各自的字段 |
| [`src/client/PromptPreview.tsx`](src/client/PromptPreview.tsx) | 警告、小节列表与最终提示词 |
| [`src/client/TextArea.tsx`](src/client/TextArea.tsx) | 包内自有的多行字段 |
| [`src/client/locales.ts`](src/client/locales.ts) | 本界面文案的唯一归属地 |
| — | 不发布运行时 invariant（不变式）伴生包：本包只拥有呈现与暂存，它渲染的每个事实都来自 Host。 |

### 为什么预览是一次 Host 调用

浏览器端的规则引擎会成为 `applyRules` 的第二份实现，两者终将漂移。因此草稿是以文档而非已存储 id 的形式发送的，于是未保存的编辑正是人所看到的内容，而 Host 用与真实步骤相同的变换作答。编辑有防抖，单调递增的代次会丢弃迟到的回复，计时器在拆卸时清除。

### 为什么规则文本按字面渲染

小节与提示词文本进入 `<pre>`，绝不进入 `MarkdownText`。提示词中带有 `{{…}}` 组、围栏与标题，Markdown 渲染器会去解释它们；而本面板的意义就是展示模型确切收到了什么。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [prompt-presets 包](../../preset/prompt-presets/README.zh.md)——本页所呈现的 Host store、规则语义与失败策略。
- [提示词预设子系统](../../../docs/subsystems/prompt-presets.zh.md)——两半所传递的 wire 载荷。
- [ui-agent-preset 包](../ui-agent-preset/README.zh.md)——本界面所并列的模式界面，以及那一种为何锁定而本种不锁定。
- [Web Client 架构](../../../docs/subsystems/web-client.zh.md)——本处每个界面都遵循的插槽、props 与 store 约束。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过任务所运行的提示词预设；它所选择的预设拥有每一项面向模型的效果。

#### KV Cache 影响

没有直接影响。在此处做出的切换会通过 Host 写入，而 Host 自己的约定记载：选择变更会重写已提交的 `system/message` 并开启一个新的请求序列。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **预览需要一个打开的任务**——它针对某个任务自己的作用域组装，因此主视图没有任务时页面会直说，而不是去猜。
- **最终提示词没有差异视图**——小节列表会标出新增、移除与改动的小节，但提示词页签展示的是结果而非与基线的 diff。
- **重排序用按钮而非拖拽**——`ui-primitives` 中没有可复用的共享拖拽能力，而按规则的移动按钮无需它即可用键盘触达。
- **多行字段是包内自有的**——`ui-primitives` 不提供 `TextArea`，而别处那两个原生 textarea 是不同的控件；把它提升上去应当交给第一个真正需要在两个包里用到它的改动。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
