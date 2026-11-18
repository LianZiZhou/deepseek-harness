import { describe, expect, it } from 'vitest'
import { PromptPresetSettingsSchema, presetViolation, validatePresetSettings } from '../src/schema.ts'
import type { PresetLimits, PresetViolation, PromptPresetSettings } from '../src/schema.ts'
import type { PromptPreset } from '@deepseek-ai/dsh-prompt-presets'

const LIMITS: PresetLimits = {
  protectedSections: ['tools:ptc-only'],
  maxPatternLength: 8,
  maxPresets: 2,
  maxRules: 2,
  maxTextBytes: 8,
}

function preset(rules: PromptPreset['rules'], name = 'Named'): PromptPreset {
  return { name, rules }
}

function settings(presets: Record<string, PromptPreset>, fallback = ''): PromptPresetSettings {
  return { presets, default: fallback }
}

describe('the stored-preset schema', () => {
  it('admits every rule kind and keeps each one\'s own fields', () => {
    const value = PromptPresetSettingsSchema(settings({
      all: preset([
        { kind: 'prepend', sectionId: 'my:head', text: 'a', interpolate: true },
        { kind: 'append', sectionId: 'my:tail', text: 'b' },
        { kind: 'rewrite', section: 'my:head', text: 'new', interpolate: false, enabled: true },
        { kind: 'insert', after: 'harness:identity', text: 'i' },
        { kind: 'replace', text: 'c' },
        { kind: 'remove', sections: ['x'] },
        { kind: 'substitute', pattern: 'p', flags: 'g', replacement: 'r', sections: ['x'] },
      ]),
    }))

    expect(value.presets['all']?.rules).toEqual([
      { kind: 'prepend', sectionId: 'my:head', text: 'a', interpolate: true },
      { kind: 'append', sectionId: 'my:tail', text: 'b' },
      { kind: 'rewrite', section: 'my:head', text: 'new', interpolate: false, enabled: true },
      { kind: 'insert', after: 'harness:identity', text: 'i' },
      { kind: 'replace', text: 'c' },
      { kind: 'remove', sections: ['x'] },
      { kind: 'substitute', pattern: 'p', flags: 'g', replacement: 'r', sections: ['x'] },
    ])
  })

  it('defaults an absent roster and an absent rule list', () => {
    const value = PromptPresetSettingsSchema({} as never)
    expect(value).toEqual({ presets: {}, default: '' })
    expect(PromptPresetSettingsSchema(settings({ bare: { name: 'Bare' } as never }) as never)
      .presets['bare']?.rules).toEqual([])
  })
})

