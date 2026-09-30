/**
 * The prompt-transform vocabulary and the pure engine that applies it.
 *
 * Nothing here touches Cordis, the session, or the clock: one call takes the
 * sections an assembly produced and returns the sections a preset would put in
 * their place, plus what it could not do as written. That is what lets the
 * preview and the live override answer identically.
 *
 * @module @deepseek-ai/dsh-prompt-presets/rules
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { AssembledSection } from '@deepseek-ai/dsh-system-prompt'
import type { PromptPresetWarning } from './types.ts'

/** Regular-expression flags a `substitute` rule accepts. */
export const SUBSTITUTE_FLAGS = 'gimsu'

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
   * The exact {@link AssembledSection} name to sit behind. A name nothing
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

/** Drop sections by exact name. */
export interface PromptRuleRemove extends PromptRuleCommon {
  /** Discriminant selecting this rule kind. */
  readonly kind: 'remove'
  /** Exact {@link AssembledSection} names; a name nothing carries is a warning. */
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

/** Deployment bounds and protections one application runs under. */
export interface RuleApplyOptions {
  /** Sections a `replace` keeps and a `remove` may not name. */
  readonly protectedSections: readonly string[]
  /** Longest accepted regular-expression source. */
  readonly maxPatternLength: number
}

/** What one application produced. */
export interface RuleApplyResult {
  /** The sections the preset puts in the assembly's place. */
  readonly sections: AssembledSection[]
  /** What the preset could not do exactly as written. */
  readonly warnings: readonly PromptPresetWarning[]
}

/**
 * The name a text-creating rule's section carries.
 *
 * Deterministic and position-derived so a later rule can name it, and prefixed
 * so it can never collide with a registered section.
 * @param kind - the creating rule's discriminant.
 * @param index - the rule's position in its preset.
 * @returns the section name.
 */
export function ruleSectionName(kind: 'prepend' | 'append' | 'insert' | 'replace', index: number): string {
  return `prompt-preset:${kind}-${index}`
}

/** Build the one section a text-creating rule contributes. */
function createdSection(
  rule: PromptRulePrepend | PromptRuleAppend | PromptRuleInsert | PromptRuleReplace,
  index: number,
): AssembledSection {
  return {
    name: ruleSectionName(rule.kind, index),
    text: rule.text,
    interpolate: rule.interpolate === true,
  }
}

/**
 * Apply one preset's rules to one assembly's sections.
 *
 * Rules apply in array index order, and rule N sees rule N-1's output,
 * including a section rule N-1 created. Section `order` plays no part: the
 * assembly is already sorted and resolved, so position here is literal array
 * position, which is what "before everything" and "after everything" mean in
 * the rendered text.
 *
 * A rule that cannot run is skipped with a warning and the rest still apply.
 * The write path rejects an unusable rule loudly, so a rule that reaches this
 * function and still fails must not be allowed to make a session unrunnable.
 * @param sections - the assembly's sections, left untouched.
 * @param preset - the preset whose rules to apply.
 * @param options - the deployment's protections and bounds.
 * @returns the replacement sections and what did not happen as written.
 */
export function applyRules(
  sections: readonly AssembledSection[],
  preset: PromptPreset,
  options: RuleApplyOptions,
): RuleApplyResult {
  const warnings: PromptPresetWarning[] = []
  let current: AssembledSection[] = sections.map(section => ({ ...section }))

  preset.rules.forEach((rule, index) => {
    if (rule.enabled === false) return
    switch (rule.kind) {
      case 'prepend':
        current = [createdSection(rule, index), ...current]
        return
      case 'append':
        current = [...current, createdSection(rule, index)]
        return
      case 'insert': {
        const at = current.findIndex(section => section.name === rule.after)
        if (at < 0) warnings.push({ code: 'unknown-section', rule: index, section: rule.after })
        // A missing anchor lands the text at the end rather than dropping it:
        // the author asked for this text in the prompt, and only said where.
        const before = at < 0 ? current : current.slice(0, at + 1)
        const after = at < 0 ? [] : current.slice(at + 1)
        current = [...before, createdSection(rule, index), ...after]
        return
      }
      case 'replace': {
        const kept = current.filter(section => options.protectedSections.includes(section.name))
        for (const section of kept) {
          warnings.push({ code: 'protected-section-kept', rule: index, section: section.name })
        }
        current = [...kept, createdSection(rule, index)]
        return
      }
      case 'remove': {
        // The editor refuses a protected name before it is stored, but the
        // stored document is a profile patch a person can also edit by hand,
        // so the protection has to hold here too, not only at write time.
        const kept = rule.sections.filter(name => options.protectedSections.includes(name))
        for (const name of kept) {
          if (current.some(section => section.name === name)) {
            warnings.push({ code: 'protected-section-kept', rule: index, section: name })
          }
        }
        for (const name of rule.sections) {
          if (!current.some(section => section.name === name)) {
            warnings.push({ code: 'unknown-section', rule: index, section: name })
          }
        }
        current = current.filter(section => !rule.sections.includes(section.name) || kept.includes(section.name))
        return
      }
      case 'substitute':
        current = substitute(current, rule, index, options, warnings)
        return
      /* v8 ignore next 2 -- the union is closed and schema-validated, so no
         variant reaches here; the arm exists to fail a future unhandled one. */
      default:
        assertNever(rule, 'applyRules')
    }
  })

  return { sections: current, warnings }
}

/** Apply one `substitute` rule, reporting whatever it could not do. */
function substitute(
  sections: readonly AssembledSection[],
  rule: PromptRuleSubstitute,
  index: number,
  options: RuleApplyOptions,
  warnings: PromptPresetWarning[],
): AssembledSection[] {
  const unchanged = [...sections]
  if (rule.pattern.length > options.maxPatternLength) {
    warnings.push({ code: 'pattern-too-long', rule: index })
    return unchanged
  }
  // Compiled per use, never reused: a fresh instance cannot carry `lastIndex`
  // from the section before it, whatever flags the pattern was stored with.
  const compile = (): RegExp => new RegExp(rule.pattern, rule.flags ?? '')
  try {
    compile()
  } catch (error) {
    warnings.push({ code: 'invalid-pattern', rule: index, detail: errorText(error) })
    return unchanged
  }

  const targets = rule.sections === undefined || rule.sections.length === 0 ? undefined : rule.sections
  if (targets !== undefined) {
    for (const name of targets) {
      if (!unchanged.some(section => section.name === name)) {
        warnings.push({ code: 'unknown-section', rule: index, section: name })
      }
    }
  }

  const matched: string[] = []
  const next = unchanged.map((section) => {
    if (targets !== undefined && !targets.includes(section.name)) return section
    if (!compile().test(section.text)) return section
    matched.push(section.name)
    return { ...section, text: section.text.replace(compile(), rule.replacement) }
  })
  if (matched.length === 0) warnings.push({ code: 'no-match', rule: index })
  return next
}

/**
 * The message an engine attached to a thrown value, for verbatim display.
 * @param error - the thrown value.
 * @returns its message, or its string form when it carries none.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
