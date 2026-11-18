/** Section IDs shared by the preset editor and the Host rule engine. */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { PromptRule } from './rules.ts'

/**
 * The default name a text-creating rule's section carries.
 * @param kind - the creating rule's discriminant.
 * @param index - the rule's position in its preset.
 * @returns the section name.
 */
export function ruleSectionName(kind: 'prepend' | 'append' | 'insert' | 'replace', index: number): string {
  return `prompt-preset:${kind}-${index}`
}

/** Rules that contribute a new identity to the section list. */
export type CreatingRule = Extract<PromptRule, { kind: 'prepend' | 'append' | 'insert' | 'replace' }>

/**
 * Resolve the effective section name for a creating rule.
 * @param rule - the rule whose section to identify.
 * @param index - its zero-based position in the preset.
 * @returns the exact or position-derived section name.
 */
export function createdSectionName(rule: CreatingRule, index: number): string
/**
 * Identify the section a rule would create, regardless of whether it runs.
 * @param rule - the rule to inspect.
 * @param index - its zero-based position in the preset.
 * @returns the section name, or undefined for non-creating rules.
 */
export function createdSectionName(rule: PromptRule, index: number): string | undefined
export function createdSectionName(rule: PromptRule, index: number): string | undefined {
  switch (rule.kind) {
    case 'prepend':
    case 'append':
      if (rule.sectionId) return rule.sectionId
      return ruleSectionName(rule.kind, index)
    case 'insert':
    case 'replace':
      return ruleSectionName(rule.kind, index)
    case 'remove':
    case 'rewrite':
    case 'substitute':
      return undefined
    /* v8 ignore next 2 -- all rule kinds are handled above. */
    default:
      return assertNever(rule, 'createdSectionName')
  }
}

/** A creation rule cannot claim its requested ID. */
interface SectionIdIssue {
  /** Whether the ID is malformed or another section owns it. */
  readonly code: 'invalid-section-id' | 'duplicate-section'
  /** The requested section ID. */
  readonly section: string
}

/**
 * Reserve baseline and generated IDs before assigning custom IDs in rule order.
 * @param rules - the entire preset, including disabled rules whose explicit IDs must still be well formed.
 * @param existing - section names from the assembly without the preset, when known.
 * @returns conflicts and syntax errors keyed by the index of the offending rule.
 */
export function sectionIdIssues(rules: readonly PromptRule[], existing: readonly string[] = []): ReadonlyMap<number, SectionIdIssue> {
  const issues = new Map<number, SectionIdIssue>()
  const taken = new Set(existing)
  function claim(index: number, section: string) {
    if (taken.has(section)) issues.set(index, { code: 'duplicate-section', section })
    else taken.add(section)
  }
  for (const [index, rule] of rules.entries()) {
    if (rule.enabled === false || ((rule.kind === 'prepend' || rule.kind === 'append') && rule.sectionId)) continue
    const name = createdSectionName(rule, index)
    if (name !== undefined) claim(index, name)
  }
  for (const [index, rule] of rules.entries()) {
    if ((rule.kind !== 'prepend' && rule.kind !== 'append') || !rule.sectionId) continue
    if (/\s/u.test(rule.sectionId)) issues.set(index, { code: 'invalid-section-id', section: rule.sectionId })
    else if (rule.enabled !== false) claim(index, rule.sectionId)
  }
  return issues
}
