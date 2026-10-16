# 系统提示词组装

[English](system-prompt.md) | 中文

[system-prompt 包](../../packages/core/system-prompt)负责管理提示词贡献者与一次组装调用之间交换的数据。该包的 [README](../../packages/core/system-prompt/README.zh.md) 记录注册、排序、作用域与渲染行为；本页记录各插件实现或传递的确切跨包类型。

源码：[`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts)。

## 组装上下文

`AssembleContext` 标识一次组装所解析的作用域层，并可携带该请求的显式控制信号。它可合并扩展：`dsh-agent` 添加可选字段 `agent`，用于携带当前的 agent（智能体）实例；`assembleContextFor(agent, signal)` 则一起设置这些显式字段。裸组装既没有作用域，也没有信号。`preview` 标记一次不会被任何请求使用的假设性组装；在 `system-prompt/assemble` 位置记录 per-agent（按智能体）状态的监听器在该字段为真时跳过那次写入，因此绘制预览不会改变并发步骤的路由。

```ts type-equiv
/** Merge-extensible context for one prompt assembly. */
interface AssembleContext {
  /**
   * Scope whose providers and waterfall listeners participate. When absent,
   * only global providers and subject-less listeners participate.
   */
  scope?: ScopeKey
  /** Explicit control signal for the turn that requested this assembly, when any. */
  signal?: AbortSignal
  /**
   * Marks a what-if assembly that no live request will use. Listeners that
   * record per-agent state from their `system-prompt/assemble` position skip
   * that write when it is true, so previewing cannot disturb a concurrent
   * step; they still return their normal transformed assembly, so the preview
   * sees the same sections, tools, and variables a real step would.
   */
  preview?: boolean
}
```

## 工具提供方结果

`ToolProviderResult.schemas` 是当前组装中对模型可见的工具 schema 集合。`knownNames` 是提供方在限制前的名称全集，用于区分「配置名拼写错误」与「已知工具在此作用域中被有意隐藏」。

```ts type-equiv
/** Tool schemas visible in one assembly and their pre-restriction name set. */
interface ToolProviderResult {
  /** The schemas this provider contributes to THIS assembly. */
  readonly schemas: readonly ToolSchema[]
  /** The pre-restriction name universe for config validation (defaults to `schemas`' names). */
  readonly knownNames?: readonly string[]
}
```

## 提示词段落

导出的 `PERSONA_PREFIX_SECTION`（`deployment:persona-prefix`）与 `PERSONA_SUFFIX_SECTION`（`deployment:persona-suffix`）为全局配置和带作用域贡献所共享的段落命名。它们对应的 `PromptSectionOrderName` 项为 `DEPLOYMENT_PERSONA_PREFIX` 与 `DEPLOYMENT_PERSONA_SUFFIX`；[包 README](../../packages/core/system-prompt/README.zh.md#configure-the-prompt)规定其位置与模板配置。

`PromptSection` 是一份只读的同进程注册约定。其文本可以是静态的，也可以从当前组装上下文动态解析。各段先按 order 升序排列，再按名称的代码单元顺序排列；仓库贡献方通过 `getSectionOrder()` 解析服务持有的具名分配。Runtime-context 贡献方通过 `getContextOrder()` 解析独立分配。协作式组装完成后，一个有效的 `complete` 段会成为唯一的提示词段落，而已注册的 `PromptFinalizer` 随后对该结果拥有最终决定权。agent loop（智能体循环）用 `renderPrompt` 渲染组装后的各段，并把文本作为 `system/message` surface 节点提交——首个步骤作为 surface 第 0 号节点追加，之后在渲染文本变化时原地替换，或者当已准备调用声明 `systemPromptUpdate: 'in-history'` 时，在序列延续期间把非空更新追加到已缓存历史之后——因此提示词作为派生历史中的消息而不是请求字段到达模型（[决策](../../.agents/notes/implemented/architecture/2026-09-02-system-prompt-as-surface-node.zh.md)；[决策规则](../../packages/core/agent-loop/README.zh.md#understand-the-implementation)）。

```ts type-equiv
/** One contributed section of the system prompt (registry input). */
interface PromptSection {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.section}). */
  readonly name: string
  /**
   * Sections are concatenated in ascending order. Equal orders use code-unit
   * name order.
   */
  readonly order: number
  /**
   * Static text or a provider evaluated at each assembly with that assembly's
   * {@link AssembleContext}. The text may reference `{{variable}}`s — they are
   * interpolated later, by {@link renderPrompt}, unless `interpolate` is false.
   */
  readonly text: string | ((context: AssembleContext) => string)
  /** Whether to interpolate prompt variables. Defaults to true; false preserves literal text. */
  readonly interpolate?: boolean
  /**
   * Treat this contribution as the complete system prompt. Assembly still
   * runs the cooperative waterfall so tools, contexts, and variables can be
   * resolved, then restores this exact section as the sole prompt section.
   * More than one effective complete section makes assembly fail.
   */
  readonly complete?: boolean
}
```

## 动态提示词上下文

`PromptContext` 是与 `PromptSection` 对应的缓存安全结构。组装会解析这些贡献并排序；agent loop（智能体循环）仅在完整当前快照发生变化或被压缩（compaction）移除时，才会将其记录在保留的模型历史之后。

```ts type-equiv
/** Dynamic model context materialized as a durable user-role snapshot. */
interface PromptContext {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.context}). */
  readonly name: string
  /** Contexts are joined in ascending order. */
  readonly order: number
  /** Static text or a provider evaluated at assembly and admission refresh. Empty text contributes nothing. */
  readonly text: string | ((context: AssembleContext) => string)
  /** Whether to interpolate prompt variables. Defaults to true; false preserves literal text. */
  readonly interpolate?: boolean
  /** Keep this operational context when optional runtime context is disabled. */
  readonly required?: boolean
}
```

`required: true` 在可选运行时上下文被抑制时保留操作所需的贡献。`interpolate: false` 原样保留文本，包括看起来像变量的目录名。`AssembledContext` 将已求值文本及其插值选择传给渲染过程。

```ts type-equiv
/** One resolved dynamic context contribution. */
interface AssembledContext {
  /** The contributing context's unique name. */
  name: string
  /** The resolved text before variable interpolation. */
  text: string
  /** Whether to interpolate prompt variables. Defaults to true; false preserves literal text. */
  interpolate?: boolean
}
```

<a id="final-override"></a>

## 最终覆盖

`PromptFinalizer` 是唯一在其余一切之后运行的贡献：调用它时，组装 waterfall（瀑布流）、生效的 complete 段落恢复以及运行时上下文抑制都已完成，而它的返回值就是 `assemble()` 的返回值。每一层至多注册一个，作用域内的会遮蔽全局的。它面向必须拥有最终决定权的部署方自有覆盖——当前的消费方是用户可控的提示词覆盖——而不面向普通贡献；普通贡献注册 `PromptSection`，与其余一切组合。finalizer（最终覆盖方）负责保留 `tools`、`contexts` 与 `variables`：agent loop（智能体循环）三者都读，而 PTC 与结构化输出的协议贡献位于 `sections` 中。invariant（不变式）伴生包校验的是 waterfall 的结果，而 finalizer 在其之后运行，因此 finalizer 对自己产出的有效性负责。

```ts type-equiv
/**
 * The last word on one assembly's content.
 *
 * It receives the assembly every other input has already produced — the
 * waterfall's result with any complete section restored and any runtime-context
 * suppression applied — and what it returns is what {@link SystemPrompt.assemble}
 * returns. Preserving `tools`, `contexts`, and `variables` is the provider's
 * obligation: the loop reads all three, and the PTC and structured-output
 * contributions live in `sections`.
 */
