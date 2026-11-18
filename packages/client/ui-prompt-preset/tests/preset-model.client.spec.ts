import { describe, expect, it } from 'vitest'
import type { PromptRule } from '@deepseek-ai/dsh-prompt-presets/types'
import {
  RULE_KINDS, draftBlocker, emptyRule, idBlocker, isShadowed, mintRuleKey,
  ruleBlocker, wireRules,
} from '../src/client/preset-model.ts'
import type { DraftRule, PresetDraft } from '../src/client/preset-model.ts'

/** A draft holding the given rules, as the editor would. */
function draft(...rules: PromptRule[]): PresetDraft {
  return {
    id: 'mine',
    name: 'Mine',
    description: '',
    rules: rules.map((rule): DraftRule => ({ key: mintRuleKey(), rule })),
    revision: undefined,
    dirty: true,
  }
}

describe('emptyRule()', () => {
  it('builds every kind at its empty value', () => {
    expect(RULE_KINDS.map(kind => emptyRule(kind))).toEqual([
      { kind: 'prepend', text: '' },
      { kind: 'append', text: '' },
      { kind: 'insert', after: '', text: '' },
      { kind: 'rewrite', section: '', text: '' },
      { kind: 'replace', text: '' },
      { kind: 'remove', sections: [] },
      { kind: 'substitute', pattern: '', replacement: '' },
    ])
  })
})

describe('ruleBlocker()', () => {
  it('accepts a usable rule of every kind', () => {
    expect(ruleBlocker({ kind: 'prepend', text: 'hello' })).toBeUndefined()
    expect(ruleBlocker({ kind: 'remove', sections: ['tool:bash'] })).toBeUndefined()
    expect(ruleBlocker({ kind: 'substitute', pattern: 'a', flags: 'gi', replacement: 'b' }))
      .toBeUndefined()
  })

  it('refuses empty text, an empty removal, and an empty pattern', () => {
    expect(ruleBlocker({ kind: 'append', text: '   ' })).toEqual({ key: 'rule.error.textRequired' })
    expect(ruleBlocker({ kind: 'remove', sections: [] })).toEqual({ key: 'rule.error.sectionsRequired' })
    expect(ruleBlocker({ kind: 'substitute', pattern: '', replacement: '' }))
      .toEqual({ key: 'rule.error.patternRequired' })
  })

  it('refuses a flag outside the accepted set and a repeated one', () => {
    expect(ruleBlocker({ kind: 'substitute', pattern: 'a', flags: 'y', replacement: '' }))
      .toEqual({ key: 'rule.error.flagsInvalid' })
    expect(ruleBlocker({ kind: 'substitute', pattern: 'a', flags: 'gg', replacement: '' }))
      .toEqual({ key: 'rule.error.flagsInvalid' })
  })

  it('reports an unusable pattern with the engine\'s own message', () => {
    const blocker = ruleBlocker({ kind: 'substitute', pattern: '(', replacement: '' })
    expect(blocker?.key).toBe('rule.error.patternSyntax')
    expect(blocker?.params?.['message']).toMatch(/./)
  })
})

describe('draftBlocker()', () => {
  it('accepts a usable stack and locates the first offender by index', () => {
    expect(draftBlocker(draft({ kind: 'append', text: 'ok' }))).toBeUndefined()
    expect(draftBlocker(draft({ kind: 'append', text: 'ok' }, { kind: 'remove', sections: [] })))
      .toEqual({ index: 1, blocker: { key: 'rule.error.sectionsRequired' } })
  })

  it('skips a rule its author turned off', () => {
    expect(draftBlocker(draft({ kind: 'append', text: '', enabled: false }))).toBeUndefined()
  })

  it('refuses a second enabled replace, and accepts one when the other is off', () => {
    expect(draftBlocker(draft(
      { kind: 'replace', text: 'a' },
      { kind: 'replace', text: 'b' },
    ))).toEqual({ index: 1, blocker: { key: 'rule.error.replaceDuplicate' } })
    expect(draftBlocker(draft(
      { kind: 'replace', text: 'a', enabled: false },
      { kind: 'replace', text: 'b' },
    ))).toBeUndefined()
  })
})

