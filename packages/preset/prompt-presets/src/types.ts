/** Client-safe payloads and declaration merges owned by the prompt-preset domain. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Fields every rule carries. */
interface PromptRuleCommon {
  /**
   * Whether this rule participates. Absent means it does — a preset written by
   * hand needs no bookkeeping — while an editor turns a rule off without
   * deleting text its author is still working on.
   */
  readonly enabled?: boolean
}

/** Put text ahead of every section the assembly produced. */
export interface PromptRulePrepend extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'prepend'
  /** Exact new section name; absent or empty uses the position-derived name. */
  readonly sectionId?: string
  /** The text, used verbatim. */
  readonly text: string
  /**
   * Interpolate `{{variable}}` references in this text. Defaults to FALSE,
   * inverting the registry default: an unknown reference makes rendering throw,
   * and pasted prose must never be able to fail a turn.
   */
  readonly interpolate?: boolean
}

/** Put text after every section the assembly produced. */
export interface PromptRuleAppend extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'append'
  /** Exact new section name; absent or empty uses the position-derived name. */
  readonly sectionId?: string
  /** The text, used verbatim. */
  readonly text: string
  /** Interpolate `{{variable}}` references in this text. Defaults to false. */
  readonly interpolate?: boolean
}

/** Put text immediately after one named section. */
export interface PromptRuleInsert extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'insert'
  /**
   * The exact assembled section name to sit behind. A name nothing
   * carries is a warning and the text lands at the end, because a preset whose
   * anchor a composition stopped producing should still say what it says.
   */
  readonly after: string
  /** The text, used verbatim. */
  readonly text: string
  /** Interpolate `{{variable}}` references in this text. Defaults to false. */
  readonly interpolate?: boolean
}

/** Use this text as the whole prompt, keeping only protected sections. */
export interface PromptRuleReplace extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'replace'
  /** The text, used verbatim. */
  readonly text: string
  /** Interpolate `{{variable}}` references in this text. Defaults to false. */
  readonly interpolate?: boolean
}

/** Replace the contents of one named section without moving it. */
export interface PromptRuleRewrite extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'rewrite'
  /** Exact name of the existing section. */
  readonly section: string
  /** Replacement text for the entire section. */
  readonly text: string
  /** Interpolate `{{variable}}` references in the replacement. Defaults to false. */
  readonly interpolate?: boolean
}

/** Drop sections by exact name. */
export interface PromptRuleRemove extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'remove'
  /** Exact assembled section names; a name nothing carries is a warning. */
  readonly sections: readonly string[]
}

/** Rewrite matching text inside the sections that remain. */
export interface PromptRuleSubstitute extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'substitute'
  /** Regular-expression source, compiled fresh for each section it touches. */
  readonly pattern: string
  /** Flags drawn from {@link SUBSTITUTE_FLAGS}; sticky and indices flags are refused. */
  readonly flags?: string
  /** `String.prototype.replace` replacement, so capture references work. */
  readonly replacement: string
  /**
   * Restrict to these section names. Absent or empty means every section: a
   * substitution restricted to no section could only ever be a no-op, so there
   * is nothing to distinguish, and a stored document that lost an omitted list
   * to a schema default still means what its author wrote.
   */
  readonly sections?: readonly string[]
}

/** One transform in a preset's ordered stack. */
export type PromptRule =
  | PromptRulePrepend
  | PromptRuleAppend
  | PromptRuleInsert
  | PromptRuleReplace
  | PromptRuleRewrite
  | PromptRuleRemove
  | PromptRuleSubstitute

/** Every rule kind's discriminant. */
export type PromptRuleKind = PromptRule['kind']

/** An ordered transform stack a session applies to its assembled prompt. */
export interface PromptPreset {
  /** Display name. */
  readonly name: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Applied in array order, each over the previous rule's result. */
  readonly rules: readonly PromptRule[]
}

/** One variable expansion in a preview section, measured in UTF-16 code units. */
export interface PromptPresetVariableSpan {
  /** Offset of the first code unit. */
  readonly start: number
  /** Offset immediately after the last code unit. */
  readonly end: number
  /** Exact template token, including the braces. */
  readonly token: string
}

/**
 * Why one preset did not do exactly what its author wrote.
 *
 * A warning is a discriminant plus the slots that locate it, never a sentence:
 * product copy is locale-owned, so the client renders the wording and the Host
 * states only what happened. `detail` carries a non-localizable technical
 * fragment — a regular-expression compiler message, a render failure — and is
 * shown verbatim.
 */
export interface PromptPresetWarning {
  /** What happened. */
  readonly code: PromptPresetWarningCode
  /** Index of the rule at fault, when one rule is. */
  readonly rule?: number
  /** Section the warning is about, when it names one. */
  readonly section?: string
  /** Verbatim technical text from an engine, when there is one. */
  readonly detail?: string
}

