---
kind: upgrade-guide
description: "解决提示词预设的小节 ID 冲突，并更新穷举规则类型的处理程序。"
---

# 提示词预设要求小节 ID 唯一

[English](guide.md) | 中文

## 变更

过去使用同一生成 ID 创建第二个小节的预设，现在会跳过冲突规则。已保存的预设不允许两条启用的创建规则占用同一 ID。穷举处理提示词规则或预览警告的客户端需要支持 `rewrite` 规则以及 `duplicate-section` 和 `invalid-section-id` 警告。没有冲突的现有预设保留原生成 ID。

## 迁移

1. 在受影响的任务中打开预设预览。对于发生冲突的 `prepend` 或 `append`，将 `sectionId` 设置为未使用的 ID，并更新指向该新建小节的规则。如果目的是替换现有小节的正文，请改用 `rewrite`，在 `section` 中填写其完整 ID。
2. 在自定义客户端中显示 `duplicate-section` 警告指明的 ID。确认预览里目标小节只出现一次，且不再报告冲突。