type PromptFinalizer = (
  assembly: PromptAssembly,
  context: AssembleContext,
) => PromptAssembly | Promise<PromptAssembly>
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsystemprompt--systemprompt"></a>

### `ctx.systemPrompt` — `SystemPrompt`

Registry service for the prompt inputs assembled before each model step.

```ts cordis-catalog
/**
 * Register an ordered prompt section in the calling context's scope. A scoped
 * section shadows a global section with the same name; duplicates within one
 * layer and non-finite orders throw. Registration and disposal emit
 * `system-prompt/change`.
 * @param section - the section to register.
 * @returns the exact Cordis effect disposer.
 */
section(section: PromptSection): () => void

/**
 * Resolve the centrally owned placement of a repository prompt section.
 * @param name - stable section placement name.
 * @returns the section's numeric sort order.
 */
getSectionOrder(name: PromptSectionOrderName): number

/**
 * Resolve the centrally owned placement of a repository runtime context.
 * @param name - stable context placement name.
 * @returns the context's numeric sort order.
 */
getContextOrder(name: PromptContextOrderName): number

/**
 * Register ordered dynamic context in the calling context's scope. Scoped
 * entries shadow global entries with the same name.
 * @param context - the context contribution to register.
 * @returns the exact Cordis effect disposer.
 */
context(context: PromptContext): () => void

/**
 * Suppress optional dynamic runtime-context contributions in the calling
 * context's scope without changing the services that own or enforce those
 * facts. Multiple suppressors remain independently disposable.
 * @returns the exact Cordis effect disposer.
 */
suppressRuntimeContext(): () => void

/**
 * Register a tool-schema provider in the calling context's scope. Global and
 * matching scoped providers both contribute; returning the reserved
 * {@link TOOL_ORDER_REST} name makes assembly fail.
 * @param provider - evaluated for each assembly with its context.
 * @returns the exact Cordis effect disposer.
 */
tools(provider: (context: AssembleContext) => ToolProviderResult): () => void

/**
 * Register a prompt variable in the calling context's scope. Scoped values
 * shadow globals; invalid or duplicate names throw. A provider may return
 * `undefined`, but rendering a section that references that value then fails.
 * @param name - the `[a-z][a-z0-9_]*` reference name.
 * @param provider - evaluated for each assembly.
 * @returns the exact Cordis effect disposer.
 */
variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void

/**
 * Register the final override for the calling context's scope. It runs last,
 * after the assembly waterfall, after an effective complete section has been
 * restored, and after runtime-context suppression, and what it returns is
 * exactly what {@link assemble} returns — so nothing this registry admits can
 * change the prompt after it. A scoped override shadows a global one, and a
 * second registration in the same layer throws. Registration and disposal
 * emit `system-prompt/change`.
 *
 * Reserve it for a deployment-authored override that must have the last word.
 * Ordinary contributions register a {@link section}, which composes with
 * every other section instead of replacing the result of all of them.
 * @param finalizer - evaluated for each assembly of a participating scope.
 * @returns the exact Cordis effect disposer.
 */
finalize(finalizer: PromptFinalizer): () => void

/**
 * Refresh accepted registered runtime facts for request admission. Contexts
 * added only by the assembly waterfall retain their accepted values. Current
 * suppression removes optional contexts, and missing required registrations
 * are restored in registry order. Sections, tools, and interpolation variables
 * retain the accepted assembly; their providers and waterfall do not rerun.
 * @param assembly - accepted assembly for this scope and step.
 * @param context - the same scope and current plugin-defined assembly fields.
 * @returns the accepted assembly with current runtime-context provider text.
 */
refreshContext(assembly: PromptAssembly, context: AssembleContext = {}): PromptAssembly

/**
 * Assemble global and scoped providers, detach tool parameters, apply
 * canonical ordering, then run the assembly waterfall. Scoped sections and
 * variables shadow globals. The returned waterfall value is authoritative
 * except that an effective complete section is restored afterwards as the
 * sole prompt section, and that a registered {@link finalize} override then
 * has the last word over all of it.
 * @param context - the optional scope and plugin-defined assembly fields.
 * @returns the finalized assembly with any complete prompt enforced first.
 */
async assemble(context: AssembleContext = {}): Promise<PromptAssembly>
```