/** The closed set of prompt-preset warnings. */
export type PromptPresetWarningCode =
  /** The rule's pattern is not a valid regular expression; the rule was skipped. */
  | 'invalid-pattern'
  /** The rule's pattern exceeds the deployment's length bound; the rule was skipped. */
  | 'pattern-too-long'
  /** The rule names a section this assembly does not contain. */
  | 'unknown-section'
  /** A rule would create a section whose ID is already in use. */
  | 'duplicate-section'
  /** A custom section ID contains whitespace; the creation rule was skipped. */
  | 'invalid-section-id'
  /** The rule's pattern matched nothing in any section it targeted. */
  | 'no-match'
  /** A rule kept a protocol-bearing section the deployment protects. */
  | 'protected-section-kept'
  /** The rules replaced a section another contribution declared complete. */
  | 'complete-section-overridden'
  /** Rendering the transformed prompt would have failed, so the preset was skipped. */
  | 'render-failed'
  /** The session names a preset the roster no longer supplies. */
  | 'unknown-preset'
  /** Every section rendered empty, so the model receives no system prompt. */
  | 'empty-prompt'

/** One preset as a client reads it. */
export interface PromptPresetRow {
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

/** Which layer supplied a preset. */
export type PromptPresetSource = 'deployment' | 'user'

/** Deployment bounds an editor checks before a round trip. */
export interface PromptPresetLimits {
  /** Most presets one deployment stores. */
  readonly maxPresets: number
  /** Most rules one preset carries. */
  readonly maxRules: number
  /** Longest accepted regular-expression source. */
  readonly maxPatternLength: number
  /** Largest accepted rule text, in UTF-8 bytes. */
  readonly maxTextBytes: number
}

/** Everything a picker or editor needs in one read. */
export interface PromptPresetRoster {
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
  /** Sections a `replace` keeps and a `remove` or `rewrite` may not target. */
  readonly protectedSections: readonly string[]
}

/** The writable half of a preset. */
export interface PromptPresetInput {
  /** Display name. */
  readonly name: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** The transforms, in application order. */
  readonly rules: readonly PromptRule[]
}

/** One section of a previewed assembly, already rendered. */
export interface PromptPresetPreviewSection {
  /** The section's name in the assembly. */
  readonly name: string
  /** Rendered text: interpolated unless the section declares otherwise. */
  readonly text: string
  /** Variable references that produced non-empty ranges of this text. */
  readonly variables?: readonly PromptPresetVariableSpan[]
  /** Index of the rule that created this section, when one did. */
  readonly fromRule?: number
  /** Whether the deployment protects this section from replacement. */
  readonly protectedSection?: true
}

/** What one candidate would produce for one session, and what it costs. */
export interface PromptPresetPreview {
  /** Sections after the candidate's rules, in final order. */
  readonly sections: readonly PromptPresetPreviewSection[]
  /** `renderPrompt` of those sections — the exact text a step would commit. */
  readonly prompt: string
  /** The same assembly with no preset, section by section. */
  readonly baselineSections: readonly PromptPresetPreviewSection[]
  /** `renderPrompt` of the baseline, for a difference view. */
  readonly baselinePrompt: string
  /** Available section IDs before each rule in the candidate, including disabled rules. */
  readonly ruleSectionNames?: readonly (readonly string[])[]
  /** What the candidate did not do exactly as written. */
  readonly warnings: readonly PromptPresetWarning[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    promptPreset: string | null
  }
  interface SessionProjectionMap {
    /** Prompt preset the Session runs, or null when it overrides nothing. */
    promptPreset: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different prompt preset to its durable log.
     * Consumers invalidate only state derived from that session's prompt.
     * @mode emit
     * @param sessionId - the session whose prompt override changed.
     * @param promptPreset - the preset recorded by the committed selection, or null.
     */
    'prompt-preset/selected'(sessionId: SessionId, promptPreset: string | null): void
    /**
     * The stored roster changed: a preset was created, edited, deleted, or the
     * default moved. Payload-free because every consumer re-reads the roster.
     * @mode emit
     */
    'prompt-preset/changed'(): void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No stored preset carries that id. */
    'prompt-preset/not-found': { readonly promptPreset: string; readonly available: readonly string[] }
    /** The id is already taken. */
    'prompt-preset/exists': { readonly promptPreset: string }
    /** The document is unusable: a bad pattern, bad flags, a bound, or a protected removal. */
    'prompt-preset/invalid': { readonly promptPreset: string; readonly rule?: number; readonly reason: string }
    /** The preset comes from the deployment's composition and is not the user's to delete. */
    'prompt-preset/read-only': { readonly promptPreset: string }
    /** The stored document moved past the revision the caller read. */
    'prompt-preset/conflict': { readonly promptPreset: string; readonly revision: number }
  }
}
