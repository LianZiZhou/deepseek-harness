# Agent Note: 原地改写 Session 日志

Status: implemented

[English](2026-10-17-in-place-session-rewrite.md) | 中文

## Problem

检查 agent loop 的用户需要修改模型所见上下文的任意部分，然后在同一个 Session 下从选定位置继续。在任意事件处 fork 已能保留原 Session，但所要求的编辑模式需要覆盖现有 Session。Session 日志只追加，持久化承诺 `append` 绝不改写已提交事件，活跃 Agent 持有唯一写句柄，投影缓存与客户端 follower 也持有按旧 seq 记录的状态。

## Decision

`session.rewrite` 是替换已存储日志的唯一路径，分由四个所有者完成：

- `dsh-session` 中的 `buildRewriteLog` 保留 `events[0..throughSeq]`，应用内容替换、消息删除与插入的用户消息，重映射信封中的 seq 引用与 `developer/message.headerSeq`，并用恢复策略接受的 `interrupted` closer 关闭未结束的尾部轮次。被编辑的 assistant 消息会丢弃内嵌 stream、用量与提供方回放状态。跨越数据可能引用 seq 的事件进行重新编号（`UNMAPPABLE_REFERENCE`）、破坏工具调用配对（`INVALID_RESULT`）、或在继承的 fork 前缀内编辑（会使日志不再是 seeded）都在这里判定，随后由控制器在存储变更前用 `Session` 种子不变量校验结果。
- `SessionPersistence.replace` 在写所有权下原子替换整条日志。JSONL 后端先写入已同步的临时文件，把旧的当前格式文件硬链接为 `<file>.rewrite-<ms>.bak`，再 rename 覆盖 generation 路径；历史格式日志必须先经写 open 迁移。不支持该操作的后端以 `SessionReplaceUnsupportedError` 拒绝。
- Session 控制器保留其创建或恢复的每个 Agent 的 `AgentHandle`，拒绝由其他所有者启动的活跃 Agent，停止自己的 Agent，检查客户端的 `expectedCursor`，替换日志，失效投影缓存记录，在恢复前发出 `api-session/rewritten`，并可选地启动一个轮次。对该 Session 的并发解析会等待恢复后的 Agent。
- 客户端在收到 `api-session/rewritten` 时丢弃投影与已打开的历史窗口；该 Session 在宿主上的 follower 随之结束。`ui-trajectory` 的 Context 标签页读取 `session.context`，并通过 `session.rewrite` 提交暂存的编辑。

改写后的日志正是模型下一步所见内容，因此"模型可见即已记录"仍然成立。系统提示、工具与请求配置每一步都会重新推导，在编辑器中保持只读。

## Alternatives considered

**fork 后追加覆盖事件。** 让所有日志保持只追加，且已作为"从此处分叉"提供，但用户明确要求原地修改现有 Session。

**在同一 Session 中使用 surface `replace` 事件。** 只遮蔽旧消息而不移除它们，也无法表达工具调用参数编辑、步骤内删除或丢弃后续事件的截断。

**按修订号命名的 generation 文件。** `session.vN.rK.jsonl` 命名不会替换已提交路径，但会改变所有读取方的 generation 选择、迁移与 header 身份。备份硬链接只需局部改动即可保留旧内容。

**原地编辑系统提示、工具与配置。** loop 每一步都会重新投影它们，编辑过的日志副本会被下一次请求覆盖；持久覆盖需要自己的记录事件。

## Consequences

旧版 harness 会像读取其他当前格式日志一样读取被替换的日志。错过 `api-session/rewritten` 的 follower 与缓存会通过变化的持久化 revision 恢复。备份会在 Session 日志旁累积，直到手动删除。引用 seq 的插件记录会阻止其之前的删除与插入；内容编辑与截断仍然可用。

验证覆盖：`rewrite.spec.ts` 中的每种编辑与拒绝；`replace.spec.ts` 中的 JSONL 替换、取消、拒绝与备份；`session-rewrite.host.spec.ts` 中控制器停止/替换/恢复的顺序、冲突、所有权、失败与 follower 关闭；以及 `context-view.client.spec.tsx` 中 Context 标签页的编辑与重启流程。
