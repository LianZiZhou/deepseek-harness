/**
 * Pure editor model: the draft a rule stack is edited as, and the checks that
 * decide whether Save is offered.
 *
 * The Host is authoritative — it re-judges every write against the deployment's
 * own bounds — so nothing here duplicates a limit. These checks exist so a
 * person sees the mistake beside the field instead of after a round trip.
 */

import { sectionIdIssues } from '@deepseek-ai/dsh-prompt-presets/section-id'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { PromptRule, PromptRuleKind } from '@deepseek-ai/dsh-prompt-presets/types'
import type { PromptPresetKey } from './locales.ts'

/** Flags a substitution accepts, mirroring the Host vocabulary. */
const FLAGS = 'gimsu'

/** The id grammar the Host stores presets under. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** Every rule kind, in the order the add menu offers them. */
export const RULE_KINDS: readonly PromptRuleKind[] = [
  'prepend', 'append', 'insert', 'rewrite', 'replace', 'remove', 'substitute',
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
    case 'rewrite':
      return { kind, section: '', text: '' }
    case 'remove':
      return { kind, sections: [] }
    case 'substitute':
      return { kind, pattern: '', replacement: '' }
    /* v8 ignore next -- all wire kinds are handled above. */
    default: return assertNever(kind)
  }
}

/**
 * Judge one rule.
 * @param rule - the rule to judge.
 * @param protectedSections - names this deployment does not let a rule remove or rewrite.
 * @returns the first complaint, or `undefined` when the rule is usable.
 */
export function ruleBlocker(rule: PromptRule, protectedSections: readonly string[] = []): Blocker | undefined {
  switch (rule.kind) {
    case 'prepend':
    case 'append':
    case 'replace':
      return rule.text.trim() === '' ? { key: 'rule.error.textRequired' } : undefined
    case 'insert':
      if (rule.after.trim() === '') return { key: 'rule.error.anchorRequired' }
      return rule.text.trim() === '' ? { key: 'rule.error.textRequired' } : undefined
    case 'rewrite':
      if (rule.section.trim() === '') return { key: 'rule.error.sectionRequired' }
      return protectedSections.includes(rule.section) ? protectedBlocker(rule.section) : undefined
    case 'remove': {
      const protectedName = rule.sections.find(name => protectedSections.includes(name))
      if (protectedName !== undefined) return protectedBlocker(protectedName)
      return rule.sections.length === 0 ? { key: 'rule.error.sectionsRequired' } : undefined
    }
    case 'substitute': {
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
    /* v8 ignore next -- all wire kinds are handled above. */
    default: return assertNever(rule)
  }
}

function protectedBlocker(section: string): Blocker {
  return { key: 'rule.error.protectedSection', params: { section } }
}

/**
 * Judge a whole draft, locating the rule at fault.
 * @param draft - the draft to judge.
 * @param baseline - names already contributed by the assembly.
 * @param protectedSections - names protected by the deployment, even without a preview.
 * @returns the first offending rule index with its complaint, or `undefined`.
 */
export function draftBlocker(
  draft: PresetDraft,
  baseline: readonly string[] = [],
  protectedSections: readonly string[] = [],
): { index: number; blocker: Blocker } | undefined {
  const idIssues = sectionIdIssues(draft.rules.map(entry => entry.rule), baseline)
  let replaced = false
  for (const [index, { rule }] of draft.rules.entries()) {
    const issue = idIssues.get(index)
    if (issue) {
      const blocker: Blocker = issue.code === 'invalid-section-id'
        ? { key: 'rule.error.sectionIdInvalid' }
        : { key: 'rule.error.duplicateSection', params: { section: issue.section } }
      return { index, blocker }
    }
    if (rule.enabled === false) {
      const blocker = rule.kind === 'rewrite' ? ruleBlocker(rule, protectedSections) : undefined
      if (blocker !== undefined) return { index, blocker }
      continue
    }
    if (rule.kind === 'replace') {
      if (replaced) return { index, blocker: { key: 'rule.error.replaceDuplicate' } }
      replaced = true
    }
    const blocker = ruleBlocker(rule, protectedSections)
    if (blocker !== undefined) return { index, blocker }
  }
  return undefined
}

/**
 * Whether an earlier enabled replacement leaves this rule no target.
 * @param rules - the whole ordered stack.
 * @param index - the rule to judge.
 * @param available - Host names immediately before this rule, when previewed.
 * @returns whether the rule has no remaining target after a replacement.
 */
export function isShadowed(rules: readonly DraftRule[], index: number, available?: readonly string[]): boolean {
  const rule = rules[index]?.rule
  if (rule === undefined || rule.enabled === false) return false
  if (!rules.slice(0, index).some(entry => entry.rule.kind === 'replace' && entry.rule.enabled !== false)) return false
  // Insert still appends its text if its anchor disappeared.
  if (rule.kind !== 'remove' && rule.kind !== 'substitute' && rule.kind !== 'rewrite') return false
  if (available === undefined) return rule.kind !== 'rewrite'
  const targets = rule.kind === 'rewrite' ? [rule.section] : rule.sections
  if (!targets?.length) return available.length === 0
  return !targets.some(name => available.includes(name))
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
