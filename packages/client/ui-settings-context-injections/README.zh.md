---
description: "dsh Web 客户端设置中的“上下文注入”页面：注入模型请求的提示与运行时上下文的开关和替换文本。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-context-injections

[English](README.md) | 中文

## 概述

打开 **设置 → 上下文注入**，即可选择框架向模型请求中加入哪些提示和运行时上下文段落，并改写它们的文本。该页面编辑 [`dsh-context-injections`](../../context/context-injections/README.zh.md) 的 `context-injections` 命名空间，所有修改在点 **保存** 之前只暂存；用户覆盖过的值会被标记，并可恢复为部署默认值。只有在 Host 提供该命名空间时页面才会出现。

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

页面分为两组。**提示与提醒** 是情况变化时加入的消息，例如 **模型切换提示** 和 **当前时间**；**运行时上下文** 是在对话末尾重新说明的事实，例如说明 `danger-full-access` 的 **文件访问策略**。每一行都有一个开关和一个折叠的 **替换文本**：点 **编辑文本** 展开；已有文本的行会直接展开显示。替换文本为空时发送原文，其中的 `{{text}}` 代表原文。**工作目录** 始终发送，因此没有开关，只能修改其文本。

修改过的开关或文本会显示 **已覆盖** 和 **恢复默认**。点 **保存** 之前不会写入任何内容；离开页面会丢弃草稿。保存后的修改从每个任务的下一步开始生效。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

Host 一半是空的 `apply`，存在只是为了让本包持有一个 Loader 条目，客户端模块系统据此提供浏览器一半。浏览器一半通过 `ctx.configForms.get` 绑定 `context-injections` 命名空间，在 `ContextInjectionsController` 中基于 `ui-primitives` 共享的 `SettingsFormModel` 保存暂存表单，每行一个 `settingsBooleanField` 和一个 `settingsTextField`，并通过 `ctx.configForms.whileServed` 把 `ContextInjectionsSection` 以顺序 23 注册到设置外壳的 `settings.section` 槽。由于客户端包不能导入 Host 包，条目写在 `src/client/rows.ts` 中，并有测试将其与 Host 条目表核对。页面文案位于本包的 `settings.contextInjections` 词典中。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [context-injections](../../context/context-injections/README.zh.md)——每个条目匹配什么，以及准入时如何应用。
- [ui-settings](../ui-settings/README.zh.md)——设置外壳、`settings.section` 槽，以及页面依赖的已提供命名空间监听。
- [ui-primitives](../ui-primitives/README.zh.md)——页面渲染的设置表单模型、开关与多行文本字段。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过本页面编辑其字段的 context-injections 插件；该插件拥有每一项面向模型的效果。

#### KV Cache 影响

没有直接影响。保存的修改会到达 Host，而 Host 自己的约定记载：修改从下一步开始生效，修改过的段落会在历史末尾产生一份新的运行时上下文快照。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有预览**——页面不展示某一行将发送的原文示例；任务的「上下文编辑器」标签页会显示实际发送的内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
