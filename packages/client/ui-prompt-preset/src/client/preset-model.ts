/**
 * Pure editor model: the draft a rule stack is edited as, and the checks that
 * decide whether Save is offered.
 *
 * The Host is authoritative — it re-judges every write against the deployment's
 * own bounds — so nothing here duplicates a limit. These checks exist so a
 * person sees the mistake beside the field instead of after a round trip.
 */

import type { PromptRule, PromptRuleKind } from '@deepseek-ai/dsh-prompt-presets/types'
import type { PromptPresetKey } from './locales.ts'

/** Flags a substitution accepts, mirroring the Host vocabulary. */
const FLAGS = 'gimsu'

/** The id grammar the Host stores presets under. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** Every rule kind, in the order the add menu offers them. */
export const RULE_KINDS: readonly PromptRuleKind[] = [
  'prepend', 'append', 'insert', 'replace', 'remove', 'substitute',
]

/** One rule as the editor holds it: the wire rule plus a key React can track. */
export interface DraftRule {
  /** Stable across reorder and edit, so an open card never remounts. */
  readonly key: string
  /** The rule exactly as it will be sent. */
  readonly rule: PromptRule
}

/** One preset as the editor holds it. */
export interface PresetDraft {
  /** The storage key; immutable once created. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly rules: readonly DraftRule[]
  /** The roster revision this draft opened at, which fences its save. */
  readonly revision: number | undefined
  /** Whether anything has been edited since the draft opened. */
  readonly dirty: boolean
}

/** One localizable complaint about a field. */
export interface Blocker {
  /** The dictionary key naming what is wrong. */
  readonly key: PromptPresetKey
  /** Values the message interpolates. */
  readonly params?: Record<string, string>
}

let minted = 0

/**
 * Mint one editor key.
 * @returns a key unique within this browser session.
 */
export function mintRuleKey(): string {
  minted += 1
  return `rule-${String(minted)}`
}

/**
 * Build an empty rule of one kind.
 * @param kind - the rule kind to create.
 * @returns the rule, with every field at its empty value.
 */
export function emptyRule(kind: PromptRuleKind): PromptRule {
  switch (kind) {
    case 'prepend':
    case 'append':
    case 'replace':
      return { kind, text: '' }
    case 'insert':
      return { kind, after: '', text: '' }
    case 'remove':
      return { kind, sections: [] }
    default:
      return { kind: 'substitute', pattern: '', replacement: '' }
  }
}

/**
 * Judge one rule.
 * @param rule - the rule to judge.
 * @returns the first complaint, or `undefined` when the rule is usable.
 */
export function ruleBlocker(rule: PromptRule): Blocker | undefined {
  switch (rule.kind) {
    case 'prepend':
    case 'append':
    case 'replace':
      return rule.text.trim() === '' ? { key: 'rule.error.textRequired' } : undefined
    case 'insert':
      if (rule.after.trim() === '') return { key: 'rule.error.anchorRequired' }
      return rule.text.trim() === '' ? { key: 'rule.error.textRequired' } : undefined
    case 'remove':
      return rule.sections.length === 0 ? { key: 'rule.error.sectionsRequired' } : undefined
    default: {
      if (rule.pattern === '') return { key: 'rule.error.patternRequired' }
      const flags = rule.flags ?? ''
      const invalid = Array.from(flags).some((flag, position) =>
        !FLAGS.includes(flag) || flags.indexOf(flag) !== position)
      if (invalid) return { key: 'rule.error.flagsInvalid' }
      try {
        new RegExp(rule.pattern, flags)
      } catch (error) {
        // The engine's own message is data, shown exactly as it came.
        return {
          key: 'rule.error.patternSyntax',
          /* v8 ignore next -- RegExp rejects a pattern only with a SyntaxError. */
          params: { message: error instanceof Error ? error.message : String(error) },
        }
      }
      return undefined
    }
  }
}

/**
 * Judge a whole draft, locating the rule at fault.
 * @param draft - the draft to judge.
 * @returns the first offending rule index with its complaint, or `undefined`.
 */
export function draftBlocker(draft: PresetDraft): { index: number; blocker: Blocker } | undefined {
  let replaced = false
  for (const [index, entry] of draft.rules.entries()) {
    if (entry.rule.enabled === false) continue
    if (entry.rule.kind === 'replace') {
      if (replaced) return { index, blocker: { key: 'rule.error.replaceDuplicate' } }
      replaced = true
    }
    const blocker = ruleBlocker(entry.rule)
    if (blocker !== undefined) return { index, blocker }
  }
  return undefined
}

/**
 * Whether a rule can still change the prompt, given the rules before it.
 *
 * An enabled `replace` leaves only its own text and the protected sections, so
 * a later rule that targets existing sections has nothing of theirs to act on.
 * @param rules - the whole ordered stack.
 * @param index - the rule to judge.
 * @returns whether an earlier `replace` makes this rule inert.
 */
export function isShadowed(rules: readonly DraftRule[], index: number): boolean {
  const rule = rules[index]?.rule
  if (rule === undefined || rule.enabled === false) return false
  // An `insert` names an anchor a `replace` already dropped, so it is shadowed
  // the same way a `remove` or a `substitute` is.
  if (rule.kind !== 'remove' && rule.kind !== 'substitute' && rule.kind !== 'insert') return false
  return rules.slice(0, index)
    .some(entry => entry.rule.kind === 'replace' && entry.rule.enabled !== false)
}

/**
 * Judge one proposed preset id against the grammar and the stored ids.
 * @param id - the id a person typed.
 * @param taken - ids the roster already supplies.
 * @returns the complaint, or `undefined` when the id is usable.
 */
export function idBlocker(id: string, taken: readonly string[]): Blocker | undefined {
  if (id === '') return { key: 'idRequired' }
  if (!PRESET_ID.test(id)) return { key: 'idInvalid' }
  return taken.includes(id) ? { key: 'idTaken' } : undefined
}

/**
 * The rules a draft sends, with every rule its author has not finished disabled.
 *
 * A half-typed pattern would otherwise make the Host skip the rule and report a
 * warning about it; disabling it says the same thing without the noise.
 * @param draft - the draft to send.
 * @returns the wire rules.
 */
export function wireRules(draft: PresetDraft): PromptRule[] {
  return draft.rules.map(entry =>
    ruleBlocker(entry.rule) === undefined ? entry.rule : { ...entry.rule, enabled: false })
}

/**
 * Parse a comma-separated section list the way the field displays it.
 * @param text - the raw field text.
 * @returns the named sections, empty entries dropped.
 */
export function parseSections(text: string): string[] {
  return text.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
}