describe('presetViolation()', () => {
  it('accepts a usable document', () => {
    expect(presetViolation(preset([{ kind: 'append', text: 'ok' }]), LIMITS)).toBeUndefined()
  })

  it('refuses a nameless document and one over the rule bound', () => {
    expect(presetViolation(preset([], ''), LIMITS)).toEqual({ reason: 'a preset needs a name' })
    expect(presetViolation(preset([
      { kind: 'append', text: 'a' },
      { kind: 'append', text: 'b' },
      { kind: 'append', text: 'c' },
    ]), LIMITS)).toEqual({ reason: 'a preset carries at most 2 rules' })
  })

  it('locates the offending rule by index', () => {
    expect(presetViolation(preset([
      { kind: 'append', text: 'ok' },
      { kind: 'remove', sections: [] },
    ]), LIMITS)).toEqual({ rule: 1, reason: 'a remove rule needs at least one section' })
  })

  it('needs an anchor on an insert, and bounds its text like any other', () => {
    expect(presetViolation(preset([{ kind: 'insert', after: '', text: 'ok' }]), LIMITS))
      .toEqual({ rule: 0, reason: 'an insert rule needs the section it goes after' })
    expect(presetViolation(preset([{ kind: 'insert', after: 'harness:identity', text: 'far too long' }]), LIMITS))
      .toMatchObject({ reason: 'rule text is 12 bytes, over the 8-byte limit' })
    // An insert may name a protected section: it adds beside one, never removes it.
    expect(presetViolation(preset([{ kind: 'insert', after: 'tools:ptc-only', text: 'ok' }]), LIMITS))
      .toBeUndefined()
  })

  it('validates a rewrite target, its protection and its UTF-8 text bound', () => {
    const rewrite = (section: string, text = ''): PresetViolation | undefined =>
      presetViolation(preset([{ kind: 'rewrite', section, text }]), LIMITS)

    expect(rewrite('')).toEqual({ rule: 0, reason: 'a rewrite rule needs a section id' })
    expect(rewrite('my:custom section')).toBeUndefined()
    expect(rewrite('tools:ptc-only')).toEqual({ rule: 0, reason: 'section "tools:ptc-only" states a rule the executor enforces and cannot be rewritten' })
    expect(rewrite('my:section', '你好呀')).toEqual({ rule: 0, reason: 'rule text is 9 bytes, over the 8-byte limit' })
    expect(rewrite('my:section')).toBeUndefined()
  })

  it('accepts an empty custom id, but never trims or splits a nonempty one', () => {
    for (const kind of ['prepend', 'append'] as const) {
      expect(presetViolation(preset([{ kind, sectionId: '', text: 'ok' }]), LIMITS)).toBeUndefined()
      for (const sectionId of [' ', 'a ', 'one two', '\tx']) {
        expect(presetViolation(preset([{ kind, sectionId, text: 'ok' }]), LIMITS))
          .toEqual({ rule: 0, reason: 'a section id cannot contain whitespace' })
      }
    }
  })

  it('refuses a section id on rule kinds that do not support one', () => {
    const rule = { kind: 'insert', after: 'my:head', text: 'ok', sectionId: 'bad' } as const
    expect(presetViolation(preset([rule]), LIMITS))
      .toEqual({ rule: 0, reason: 'only prepend and append rules accept a section id' })
  })

  it('rejects duplicate effective creation IDs, excluding disabled rules', () => {
    const append = { kind: 'append', sectionId: 'my:section', text: 'a' } as const
    const prepend = { kind: 'prepend', sectionId: 'my:section', text: 'b' } as const
    const insert = { kind: 'insert', after: 'anchor', text: 'c' } as const
    for (const [rules, offending] of [
      [[append, prepend], 1],
      [[{ ...append, sectionId: 'prompt-preset:insert-1' }, insert], 0],
      [[insert, { ...append, sectionId: 'prompt-preset:insert-0' }], 1],
    ] as const) {
      const violation = presetViolation(preset([...rules]), LIMITS)
      expect(violation?.rule).toBe(offending)
      expect(violation?.reason).toContain('more than one rule creates section')
    }
    expect(presetViolation(preset([{ ...prepend, enabled: false }, append]), LIMITS)).toBeUndefined()
    expect(presetViolation(preset([append, { ...prepend, enabled: false }]), LIMITS)).toBeUndefined()
  })

  it('bounds created text and a replacement separately', () => {
    expect(presetViolation(preset([{ kind: 'prepend', text: 'far too long' }]), LIMITS))
      .toMatchObject({ reason: 'rule text is 12 bytes, over the 8-byte limit' })
    expect(presetViolation(preset([{ kind: 'substitute', pattern: 'p', replacement: 'far too long' }]), LIMITS))
      .toMatchObject({ reason: 'replacement is 12 bytes, over the 8-byte limit' })
  })

  it('judges a substitution\'s pattern, its flags, and the sections it names', () => {
    const bad = (rule: PromptPreset['rules'][number]): PresetViolation | undefined =>
      presetViolation(preset([rule]), LIMITS)

    expect(bad({ kind: 'substitute', pattern: '', replacement: '' }))
      .toMatchObject({ reason: 'a substitute rule needs a pattern' })
    expect(bad({ kind: 'substitute', pattern: 'x'.repeat(9), replacement: '' }))
      .toMatchObject({ reason: 'pattern is 9 characters, over the 8-character limit' })
    expect(bad({ kind: 'substitute', pattern: '(', replacement: '' })?.reason).toContain('group')
    expect(bad({ kind: 'substitute', pattern: 'a', flags: 'y', replacement: '' }))
      .toMatchObject({ reason: 'flag "y" is not one of gimsu' })
    expect(bad({ kind: 'substitute', pattern: 'a', flags: 'gg', replacement: '' }))
      .toMatchObject({ reason: 'flag "g" is repeated' })
    // A substitution may name a protected section: it rewrites, never removes.
    expect(bad({ kind: 'substitute', pattern: 'a', replacement: 'b', sections: ['tools:ptc-only'] }))
      .toBeUndefined()
  })

  it('refuses a removal that names a section the deployment protects', () => {
    expect(presetViolation(preset([{ kind: 'remove', sections: ['tool:bash', 'tools:ptc-only'] }]), LIMITS))
      .toMatchObject({ reason: 'section "tools:ptc-only" states a rule the executor enforces and cannot be removed' })
  })
})

describe('validatePresetSettings()', () => {
  it('accepts a usable document', () => {
    expect(() => { validatePresetSettings(settings({ a: preset([]) }, 'a'), LIMITS) }).not.toThrow()
  })

  it('refuses a roster over the deployment bound', () => {
    expect(() => {
      validatePresetSettings(settings({ a: preset([]), b: preset([]), c: preset([]) }), LIMITS)
    }).toThrow('3 presets stored, over the 2 limit')
  })

  it('refuses an id the storage key grammar rejects', () => {
    expect(() => { validatePresetSettings(settings({ 'Not Valid': preset([]) }), LIMITS) })
      .toThrow(/preset id "Not Valid" must match/)
  })

  it('names the preset and the rule behind an unusable document', () => {
    expect(() => {
      validatePresetSettings(settings({ a: preset([{ kind: 'remove', sections: [] }]) }), LIMITS)
    }).toThrow('prompt-presets: preset "a" rule 0: a remove rule needs at least one section')
    expect(() => { validatePresetSettings(settings({ a: preset([], '') }), LIMITS) })
      .toThrow('prompt-presets: preset "a" a preset needs a name')
  })

  it('refuses a default the roster does not supply', () => {
    expect(() => { validatePresetSettings(settings({ a: preset([]) }, 'b'), LIMITS) })
      .toThrow('default preset "b" is not stored')
  })
})
