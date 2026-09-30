# 提示词预设

[English](prompt-presets.md) | 中文

[prompt-presets 包](../../packages/preset/prompt-presets)拥有用户自己对组装后系统提示词的变换：一个具名、有序的规则栈，由会话选择，并可在任意时点切换。它占据提示词注册表唯一的最终覆盖（[`PromptFinalizer`](system-prompt.zh.md#final-override)），因此预设产出什么，`assemble()` 就返回什么。包 [README](../../packages/preset/prompt-presets/README.zh.md) 说明配置、规则类型与失败策略；本页记录 wire 及其消费方传递的确切跨包类型。

来源：[`packages/preset/prompt-presets/src/types.ts`](../../packages/preset/prompt-presets/src/types.ts) 与 [`packages/preset/prompt-presets/src/rules.ts`](../../packages/preset/prompt-presets/src/rules.ts)。

## 规则

一个预设由它的展示元数据加上一份有序规则列表构成。规则按数组下标顺序应用，每一条都能看到前一条产出的结果，包括前一条创建的小节；`enabled: false` 保留规则但不应用它。文本类规则默认 `interpolate: false`，与注册表默认值相反，因为未知的 `{{reference}}` 会让渲染抛出，而用户编写的散文绝不能有能力让一轮失败。

```ts type-equiv
/** An ordered transform stack a session applies to its assembled prompt. */
interface PromptPreset {
  /** Display name. */
  readonly name: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Applied in array order, each over the previous rule's result. */
  readonly rules: readonly PromptRule[]
}
```

```ts type-equiv
/** One transform in a preset's ordered stack. */
type PromptRule =
  | PromptRulePrepend
  | PromptRuleAppend
  | PromptRuleInsert
  | PromptRuleReplace
  | PromptRuleRemove
  | PromptRuleSubstitute
```

## 警告

预设未能按原样完成的一切，都以判别式加上定位它的规则或小节的形式传递，绝不是句子：产品文案由 locale（语言环境）拥有，因此由客户端根据编码渲染措辞。`detail` 只携带不可本地化的引擎文本，例如正则表达式编译器的消息，并按原样展示。

```ts type-equiv
/**
 * Why one preset did not do exactly what its author wrote.
 *
 * A warning is a discriminant plus the slots that locate it, never a sentence:
 * product copy is locale-owned, so the client renders the wording and the Host
 * states only what happened. `detail` carries a non-localizable technical
 * fragment — a regular-expression compiler message, a render failure — and is
 * shown verbatim.
 */
interface PromptPresetWarning {
  /** What happened. */
  readonly code: PromptPresetWarningCode
  /** Index of the rule at fault, when one rule is. */
  readonly rule?: number
  /** Section the warning is about, when it names one. */
  readonly section?: string
  /** Verbatim technical text from an engine, when there is one. */
  readonly detail?: string
}
```

## Wire 载荷

`PromptPresetRoster` 是一个编辑器或选择器一次调用就读到的全部内容：每个已存储的预设、生效的默认值、用于为后续写入设防的条目 `revision`，以及本部署强制执行的边界与保护，从而让编辑器在一次往返之前就能拒绝。

```ts type-equiv
/** Everything a picker or editor needs in one read. */
interface PromptPresetRoster {
  /** Every stored preset, deployment rows first. */
  readonly presets: readonly PromptPresetRow[]
  /** The preset stamped into blank sessions; `''` when none. */
  readonly default: string
  /** Namespace revision to send back as `expectedRevision`. */
  readonly revision: number
  /** Whether this deployment can store a preset at all. */
  readonly writable: boolean
  /** Bounds every write is checked against. */
  readonly limits: PromptPresetLimits
  /** Section names a `remove` may not name and a `replace` keeps. */
  readonly protectedSections: readonly string[]
}
```

```ts type-equiv
/** One preset as a client reads it. */
interface PromptPresetRow {
  /** Stable identifier, also the storage key. */
  readonly promptPreset: string
  /** Display name. */
  readonly name: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** The transforms, in application order. */
  readonly rules: readonly PromptRule[]
  /** Where the preset came from; a `deployment` row cannot be deleted. */
  readonly source: PromptPresetSource
  /** Whether a session naming no preset uses this one. */
  readonly isDefault: boolean
}
```

```ts type-equiv
/** The writable half of a preset. */
interface PromptPresetInput {
  /** Display name. */
  readonly name: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** The transforms, in application order. */
  readonly rules: readonly PromptRule[]
}
```

## 预览

预览针对会话自己的作用域组装两次——一次不带预设，一次带候选项——且两次组装都被标记为 `preview`，因此绘制预览不会记录任何 per-agent（按智能体）状态，也不会给会话正在运行的步骤改错路由。`prompt` 正是一个步骤会提交的文本，`baselinePrompt` 则是不带预设时会提交的文本，于是客户端可以展示两者之差，而不是整篇提示词。

```ts type-equiv
/** What one candidate would produce for one session, and what it costs. */
interface PromptPresetPreview {
  /** Sections after the candidate's rules, in final order. */
  readonly sections: readonly PromptPresetPreviewSection[]
  /** `renderPrompt` of those sections — the exact text a step would commit. */
  readonly prompt: string
  /** The same assembly with no preset, section by section. */
  readonly baselineSections: readonly PromptPresetPreviewSection[]
  /** `renderPrompt` of the baseline, for a difference view. */
  readonly baselinePrompt: string
  /** What the candidate did not do exactly as written. */
  readonly warnings: readonly PromptPresetWarning[]
}
```

```ts type-equiv
/** One section of a previewed assembly, already rendered. */
interface PromptPresetPreviewSection {
  /** The section's name in the assembly. */
  readonly name: string
  /** Rendered text: interpolated unless the section declares otherwise. */
  readonly text: string
  /** Index of the rule that created this section, when one did. */
  readonly fromRule?: number
  /** Whether the deployment protects this section from replacement. */
  readonly protectedSection?: true
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpromptpresets--promptpresetstore"></a>

### `ctx.promptPresets` — `PromptPresetStore`

Store of the user's prompt presets, and the prompt registry's final override.

It owns one data set with create, read, update, delete, and selection; it neither arbitrates providers nor executes work, so `Store` is the honest role. The override it installs is global and unscoped: per-session behavior comes from reading each assembly's own session, which covers agents created before this plugin loaded and needs no per-agent bookkeeping.

```ts cordis-catalog
/**
 * Every stored preset plus the effective default and this deployment's bounds.
 * @returns the roster one editor or picker reads in a single call.
 */
@Remote('list') list(): PromptPresetRoster

/**
 * Store a new preset under an unused id.
 * @param promptPreset - the id to create, matching {@link PRESET_ID}.
 * @param document - the preset's writable half.
 * @returns the stored row.
 * @throws {RemoteError} `prompt-preset/invalid`, `prompt-preset/exists`, or `prompt-preset/conflict`.
 */
@Remote('create') async create(promptPreset: string, document: PromptPresetInput): Promise<PromptPresetRow>

/**
 * Replace one stored preset's document wholesale.
 * @param promptPreset - the id to update.
 * @param document - the preset's writable half.
 * @param expectedRevision - the roster `revision` the caller read, when fencing.
 * @returns the stored row.
 * @throws {RemoteError} `prompt-preset/not-found`, `prompt-preset/invalid`, or `prompt-preset/conflict`.
 */
@Remote('update') async update( promptPreset: string, document: PromptPresetInput, expectedRevision?: number, ): Promise<PromptPresetRow>

/**
 * Delete one locally stored preset, clearing a default that named it.
 * @param promptPreset - the id to delete.
 * @throws {RemoteError} `prompt-preset/not-found`, `prompt-preset/read-only`, or `prompt-preset/conflict`.
 */
@Remote('deletePreset') async deletePreset(promptPreset: string): Promise<void>

/**
 * Choose the preset sessions that name none will use.
 * @param promptPreset - the id to make default; `''` clears it.
 * @throws {RemoteError} `prompt-preset/not-found` or `prompt-preset/conflict`.
 */
@Remote('setDefault') async setDefault(promptPreset: string): Promise<void>

/**
 * Switch one session's prompt preset, at any point in that session.
 *
 * There is no blank-session lock: an agent preset is locked because swapping
 * tools would strand logged tool calls, while the system prompt is a
 * replaceable surface node the next step re-renders.
 * @param agent - the session's live agent, resolved from the wire identity.
 * @param promptPreset - the preset to run, or `null` to override nothing.
 * @returns the preset recorded, or `null`.
 * @throws {RemoteError} `prompt-preset/not-found` when the roster has no such id.
 */
@Remote('select') async select(agent: Agent, promptPreset: string | null): Promise<string | null>

/**
 * What one candidate preset would produce for one live session.
 *
 * It runs the real assembly for that agent's own scope, so the preview shows
 * the same sections, tool guidance, and resolved variables a step would, and
 * marks the assembly `preview` so no listener records a route from it.
 * The candidate is a document rather than a stored id, so an editor previews
 * the draft in front of the person instead of making them save first.
 * @param agent - the session whose composition to preview against.
 * @param document - the candidate, or `null` for the untransformed prompt.
 * @param signal - cancels between the candidate and baseline assemblies.
 * @returns the rendered sections, the final prompt, and the baseline to compare.
 */
@Remote('preview') async preview( agent: Agent, document: PromptPresetInput | null, signal: AbortSignal, ): Promise<PromptPresetPreview>
```

Types: [Agent](core.zh.md)

Source: [`packages/preset/prompt-presets/src/index.ts`](../../packages/preset/prompt-presets/src/index.ts)

<a id="prompt-preset-events"></a>

### `prompt-preset/*` events

<a id="prompt-presetchanged--emit"></a>

#### `prompt-preset/changed` — emit

The stored roster changed: a preset was created, edited, deleted, or the default moved. Payload-free because every consumer re-reads the roster.

```ts cordis-catalog
/**
 * The stored roster changed: a preset was created, edited, deleted, or the
 * default moved. Payload-free because every consumer re-reads the roster.
 * @mode emit
 */
'prompt-preset/changed'(): void
```

Source: [`packages/preset/prompt-presets/src/types.ts`](../../packages/preset/prompt-presets/src/types.ts)

<a id="prompt-presetselected--emit"></a>

#### `prompt-preset/selected` — emit

One session committed a different prompt preset to its durable log. Consumers invalidate only state derived from that session's prompt.

```ts cordis-catalog
/**
 * One session committed a different prompt preset to its durable log.
 * Consumers invalidate only state derived from that session's prompt.
 * @mode emit
 * @param sessionId - the session whose prompt override changed.
 * @param promptPreset - the preset recorded by the committed selection, or null.
 */
'prompt-preset/selected'(sessionId: SessionId, promptPreset: string | null): void
```

Types: [SessionId](core.zh.md)

Source: [`packages/preset/prompt-presets/src/types.ts`](../../packages/preset/prompt-presets/src/types.ts)
<!-- END GENERATED cordis-surface -->