describe('section IDs', () => {
  it('reserves generated names on either side of a custom ID, including insert and replace', () => {
    for (const creator of [
      { kind: 'prepend', text: 'first' }, { kind: 'append', text: 'last' },
      { kind: 'insert', after: 'anchor', text: 'next' }, { kind: 'replace', text: 'only' },
    ] as const) {
      for (const index of [0, 1]) {
        const section = `prompt-preset:${creator.kind}-${String(index)}`
        const custom = { kind: 'append', text: 'other', sectionId: section } as const
        const rules = index === 0 ? [creator, custom] : [custom, creator]
        expect(draftBlocker(draft(...rules))).toEqual({
          index: 1 - index, blocker: { key: 'rule.error.duplicateSection', params: { section } },
        })
      }
    }
  })

  it('accepts unused IDs with legacy prefixes and ignores disabled creators', () => {
    const rule = { kind: 'prepend', text: 'first', sectionId: 'prompt-preset:append-1' } as const
    expect(draftBlocker(draft(rule, { kind: 'append', text: 'last', enabled: false }))).toBeUndefined()
    expect(draftBlocker(draft(rule, { ...rule, enabled: false }))).toBeUndefined()
    expect(draftBlocker(draft(rule, rule))?.blocker.key).toBe('rule.error.duplicateSection')
    expect(draftBlocker(draft({ ...rule, sectionId: 'not one' }))?.blocker.key).toBe('rule.error.sectionIdInvalid')
    expect(draftBlocker(draft({ ...rule, enabled: false, sectionId: 'not one' }))?.blocker.key).toBe('rule.error.sectionIdInvalid')
    expect(draftBlocker(draft({ kind: 'rewrite', section: 'protected', text: '', enabled: false }), [], ['protected'])?.blocker.key)
      .toBe('rule.error.protectedSection')
    expect(draftBlocker(draft({ kind: 'rewrite', section: 'free', text: '', enabled: false }))).toBeUndefined()
    expect(draftBlocker(draft({ ...rule, sectionId: '' }))).toBeUndefined()
    expect(draftBlocker(draft({ kind: 'append', text: 'x' }), ['prompt-preset:append-0'])?.blocker.key)
      .toBe('rule.error.duplicateSection')
  })

  it('judges rewrite text and target separately and permits protected anchors and substitution scopes', () => {
    expect(ruleBlocker({ kind: 'rewrite', section: '', text: 'ok' })?.key).toBe('rule.error.sectionRequired')
    expect(ruleBlocker({ kind: 'rewrite', section: 'a', text: '' })).toBeUndefined()
    expect(ruleBlocker({ kind: 'rewrite', section: 'real id', text: 'ok' })).toBeUndefined()
    expect(ruleBlocker({ kind: 'insert', after: 'a', text: 'ok' }, ['a'])).toBeUndefined()
    expect(ruleBlocker({ kind: 'substitute', sections: ['a'], pattern: 'a', replacement: '' }, ['a'])).toBeUndefined()
  })
})

describe('isShadowed()', () => {
  it('marks a later remove or substitute inert once an enabled replace runs', () => {
    const rules = draft(
      { kind: 'replace', text: 'only' },
      { kind: 'remove', sections: ['x'] },
      { kind: 'append', text: 'still counts' },
    ).rules
    expect(isShadowed(rules, 0)).toBe(false)
    expect(isShadowed(rules, 1)).toBe(true)
    expect(isShadowed(rules, 2)).toBe(false)
  })

  it('does not mark protected, replaced or newly created targets inert if the Host still offers them', () => {
    const rules = draft(
      { kind: 'replace', text: 'only' },
      { kind: 'append', sectionId: 'extra', text: 'later' },
      { kind: 'rewrite', section: 'extra', text: 'new' },
      { kind: 'substitute', pattern: 'a', replacement: 'b' },
      { kind: 'insert', after: 'missing', text: 'last' },
    ).rules
    expect(isShadowed(rules, 2, ['extra'])).toBe(false)
    expect(isShadowed(rules, 2, [])).toBe(true)
    expect(isShadowed(rules, 3, ['protected'])).toBe(false)
    expect(isShadowed(rules, 3, [])).toBe(true)
    expect(isShadowed(rules, 4, [])).toBe(false)
  })

  it('marks nothing when the replace is off, and nothing for a disabled rule', () => {
    const off = draft(
      { kind: 'replace', text: 'only', enabled: false },
      { kind: 'remove', sections: ['x'] },
    ).rules
    expect(isShadowed(off, 1)).toBe(false)

    const disabled = draft(
      { kind: 'replace', text: 'only' },
      { kind: 'remove', sections: ['x'], enabled: false },
    ).rules
    expect(isShadowed(disabled, 1)).toBe(false)
    expect(isShadowed(disabled, 9)).toBe(false)
  })
})

describe('idBlocker()', () => {
  it('accepts a usable id and refuses an empty, malformed, or taken one', () => {
    expect(idBlocker('terse', ['other'])).toBeUndefined()
    expect(idBlocker('', [])).toEqual({ key: 'idRequired' })
    expect(idBlocker('Not Valid', [])).toEqual({ key: 'idInvalid' })
    expect(idBlocker('terse', ['terse'])).toEqual({ key: 'idTaken' })
  })
})

describe('wireRules()', () => {
  it('sends every rule, disabling the ones an author has not finished', () => {
    expect(wireRules(draft(
      { kind: 'append', text: 'ok' },
      { kind: 'substitute', pattern: '(', replacement: '' },
    ))).toEqual([
      { kind: 'append', text: 'ok' },
      { kind: 'substitute', pattern: '(', replacement: '', enabled: false },
    ])
  })
})

describe('mintRuleKey()', () => {
  it('never repeats a key', () => {
    expect(mintRuleKey()).not.toBe(mintRuleKey())
  })
})
