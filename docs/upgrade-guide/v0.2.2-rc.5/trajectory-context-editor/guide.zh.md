---
kind: upgrade-guide
description: "内置上下文编辑器使用新的会话视图 ID，已保存的标签页选择和使用 context 的跳转不再打开编辑器。"
---

# 内置上下文编辑器使用独立的视图 ID

[English](guide.md) | 中文

## 变更

内置编辑器在 `conversation.view` 中的 ID 由 `context` 改为 `trajectory-context-editor`。如果会话保存的选择是 `context`，它会打开注册了该 ID 的插件标签页；如果没有这样的标签页，则打开聊天。会话历史不变。

## 迁移

1. 要回到编辑器，请在受影响的会话中选择一次「上下文编辑器」。客户端会为该会话记住这次选择。
2. 如果你的插件按 ID 打开内置编辑器，请将目标改为 `trajectory-context-editor`。如果要打开 `dsh-context` 的仪表板，则保留 `context`。同时启用两者后，确认两个入口分别打开对应的视图。
