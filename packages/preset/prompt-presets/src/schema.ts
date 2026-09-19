/**
 * Runtime schemas for stored presets, and the checks the schema cannot express.
 *
 * The write path is where a person is looking, so everything wrong with a
 * preset is rejected here rather than at assembly: a settings document that
 * fails these checks keeps the namespace's last good value, while a preset
 * that made assembly throw would make the session unrunnable.
 *
 * @module @deepseek-ai/dsh-prompt-presets/schema
 */

import z from '@deepseek-ai/schemastery'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { errorText, SUBSTITUTE_FLAGS } from './rules.ts'
import type { PromptPreset, PromptRule, RuleApplyOptions } from './rules.ts'

/** The `[a-z0-9][a-z0-9-]*` grammar a preset id must match. */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** Runtime schema for one transform rule. */
export const PromptRuleSchema: z<PromptRule> = z.union([
  z.object({
    kind: z.const('prepend').required(),
    text: z.string().required(),
    interpolate: z.boolean(),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.const('append').required(),
    text: z.string().required(),
    interpolate: z.boolean(),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.const('insert').required(),
    after: z.string().required(),
    text: z.string().required(),
    interpolate: z.boolean(),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.const('replace').required(),
    text: z.string().required(),
    interpolate: z.boolean(),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.const('remove').required(),
    sections: z.array(z.string()).required(),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.const('substitute').required(),
    pattern: z.string().required(),
    flags: z.string(),
    replacement: z.string().required(),
    sections: z.array(z.string()),
    enabled: z.boolean(),
  }),
]) as z<PromptRule>

/** Runtime schema for one stored preset. */
export const PromptPresetSchema: z<PromptPreset> = z.object({
  name: z.string().required(),
  description: z.string(),
  rules: z.array(PromptRuleSchema).default([]),
}) as z<PromptPreset>

/** The user-settings section this package owns. */
export interface PromptPresetSettings {
  /** Stored presets by id; the deployment layer and the user layer union by key. */
  presets: Record<string, PromptPreset>
  /** The preset stamped into blank sessions; `''` means none. */
  default: string
}

/** Runtime schema for that section. */
export const PromptPresetSettingsSchema: z<PromptPresetSettings> = z.object({
  presets: z.dict(PromptPresetSchema).default({}),
  default: z.string().default(''),
})

/** What a rejected document could not satisfy, located at its rule. */
export interface PresetViolation {
  /** Why the document is unusable. */
  readonly reason: string
  /** Index of the rule at fault, when one rule is. */
  readonly rule?: number
}

/** Bounds and protections every stored preset is checked against. */
export interface PresetLimits extends RuleApplyOptions {
  /** Most presets one deployment stores. */
  readonly maxPresets: number
  /** Most rules one preset carries. */
  readonly maxRules: number
  /** Largest accepted rule text, in UTF-8 bytes. */
  readonly maxTextBytes: number
}

/**
 * Judge one preset document against the bounds its schema cannot express.
 * @param preset - the schema-valid document to judge.
 * @param limits - the deployment's bounds and protections.
 * @returns the first violation, or `undefined` when the document is usable.
 */
export function presetViolation(
  preset: PromptPreset,
  limits: PresetLimits,
): PresetViolation | undefined {
  if (preset.name.length === 0) return { reason: 'a preset needs a name' }
  if (preset.rules.length > limits.maxRules) {
    return { reason: `a preset carries at most ${limits.maxRules} rules` }
  }
  for (const [index, rule] of preset.rules.entries()) {
    const violation = ruleViolation(rule, limits)
    if (violation !== undefined) return { ...violation, rule: index }
  }
  return undefined
}

/** Judge one rule; the caller attaches its index. */
function ruleViolation(rule: PromptRule, limits: PresetLimits): { reason: string } | undefined {
  switch (rule.kind) {
    case 'insert':
      if (rule.after === '') return { reason: 'an insert rule needs the section it goes after' }
      return textViolation(rule.text, limits)
    case 'prepend':
    case 'append':
    case 'replace':
      return textViolation(rule.text, limits)
    case 'remove':
      return removalViolation(rule.sections, limits)
    case 'substitute': {
      if (rule.pattern.length === 0) return { reason: 'a substitute rule needs a pattern' }
      if (rule.pattern.length > limits.maxPatternLength) {
        return { reason: `pattern is ${rule.pattern.length} characters, over the ${limits.maxPatternLength}-character limit` }
      }
      const flags = rule.flags ?? ''
      for (const [position, flag] of Array.from(flags).entries()) {
        if (!SUBSTITUTE_FLAGS.includes(flag)) {
          return { reason: `flag "${flag}" is not one of ${SUBSTITUTE_FLAGS}` }
        }
        if (flags.indexOf(flag) !== position) return { reason: `flag "${flag}" is repeated` }
      }
      try {
        new RegExp(rule.pattern, flags)
      } catch (error) {
        return { reason: errorText(error) }
      }
      const bytes = Buffer.byteLength(rule.replacement, 'utf8')
      if (bytes > limits.maxTextBytes) {
        return { reason: `replacement is ${bytes} bytes, over the ${limits.maxTextBytes}-byte limit` }
      }
      // A substitution may name a protected section: it rewrites, never removes.
      return undefined
    }
    /* v8 ignore next 2 -- the union is closed and schema-validated, so no
       variant reaches here; the arm exists to fail a future unhandled one. */
    default:
      return assertNever(rule, 'ruleViolation')
  }
}

/** Judge one text-creating rule's text against the deployment's byte bound. */
function textViolation(text: string, limits: PresetLimits): { reason: string } | undefined {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > limits.maxTextBytes) {
    return { reason: `rule text is ${bytes} bytes, over the ${limits.maxTextBytes}-byte limit` }
  }
  return undefined
}

/** Judge a removal's section list: it must name something, and nothing protected. */
function removalViolation(
  sections: readonly string[],
  limits: PresetLimits,
): { reason: string } | undefined {
  if (sections.length === 0) return { reason: 'a remove rule needs at least one section' }
  for (const name of sections) {
    if (limits.protectedSections.includes(name)) {
      return { reason: `section "${name}" states a rule the executor enforces and cannot be removed` }
    }
  }
  return undefined
}

/**
 * Reject a whole settings section this package could not act on.
 *
 * Runs on the value the owner will read, so it sees the deployment layer and
 * the user layer exactly as merged.
 * @param value - the schema-valid resolved section.
 * @param limits - the deployment's bounds and protections.
 * @throws {Error} naming the preset and rule at fault.
 */
export function validatePresetSettings(value: PromptPresetSettings, limits: PresetLimits): void {
  const ids = Object.keys(value.presets)
  if (ids.length > limits.maxPresets) {
    throw new Error(`prompt-presets: ${ids.length} presets stored, over the ${limits.maxPresets} limit`)
  }
  for (const [id, preset] of Object.entries(value.presets)) {
    if (!PRESET_ID.test(id)) {
      throw new Error(`prompt-presets: preset id ${JSON.stringify(id)} must match ${String(PRESET_ID)}`)
    }
    const violation = presetViolation(preset, limits)
    if (violation !== undefined) {
      const at = violation.rule === undefined ? '' : ` rule ${violation.rule}:`
      throw new Error(`prompt-presets: preset ${JSON.stringify(id)}${at} ${violation.reason}`)
    }
  }
  if (value.default !== '' && !(value.default in value.presets)) {
    throw new Error(`prompt-presets: default preset ${JSON.stringify(value.default)} is not stored`)
  }
}
