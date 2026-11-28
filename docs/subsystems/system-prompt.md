# System Prompt Assembly

English | [中文](system-prompt.zh.md)

The [system-prompt package](../../packages/core/system-prompt) owns the data exchanged between prompt contributors and one assembly call. The package [README](../../packages/core/system-prompt/README.md) documents registration, ordering, scoping, and rendering behavior; this page records the exact cross-package types that plugins implement or pass.

Source: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts).

## Assembly context

`AssembleContext` identifies the scope and optional Session receiving one assembly. With a Session, the assembly’s `systemUpdates()` compares the captured sections with that Session’s committed state when called; without one, it returns no writes. The context is merge-extensible: `dsh-agent` adds optional `agent` and `modelSelection` fields. `assembleContextFor(agent, signal)` supplies the agent, Session, scope, and signal; the loop adds the model selection retained across retries, with omitted reasoning effort using adapter defaults. A preview renders the same inputs and returns no system writes.

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

`TOOL_APPLY_PATCH` takes order 1350 between `TOOL_EDIT` (1300) and `TOOL_GLOB` (1400).

## Tool-provider result

`ToolProviderResult.schemas` is the model-visible set for the current assembly. `knownNames` is the provider's pre-restriction name universe used to distinguish a configured-name typo from a known tool that is deliberately hidden in this scope.

```ts type-equiv
/** Tool schemas visible in one assembly and their pre-restriction name set. */
interface ToolProviderResult {
  /** The schemas this provider contributes to THIS assembly. */
  readonly schemas: readonly ToolSchema[]
  /** The pre-restriction name universe for config validation (defaults to `schemas`' names). */
  readonly knownNames?: readonly string[]
}
```

## Prompt sections

The exported `PERSONA_PREFIX_SECTION` (`deployment:persona-prefix`) and `PERSONA_SUFFIX_SECTION` (`deployment:persona-suffix`) name ordinary sections whose deployment defaults are registered by the system service. Plugins override either name through `section()`; prefix registrations may carry complete mode. Their `PromptSectionOrderName` entries are `DEPLOYMENT_PERSONA_PREFIX` and `DEPLOYMENT_PERSONA_SUFFIX`; the [package README](../../packages/core/system-prompt/README.md#configure-the-prompt) owns placement and template configuration.

`PromptSection` registers text and optional replacement and retirement notices. The nearest scope wins a name; within that scope, the latest live registration wins. `AssembledSection` retains `name` and `order` with resolved text; `PromptAssembly` adds provider-owned tools and `systemUpdates()` to the waterfall’s `PromptPresentation`. Each returned `SystemUpdate` pairs one system message with its surface intent: ordinary deltas append, while a rebuild empties later system nodes and then replaces the head with one full prompt. The comparison uses the captured source state and that Session’s committed text at the time of the call. Cordis disposal removes one registration; assembly selects retirement only for a committed name with no remaining visible registration. Committing retirement removes that name from the latest projection. After compaction, the next model attempt commits a full reset from the captured sources as the baseline for later comparisons. The [package README](../../packages/core/system-prompt/README.md) owns timing, canonical content-block metadata, and reconstruction semantics. A registered finalizer can supply a complete replacement in its chosen section order.

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

## Dynamic prompt context

`PromptContext` is the cache-safe counterpart to `PromptSection`. The assembly resolves and orders these contributions, while agent-loop logs their complete current snapshot after retained model history only when it changed or compaction removed it.

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

`required: true` keeps an operational contribution when optional runtime context is suppressed. `interpolate: false` preserves literal text, including variable-like directory names. `AssembledContext` carries the resolved text and that interpolation choice into rendering.

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

## Final override

`PromptFinalizer` receives a `PromptDraft` after the assembly waterfall, complete-section restoration, and runtime-context suppression. The registry derives system writes from its returned presentation. Return a new sections array to supersede earlier instructions in the array’s order. Register at most one finalizer per layer. A scoped finalizer shadows the global one. Preserve `tools`, `contexts`, and `variables` unless the override owns their changes.

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Scoped](scope.md)

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
