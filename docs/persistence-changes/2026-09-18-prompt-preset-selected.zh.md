---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-18-prompt-preset-selected

[English](2026-09-18-prompt-preset-selected.md) | 中文

## 概述

新增 `prompt-preset/selected` 会话事件，用于记录一个会话运行在哪个提示词预设之下；该选择可以在会话的任意时点改变。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-18-prompt-preset-selected
baseline: false
changes:
  - root: "event:prompt-preset/selected"
    previous: null
    after: "de386d52c32c993646e6bedaa4f0a6d817ef74e7fdc0dce4288df95257041f67"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

在当前 writer 版本上属于纯增量词汇：该事件是没有前身的新根，既没有改变任何既有事件的形状，也不需要提升格式版本。较旧构建的读取方遇到无法识别的必需类型时会拒绝重建，这是本仓库对新增仓库内事件类型的既定行为；信封上的 `ignorable` 标记是留给仓库外类型的，`Session.append` 无法设置它。即便某个后来才认识该类型的读取方跳过这条记录，也不会丢失任何模型可见内容，因为渲染后的提示词已作为 `system/message` 文本独立持久化；由这些事件折叠出的 projection（投影）只决定恢复或分叉后的会话重新应用哪个预设。

<a id="verification"></a>
## 验证

`packages/preset/prompt-presets/tests/session.spec.ts` 在一串选择事件与一个分叉前缀上折叠该 projection；`packages/preset/prompt-presets/tests/override.spec.ts` 钉住追加的事件及其在并发选择下的顺序；`pnpm run gen-persistence-catalog` 重新生成了目录、schema 与 `KNOWN_SESSION_EVENT_TYPES`。

<a id="dev-note"></a>
## 开发备注

无。