Source: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts)

<a id="system-prompt-events"></a>

### `system-prompt/*` events

<a id="system-promptassemble--waterfall"></a>

#### `system-prompt/assemble` — waterfall

Expert waterfall over the assembled sections, contexts, tools, and variables. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners receive only that scope's assemblies. The returned value is authoritative. A supplied signal controls only this explicit assembly request and must not be retained to control later turns. A registered complete section is restored after this waterfall, so listeners cannot add to or replace that scope's system prompt; only the final override registered through SystemPrompt.finalize runs later than that restoration.

```ts cordis-catalog
/**
 * Expert waterfall over the assembled sections, contexts, tools, and variables.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners
 * receive only that scope's assemblies. The returned value is authoritative.
 * A supplied signal controls only this explicit assembly request and must not
 * be retained to control later turns. A registered complete section is
 * restored after this waterfall, so listeners cannot add to or replace
 * that scope's system prompt; only the final override registered through
 * {@link SystemPrompt.finalize} runs later than that restoration.
 * @param assembly - the mutable assembly built from registered providers.
 * @param context - the caller's per-assembly context.
 * @mode waterfall
 */
'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>
```

Types: [Scoped](scope.zh.md)

Source: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts)

<a id="system-promptchange--emit"></a>

#### `system-prompt/change` — emit

Emitted when any prompt provider changes. This registry notification is unfiltered because a global change affects every scope.

```ts cordis-catalog
/**
 * Emitted when any prompt provider changes. This registry notification is
 * unfiltered because a global change affects every scope.
 * @mode emit
 */
'system-prompt/change'(): void
```

Source: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts)
<!-- END GENERATED cordis-surface -->
