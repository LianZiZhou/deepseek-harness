import { describe, expect, it } from 'vitest'
import { RULE_KINDS } from '../src/client/preset-model.ts'
import { en, zh } from '../src/client/locales.ts'

/** Every warning code the Host can send, so the map below stays complete. */
const WARNING_CODES = [
  'invalid-pattern', 'pattern-too-long', 'unknown-section', 'no-match',
  'protected-section-kept', 'complete-section-overridden', 'render-failed',
  'unknown-preset', 'empty-prompt',
] as const

describe('the prompt-preset dictionaries', () => {
  it('carry identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('leave no entry empty', () => {
    expect(Object.entries(en).filter(([, value]) => value === '')).toEqual([])
    expect(Object.entries(zh).filter(([, value]) => value === '')).toEqual([])
  })

  it('name and explain every rule kind in both languages', () => {
    for (const kind of RULE_KINDS) {
      expect(en[`rule.${kind}.name`]).toMatch(/./)
      expect(en[`rule.${kind}.hint`]).toMatch(/./)
      expect(zh[`rule.${kind}.name`]).toMatch(/./)
      expect(zh[`rule.${kind}.hint`]).toMatch(/./)
    }
  })

  it('word every warning code the Host can send', () => {
    const keys = Object.keys(en).filter(key => key.startsWith('preview.warn.'))
    // One key per code, plus the fallback that prints an unrecognized one.
    expect(keys).toHaveLength(WARNING_CODES.length + 1)
    expect(keys).toContain('preview.warn.unknown')
  })

  it('says a switch applies from the next turn, in both languages', () => {
    expect(en['seat.appliesNextTurn']).toContain('next turn')
    expect(zh['seat.appliesNextTurn']).toContain('下一轮')
  })
})
