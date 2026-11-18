# Agent Note：循环为注入的上下文提供拥有最终决定权的准入点

Status: implemented

[English](2026-11-18-context-admission-events.md) | 中文

## 问题

想关闭某条注入提示（例如模型切换提示）的人，需要一个在提交前能看到每一条注入的位置。`agent/pre-step` 不是这样的位置。waterfall 监听器的嵌套关系取决于注册顺序，`prepend: true` 让最近注册的监听器位于最外层。`installModelSelection` 在每个 Agent 创建时把带 prepend 的监听器注册到该 Agent 的作用域上，这发生在所有插件加载之后，因此插件级的 `agent/pre-step` 监听器永远无法包住它：提示被追加在任何过滤器之外。

运行时上下文段落在另一层有同样的缺口。`ctx.systemPrompt.refreshContext()` 在每次尝试前都从提供者重新解析每个段落，因此在 `system-prompt/assemble` 或 `finalize()` 中做的改写会在循环投影快照之前被替换。

## 决策

循环在固定位置派发两个 waterfall，时机在所有贡献之后、任何内容提交之前：

- `agent/admit-messages` 在每个进入的步骤中运行一次，处理 `agent/pre-step` 返回的批次。
- `agent/admit-context` 在每次投影之前处理渲染出的运行时上下文段落，在准备步骤时以及每次尝试之前都会运行，因此两个投影位置得到相同的结果。

两者都是普通的 waterfall，多个监听器可以组合。监听器丢弃的内容从不提交，改写的内容按改写后的样子提交，这保持了 **Model-visible ⟺ logged**。段落在快照比较之前准入，因此规则变化会在下一步产生新快照，而被丢弃段落的变化不会产生快照。

注入的上下文仍遵循[将上下文注入与轮次执行分离](2026-07-24-separate-context-injection-from-turn-execution.zh.md)规定的生命周期；准入只决定进入的批次提交什么。`dsh-context-injections` 是第一个监听器：一张固定的条目表，每个条目是一个 volatile 开关和替换文本。

## 考虑过的替代方案

**在 `agent/pre-step` 中以 `prepend: true` 过滤。** 只在没有更晚注册的监听器时有效，而每个 Agent 的监听器总是更晚注册。之所以否决，是因为需要的性质是“看到最终批次”，注册顺序无法提供这一点。

**在 `agent/created` 上为每个 Agent 注册过滤器。** 它在 `installModelSelection` 之后运行，但任何在它之后注册 pre-step 监听器的 `agent/created` 监听器都会再次位于外层。出于同样的原因否决。

**配置每个生产方。** 每个生产方各自拥有开关和模板。这让策略紧挨着文本，但用户得在许多包里分别找设置，没有提供设置的生产方也就无法关闭。作为主要机制被否决；生产方仍可以提供自己的配置。

**在系统提示词注册表中改写。** 能覆盖段落但覆盖不了提示，而且 `refreshContext()` 也得应用改写。之所以否决，是因为消息不归注册表管。

**在适配器处改写。** 在发出请求前最后一刻，但会让日志不再描述实际请求。依据 **Model-visible ⟺ logged** 否决。

## 后果

- 修改 `agent-loop` 为每个步骤增加了两次派发、每次尝试增加了一次；没有监听器时，每次都直接返回回退值。
- 丢弃注入的监听器不会通知生产方。自行记录注入的生产方（例如时间读数）会在后续步骤再次提供被丢弃的注入。
- 这里可以丢弃提供者为 `required` 的段落，而 `suppressRuntimeContext()` 从不允许这样做；`dsh-context-injections` 保留必需段落，只改写其文本。

## 测试

- `packages/core/agent-loop/tests/context-admission.spec.ts` 丢弃并改写由最外层 agent 作用域 pre-step 监听器追加的提示，清空首个步骤而不发起模型调用，并在准备步骤时与每次尝试时准入段落。
- `packages/context/context-injections/tests/plugin.spec.ts` 通过真实循环驱动随附的条目，包括在两步之间修改的设置。
