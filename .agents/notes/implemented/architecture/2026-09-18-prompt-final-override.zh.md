# Agent Note: 由一份贡献对系统提示词拥有最终决定权

Status: implemented

[English](2026-09-18-prompt-final-override.md) | 中文

## 问题

`ctx.systemPrompt` 接纳许多贡献并以协作方式解析它们。对它所面向的那些贡献来说这是对的：一个工具注册自己的指导段落，一个预设遮蔽 persona 槽位，一个监听器改写其他贡献产出的结果。但这套设计没有让任何一份贡献具备**决定性**，而面向用户的提示词覆盖必须具备。

有两个机制会击败试图这样做的 `system-prompt/assemble` 监听器：

- **已注册的 `complete: true` 段落压过每一个监听器。** `assemble()` 先跑 waterfall（瀑布流），随后把生效的 complete 段恢复为唯一段落。随产品发布的 `minimal` agent 预设以 `complete: true` 挂载 `dsh-persona`，因此在该预设下监听器的改写会被无声丢弃。
- **监听器的内外层次取决于注册顺序。** 一个 waterfall 监听器是外层还是内层，取决于其插件何时加载以及是否传了 `prepend`；最后一个以 `prepend: true` 注册的插件位于最外层。没有任何约定让某个特定监听器最后发言，因此「我们的改写赢」只是碰巧成立，组合一变就不再成立。

在注册表之下也没有诚实的接缝：`agent/request` 明确声明自己不能改动 messages，而在 `llm/stream` 监听器里改写请求会破坏 **Model-visible ⟺ logged**，那是有运行时不变式断言的。

还有一个更小的问题挡着同一个功能。要绘制「这份覆盖会产出什么」的预览，就得针对一个在用 agent 的作用域再组装一次，而有两个监听器会在 `next()` 之后的位置写入 per-agent（按智能体）状态：`installModelSelection` 记录 `agent/request` 稍后要读的选择，`dsh-session-reference` 记录它据以准备引用的路由。在某个步骤的组装与其请求之间绘制预览，会把一份没有任何提示词据以渲染的快照交给该步骤。

## 决策

`ctx.systemPrompt.finalize(provider)` 注册**那一个**最终覆盖。它在组装 waterfall 之后、在生效的 complete 段被恢复之后、在运行时上下文抑制之后运行；它的返回值正是 `assemble()` 的返回值。

它是单一所有者注册，而不是第二条 waterfall。作用域内的覆盖遮蔽全局的，与段落名的规则完全一致；同一层内的第二次注册抛错。`@deepseek-ai/dsh-scope` 中的 `SoleEntry` 持有它，与其他提示词表所用的 `NamedEntries` 和 `AnonymousEntries` 并列。

finalizer（最终覆盖方）负责保留 `tools`、`contexts` 与 `variables`——agent loop（智能体循环）三者都读——并对自己产出段落的有效性负责，因为 invariant（不变式）伴生包校验的是 waterfall 的结果，而 finalizer 在其之后运行。

`AssembleContext` 新增 `preview?: boolean`。它标记一次不会被任何请求使用的组装；`installModelSelection` 与 `dsh-session-reference` 在该字段置位时跳过各自的 per-agent 写入，同时照常返回它们改写后的组装结果，因此预览渲染出的段落、工具与变量与真实步骤一致。

## 考虑过的替代方案

**第二条 waterfall，`system-prompt/finalize`。** 更可组合，也更贴近注册表其余部分，但它重新引入了完全相同的缺陷：两个 finalize 监听器之间的顺序歧义与两个 assemble 监听器之间的一模一样，于是没有任何东西具备决定性。否决，因为要买到的性质是「恰好一份贡献做决定」，而注册期报错正是让它可检查而非仅靠约定的方式。

**改为抢占 `complete` 槽位。** 用与预设的 complete 段相同的名字注册一个带作用域的段即可遮蔽它，无需改动核心。否决：即便只是前置追加的覆盖也会删掉预设的 persona；它把一个功能拆到两套顺序互不一致的机制上（已注册的段落会排序，监听器不会）；而且任何地方出现第二个 complete 段都会让 `assemble()` 抛错，使该轮失败。

**在适配器层改写请求。** 确实是上线前的最后一道，同时也让日志不再描述请求。依据 **Model-visible ⟺ logged** 否决。

**让预览接受那些写入，视其为幂等。** 它们通常是幂等的。否决，因为不幂等时的失败形态是被无声改错路由的模型请求，而这道门槛只有三行。

**复用上一次真实组装而不是重新组装。** 完全避开了核心改动，做法是缓存 finalizer 上次收到的内容；但它无法回答尚未产生步骤的会话，而且它展示的是上一步的段落而非候选项的。作为一个存在意义就是准确的界面，因其不够准确而否决。

## 后果

- 对给定作用域，恰好一份贡献能决定交付的提示词；试图加入第二份的组合会在注册期失败，而不是无声地丢掉一份。
- `complete: true` 段落不再是终点：它是覆盖方收到的输入。部署方自有的覆盖压过预设的 persona，这正是目的所在。
- invariant 伴生包的覆盖范围止于 waterfall 结果。产出重复或空段落名的 finalizer 不会在那里被捕获；如 API 所声明，责任在其所有方。
- `finalize` 是部署方自有的接缝，不是贡献机制。普通插件仍然注册段落并与其余组合；README 明确写了这一点，因为一个为了加一段文字而伸手去用 `finalize` 的插件，会把这个槽位从真正需要它的人手里夺走。
- 现在可以为检视而绘制组装结果，且不打扰正在运行的 agent——这正是让实时提示词预览可以安全交付的前提。

## 测试

- `packages/core/system-prompt/tests/finalize.spec.ts` 钉住：覆盖在 waterfall 之后、complete 段恢复之后、运行时上下文抑制之后运行；返回值具有权威性；异步 provider；全局层与作用域层各自的重复注册拒绝及其各自的诊断信息；两个方向上的作用域遮蔽；幂等销毁后恢复原有行为；以及注册与销毁时发出的 `system-prompt/change`。
- `packages/core/scope/tests/store.spec.ts`（`SoleEntry`）钉住：单一保留、被拒绝的注册不影响已保留的值，以及已用尽的撤销函数无法清除后来的注册。
- `packages/core/agent/tests/model-selection.spec.ts`（`renders a preview assembly without recording the route it snapshots`）与 `packages/context/session-reference/tests/session-reference.spec.ts`（`ignores a preview assembly, so a drawn preview cannot change the prepared route`）钉住两处写入上的 `preview` 门禁。
