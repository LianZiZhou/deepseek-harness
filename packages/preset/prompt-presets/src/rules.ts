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
import { createdSectionName, sectionIdIssues, type CreatingRule } from './section-id.ts'
export { ruleSectionName } from './section-id.ts'
import type { PromptPreset, PromptPresetWarning, PromptRuleSubstitute } from './types.ts'

/** Regular-expression flags a `substitute` rule accepts. */
export const SUBSTITUTE_FLAGS = 'gimsu'

/** Deployment bounds and protections one application runs under. */
export interface RuleApplyOptions {
  /** Sections a `replace` keeps and a `remove` or `rewrite` may not target. */
  readonly protectedSections: readonly string[]
  /** Longest accepted regular-expression source. */
  readonly maxPatternLength: number
}

/** Preview observations from one ordered application of a preset. */
export interface RuleObserver {
  /**
   * Inspect the input to a rule, including disabled rules.
   * @param index - zero-based position of the rule.
   * @param sections - sections present before the rule runs.
   */
  beforeRule(index: number, sections: readonly AssembledSection[]): void
  /**
   * Record the section a rule successfully created.
   * @param index - zero-based position of the creating rule.
   * @param name - exact name of the new section.
   */
  created(index: number, name: string): void
}

/** What one application produced. */
export interface RuleApplyResult {
  /** The sections the preset puts in the assembly's place. */
  readonly sections: AssembledSection[]
  /** What the preset could not do exactly as written. */
  readonly warnings: readonly PromptPresetWarning[]
}

/** Place the new section at the position selected by its rule. */
function addSection(
  current: readonly AssembledSection[],
  rule: CreatingRule,
  index: number,
  options: RuleApplyOptions,
  warnings: PromptPresetWarning[],
  name: string,
): AssembledSection[] {
  const section = { name, order: 0, text: rule.text, interpolate: rule.interpolate === true }
  switch (rule.kind) {
    case 'prepend':
      return [section, ...current]
    case 'append':
      return [...current, section]
    case 'insert': {
      const at = current.findIndex(existing => existing.name === rule.after)
      if (at < 0) {
        warnings.push({ code: 'unknown-section', rule: index, section: rule.after })
        return [...current, section]
      }
      return [...current.slice(0, at + 1), section, ...current.slice(at + 1)]
    }
    case 'replace': {
      const kept = current.filter(existing => options.protectedSections.includes(existing.name))
      for (const existing of kept) {
        warnings.push({ code: 'protected-section-kept', rule: index, section: existing.name })
      }
      return [...kept, section]
    }
    /* v8 ignore next 2 -- all creating rule kinds are handled above. */
    default:
      return assertNever(rule, 'addSection')
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
 * @param observer - optional preview consumer of rule inputs and successful creations.
 * @returns the replacement sections and what did not happen as written.
 */
export function applyRules(
  sections: readonly AssembledSection[],
  preset: PromptPreset,
  options: RuleApplyOptions,
  observer?: RuleObserver,
): RuleApplyResult {
  const warnings: PromptPresetWarning[] = []
  let current: AssembledSection[] = sections.map(section => ({ ...section }))

  const idIssues = sectionIdIssues(preset.rules, sections.map(section => section.name))
  preset.rules.forEach((rule, index) => {
    observer?.beforeRule(index, current)
    if (rule.enabled === false) return
    switch (rule.kind) {
      case 'prepend':
      case 'append':
      case 'insert':
      case 'replace': {
        const issue = idIssues.get(index)
        if (issue) {
          warnings.push({ ...issue, rule: index })
          return
        }
        const name = createdSectionName(rule, index)
        current = addSection(current, rule, index, options, warnings, name)
        observer?.created(index, name)
        return
      }
      case 'rewrite': {
        const at = current.findIndex(section => section.name === rule.section)
        if (at < 0) {
          warnings.push({ code: 'unknown-section', rule: index, section: rule.section })
        } else if (options.protectedSections.includes(rule.section)) {
          warnings.push({ code: 'protected-section-kept', rule: index, section: rule.section })
        } else {
          current = current.map(section => section.name === rule.section
            ? { ...section, text: rule.text, interpolate: rule.interpolate === true }
            : section)
        }
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
