# 系统提示词组装

[English](system-prompt.md) | 中文

[system-prompt 包](../../packages/core/system-prompt)负责管理提示词贡献者与一次组装调用之间交换的数据。该包的 [README](../../packages/core/system-prompt/README.zh.md) 记录注册、排序、作用域与渲染行为；本页记录各插件实现或传递的确切跨包类型。

源码：[`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts)。

## 组装上下文

`AssembleContext` 标识一次组装的作用域及可选接收 Session。传入 Session 时，组装结果的 `systemUpdates()` 在调用时将捕获的段与该 Session 的已提交状态比较；未传入时，它不返回写入。该上下文可合并扩展：`dsh-agent` 添加可选字段 `agent` 和 `modelSelection`。`assembleContextFor(agent, signal)` 提供 agent、Session、作用域与信号；循环添加重试期间保留的模型选择，省略推理强度时使用适配器默认值。 预览渲染相同的输入，不返回系统消息写入。

```ts type-equiv
/** Merge-extensible context for one prompt assembly. */
interface AssembleContext {
  /** Session receiving system updates; omission produces a registry-only presentation. */
  session?: Session
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

`TOOL_APPLY_PATCH` 的顺序为 1350，位于 `TOOL_EDIT`（1300）与 `TOOL_GLOB`（1400）之间。

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

导出的 `PERSONA_PREFIX_SECTION`（`deployment:persona-prefix`）与 `PERSONA_SUFFIX_SECTION`（`deployment:persona-suffix`）为普通段命名，其部署默认值由系统服务注册。插件通过 `section()` 覆盖任一名称；前缀注册可携带完整模式。它们对应的 `PromptSectionOrderName` 项为 `DEPLOYMENT_PERSONA_PREFIX` 与 `DEPLOYMENT_PERSONA_SUFFIX`；[包 README](../../packages/core/system-prompt/README.zh.md#configure-the-prompt) 规定位置与模板配置。

`PromptSection` 注册文本以及可选的替换和退役通知。同名来源由最近作用域覆盖；同一作用域内，最后一个活跃注册生效。`AssembledSection` 在已求值文本之外保留 `name` 与 `order`；`PromptAssembly` 在 waterfall 的 `PromptPresentation` 上添加提供方拥有的工具和 `systemUpdates()`。返回的每个 `SystemUpdate` 包含一条系统消息及其 surface 意图：普通增量为追加，重建则先清空后续系统节点，再以一份完整提示词替换头节点。比较使用捕获的来源状态与调用时该 Session 的已提交文本。Cordis 清理移除一个注册；组装只为已提交且不再有可见注册的名称选择退役。提交退役后，该名称从最新投影移除。压缩后，下一次模型尝试根据捕获的来源提交完整重置，作为后续比较的基线。[包 README](../../packages/core/system-prompt/README.zh.md) 规定时序、纯段内容块元数据与重建语义。 已注册的最终覆盖方可以按选定的段落顺序提供完整替换。

```ts type-equiv
/** One contributed section of the system prompt (registry input). */
interface PromptSection {
  /** Logical source name; the nearest scope and latest registration in that scope win. */
  readonly name: string
  /**
   * Sections are concatenated in ascending order. Equal orders use code-unit
   * name order.
   */
  readonly order: number
  /**
   * Static text or a provider evaluated with that assembly's {@link AssembleContext}
   * only while this registration is effective. The text may reference `{{variable}}`s — they are
   * interpolated later unless `interpolate` is false, then trimmed before rendering
   * and admission. Interior whitespace is preserved.
   */
  readonly text: string | ((context: AssembleContext) => string)
  /** Whether to interpolate prompt variables. Defaults to true; false preserves literal text. */
  readonly interpolate?: boolean
  /**
   * Treat this contribution as the complete system prompt. Assembly still
   * runs the cooperative waterfall so tools, contexts, and variables can be
   * resolved, then restores this exact section as the sole prompt section.
   * Admission appends prospective supersession notices on entry, changes,
   * and exit; earlier messages retain their positions until compaction.
   * More than one effective complete section makes assembly fail.
   */
  readonly complete?: boolean
  /** Optional trimmed notice before changed text; blank text suppresses this notice. */
  readonly replacement?: string
  /**
   * Literal notice, nonempty after trimming, sent when no visible registration remains
   * to Sessions that previously admitted this name. The last disposed definition captured
   * by the Session supplies the notice; omission uses a notice naming the section.
   * A remaining or newly registered definition is compared as ordinary source text.
   */
  readonly retirement?: string
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

`PromptFinalizer` 在组装 waterfall、完整段落恢复和运行时上下文抑制之后接收 `PromptDraft`。注册表根据返回的呈现内容生成系统消息写入。返回新的段落数组，以数组顺序替换此前的指令。每层最多注册一个最终覆盖方。作用域内的覆盖方会遮蔽全局覆盖方。除非覆盖方负责修改相关数据，否则保留 `tools`、`contexts` 和 `variables`。

```ts type-equiv
/**
 * The last word on one assembly's content.
 *
 * It receives the assembly every other input has already produced — the
 * waterfall's result with any complete section restored and any runtime-context
 * suppression applied — and what it returns is what {@link SystemPrompt.assemble}
 * returns. Preserving `tools`, `contexts`, and `variables` is the provider's
 * obligation. To replace the prompt, return a new sections array in the intended
 * order. The service admits it as a complete prompt so omitted instructions are
 * superseded in the Session.
 * @param assembly - the presentation and ordered tool declarations.
 * @param context - the context for this assembly.
 * @returns the final presentation and tool declarations.
 */
type PromptFinalizer = (
  assembly: PromptDraft,
  context: AssembleContext,
) => PromptDraft | Promise<PromptDraft>
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
 * Register a section; the nearest scope wins, then the latest registration
 * within that scope. Disposal reveals the next live definition. Retirement
 * is admitted only after no registration remains in the visible scope chain.
 * @param section - definition, canonical order and optional transition notices.
 * @returns the exact Cordis disposer; retirement is observed at later assembly.
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
 * restored, and after runtime-context suppression. {@link assemble} derives
 * system writes from its returned presentation. A scoped override shadows a global one, and a
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
 * canonical ordering, then run the presentation waterfall. Scoped variables
 * shadow globals. The method restores an effective complete section after the
 * waterfall and applies the registered {@link finalize} override.
 * `systemUpdates()` compares the captured result with committed sections.
 * @param context - the optional scope, model step, and plugin-defined assembly fields.
 * @returns the finalized presentation, tool declarations, and system updates.
 */
async assemble(context: AssembleContext = {}): Promise<PromptAssembly>
```

Source: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts)

<a id="system-prompt-events"></a>

### `system-prompt/*` events

<a id="system-promptassemble--waterfall"></a>

#### `system-prompt/assemble` — waterfall

Presentation waterfall over assembled sections, contexts, and variables. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners receive only that scope's assemblies. Returned section text determines updates; omitting a previously admitted section leaves its instructions unchanged. Empty text withdraws its instructions; registration disposal retires it. Tool declarations remain provider-owned. A supplied signal controls only this explicit assembly request and must not be retained to control later turns. A registered complete section is restored after this waterfall, so listeners cannot add to or replace that scope's system prompt; only the final override registered through SystemPrompt.finalize runs later than that restoration.

```ts cordis-catalog
/**
 * Presentation waterfall over assembled sections, contexts, and variables.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners
 * receive only that scope's assemblies. Returned section text determines updates;
 * omitting a previously admitted section leaves its instructions unchanged.
 * Empty text withdraws its instructions; registration disposal retires it.
 * Tool declarations remain provider-owned.
 * A supplied signal controls only this explicit assembly request and must not
 * be retained to control later turns. A registered complete section is
 * restored after this waterfall, so listeners cannot add to or replace
 * that scope's system prompt; only the final override registered through
 * {@link SystemPrompt.finalize} runs later than that restoration.
 * @param assembly - the mutable assembly built from registered providers.
 * @param context - the caller's per-assembly context.
 * @mode waterfall
 */
'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptPresentation, context: AssembleContext, next: () => Promise<PromptPresentation>): Promise<PromptPresentation>
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
