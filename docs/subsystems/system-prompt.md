# System Prompt Assembly

English | [中文](system-prompt.zh.md)

The [system-prompt package](../../packages/core/system-prompt) owns the data exchanged between prompt contributors and one assembly call. The package [README](../../packages/core/system-prompt/README.md) documents registration, ordering, scoping, and rendering behavior; this page records the exact cross-package types that plugins implement or pass.

Source: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts).

## Assembly context

`AssembleContext` identifies the scope layer one assembly resolves and may carry the explicit control signal for that request. It is merge-extensible: `dsh-agent` adds the optional live `agent` field, and `assembleContextFor(agent, signal)` sets the explicit fields together. A bare assembly has neither scope nor signal. `preview` marks a what-if assembly that no request will use; a listener that records per-agent state from its `system-prompt/assemble` position skips that write when it is set, so drawing a preview cannot reroute a concurrent step.

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

The exported `PERSONA_PREFIX_SECTION` (`deployment:persona-prefix`) and `PERSONA_SUFFIX_SECTION` (`deployment:persona-suffix`) name the slots shared by global configuration and scoped contributions. Their `PromptSectionOrderName` entries are `DEPLOYMENT_PERSONA_PREFIX` and `DEPLOYMENT_PERSONA_SUFFIX`; the [package README](../../packages/core/system-prompt/README.md#configure-the-prompt) owns their placement and template configuration.

`PromptSection` is a readonly same-process registration contract. Its text may be static or resolved from the current assembly context. Sections sort by ascending order and then code-unit name; repository contributors resolve the service-owned named allocation through `getSectionOrder()`. Runtime-context contributors resolve their independent allocation through `getContextOrder()`. One effective `complete` section becomes the sole prompt section after cooperative assembly, and a registered `PromptFinalizer` then has the last word over that result. agent-loop renders the assembled sections with `renderPrompt` and commits the text as a `system/message` surface node — appended as surface node 0 on the first step, then replaced in place when the rendered text changes or, when the prepared call declares `systemPromptUpdate: 'in-history'`, appended after the cached history for non-empty updates in a continuing series — so the prompt reaches the model as a message of derived history rather than as a request field ([decision](../../.agents/notes/implemented/architecture/2026-09-02-system-prompt-as-surface-node.md); [decision rule](../../packages/core/agent-loop/README.md#understand-the-implementation)).

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

`PromptFinalizer` is the one contribution that runs after everything else: the assembly waterfall, the restoration of an effective complete section, and runtime-context suppression have all already happened when it is called, and what it returns is what `assemble()` returns. At most one may be registered per layer, and a scoped one shadows a global one. It is for a deployment-authored override that must have the last word — a user-controlled prompt override is the current consumer — and not for ordinary contributions, which register a `PromptSection` and compose with everything else. The finalizer owns preserving `tools`, `contexts`, and `variables`: the loop reads all three, and the PTC and structured-output protocol contributions live in `sections`. The invariant companion validates the waterfall's result, which the finalizer runs after, so a finalizer owns the validity of what it emits.

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
