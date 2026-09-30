import { describe, expect, it } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { AssembledSection, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { applyRules, ruleSectionName } from '@deepseek-ai/dsh-prompt-presets'
import type { PromptPreset, PromptRule, RuleApplyOptions } from '@deepseek-ai/dsh-prompt-presets'

const OPTIONS: RuleApplyOptions = {
  protectedSections: ['tools:ptc-only'],
  maxPatternLength: 64,
}

const SECTIONS: readonly AssembledSection[] = [
  { name: 'harness:identity', text: 'You are an agent.' },
  { name: 'tools:ptc-only', text: 'Only call tools through code.' },
  { name: 'tool:bash', text: 'Prefer bash for files.' },
]

function preset(...rules: PromptRule[]): PromptPreset {
  return { name: 'test', rules }
}

/** Apply a stack and read back the section names in final order. */
function names(...rules: PromptRule[]): string[] {
  return applyRules(SECTIONS, preset(...rules), OPTIONS).sections.map(section => section.name)
}

/** Render the result the way a step would, so order is observable as text. */
function rendered(...rules: PromptRule[]): string {
  const assembly: PromptAssembly = {
    sections: applyRules(SECTIONS, preset(...rules), OPTIONS).sections,
    contexts: [],
    tools: [],
    variables: {},
  }
  return renderPrompt(assembly)
}

describe('applyRules()', () => {
  it('leaves the input sections and the non-section assembly inputs alone', () => {
    const input = SECTIONS.map(section => ({ ...section }))
    const result = applyRules(input, preset({ kind: 'prepend', text: 'ahead' }), OPTIONS)
    expect(input).toEqual(SECTIONS)
    expect(result.sections[0]).not.toBe(input[0])
    expect(result.warnings).toEqual([])
  })

  it('puts prepended text first and appended text last in the rendered prompt', () => {
    const text = rendered(
      { kind: 'prepend', text: 'FIRST' },
      { kind: 'append', text: 'LAST' },
    )
    expect(text.startsWith('FIRST')).toBe(true)
    expect(text.endsWith('LAST')).toBe(true)
    expect(names({ kind: 'prepend', text: 'FIRST' })[0]).toBe(ruleSectionName('prepend', 0))
  })

  it('applies rules in array order, so a later rule sees what an earlier one created', () => {
    const result = applyRules(
      SECTIONS,
      preset(
        { kind: 'prepend', text: 'alpha' },
        { kind: 'substitute', pattern: 'alpha', replacement: 'beta', sections: [ruleSectionName('prepend', 0)] },
      ),
      OPTIONS,
    )
    expect(result.sections[0]).toMatchObject({ name: ruleSectionName('prepend', 0), text: 'beta' })
    expect(result.warnings).toEqual([])
  })

  it('skips a rule its author turned off', () => {
    expect(names({ kind: 'prepend', text: 'off', enabled: false })).toEqual(SECTIONS.map(s => s.name))
    expect(names({ kind: 'prepend', text: 'on', enabled: true })[0]).toBe(ruleSectionName('prepend', 0))
  })

  it('leaves rule text literal unless the rule asks for interpolation', () => {
    const result = applyRules(SECTIONS, preset(
      { kind: 'prepend', text: 'braces {{unknown}} stay' },
      { kind: 'append', text: 'route {{model}}', interpolate: true },
    ), OPTIONS)
    expect(result.sections[0]?.interpolate).toBe(false)
    expect(result.sections.at(-1)?.interpolate).toBe(true)
  })

  it('keeps protected sections through a replace, in their original relative order', () => {
    const result = applyRules(SECTIONS, preset({ kind: 'replace', text: 'ONLY THIS' }), OPTIONS)
    expect(result.sections.map(section => section.name))
      .toEqual(['tools:ptc-only', ruleSectionName('replace', 0)])
    expect(result.warnings).toEqual([
      { code: 'protected-section-kept', rule: 0, section: 'tools:ptc-only' },
    ])
  })

  it('composes replace with a later substitute over the text it produced', () => {
    const text = rendered(
      { kind: 'replace', text: 'hello world' },
      { kind: 'substitute', pattern: 'world', replacement: 'there' },
    )
    expect(text).toContain('hello there')
  })

  it('removes sections by exact name and warns about a name nothing carries', () => {
    const result = applyRules(
      SECTIONS,
      preset({ kind: 'remove', sections: ['tool:bash', 'tool:absent'] }),
      OPTIONS,
    )
    expect(result.sections.map(section => section.name)).toEqual(['harness:identity', 'tools:ptc-only'])
    expect(result.warnings).toEqual([{ code: 'unknown-section', rule: 0, section: 'tool:absent' }])
  })

  it('substitutes across every section by default and reports a pattern that matched nothing', () => {
    const hit = applyRules(SECTIONS, preset(
      { kind: 'substitute', pattern: '\\.', flags: 'g', replacement: '!' },
    ), OPTIONS)
    expect(hit.sections.map(section => section.text))
      .toEqual(['You are an agent!', 'Only call tools through code!', 'Prefer bash for files!'])
    expect(hit.warnings).toEqual([])

    const miss = applyRules(SECTIONS, preset(
      { kind: 'substitute', pattern: 'nowhere', replacement: 'x' },
    ), OPTIONS)
    expect(miss.warnings).toEqual([{ code: 'no-match', rule: 0 }])
  })

  it('restricts a substitution to the sections it names and warns about the rest', () => {
    const result = applyRules(SECTIONS, preset(
      { kind: 'substitute', pattern: 'bash', replacement: 'pwsh', sections: ['tool:bash', 'tool:absent'] },
    ), OPTIONS)
    expect(result.sections.map(section => section.text))
      .toEqual(['You are an agent.', 'Only call tools through code.', 'Prefer pwsh for files.'])
    expect(result.warnings).toEqual([{ code: 'unknown-section', rule: 0, section: 'tool:absent' }])
  })

  it('expands capture references in a replacement', () => {
    const result = applyRules(SECTIONS, preset(
      { kind: 'substitute', pattern: '(an) (agent)', replacement: '$2, $1 helper' },
    ), OPTIONS)
    expect(result.sections[0]?.text).toBe('You are agent, an helper.')
  })

  it('compiles a fresh expression per section, so a global pattern reaches every one', () => {
    const result = applyRules(SECTIONS, preset(
      { kind: 'substitute', pattern: 'o', flags: 'g', replacement: '0' },
    ), OPTIONS)
    expect(result.sections.every(section => !section.text.includes('o'))).toBe(true)
  })

  it('skips an unusable substitution and still applies the rules after it', () => {
    const invalid = applyRules(SECTIONS, preset(
      { kind: 'substitute', pattern: '(', replacement: 'x' },
      { kind: 'append', text: 'still here' },
    ), OPTIONS)
    expect(invalid.sections.at(-1)?.text).toBe('still here')
    expect(invalid.warnings[0]?.code).toBe('invalid-pattern')
    expect(invalid.warnings[0]?.detail).toMatch(/./)

    const long = applyRules(SECTIONS, preset(
      { kind: 'substitute', pattern: 'x'.repeat(OPTIONS.maxPatternLength + 1), replacement: 'y' },
      { kind: 'append', text: 'still here' },
    ), OPTIONS)
    expect(long.sections.at(-1)?.text).toBe('still here')
    expect(long.warnings).toEqual([{ code: 'pattern-too-long', rule: 0 }])
  })
})

describe('a remove naming a protected section', () => {
  it('keeps that section and drops the rest of the list', () => {
    // Stored by hand in the profile patch, past the editor's own refusal: the
    // protocol section still has to reach the model.
    const result = applyRules(
      SECTIONS,
      preset({ kind: 'remove', sections: ['tools:ptc-only', 'tool:bash'] }),
      OPTIONS,
    )
    expect(result.sections.map(section => section.name)).toEqual(['harness:identity', 'tools:ptc-only'])
    expect(result.warnings).toEqual([{ code: 'protected-section-kept', rule: 0, section: 'tools:ptc-only' }])
  })

  it('says nothing about a protected name the assembly never had', () => {
    const result = applyRules(
      SECTIONS.filter(section => section.name !== 'tools:ptc-only'),
      preset({ kind: 'remove', sections: ['tools:ptc-only'] }),
      OPTIONS,
    )
    // Absent is absent: it is reported as unknown, not as something kept.
    expect(result.warnings).toEqual([{ code: 'unknown-section', rule: 0, section: 'tools:ptc-only' }])
  })
})

describe('the insert rule', () => {
  it('puts its text directly behind the section it names', () => {
    expect(names({ kind: 'insert', after: 'harness:identity', text: 'RIGHT HERE.' })).toEqual([
      'harness:identity',
      ruleSectionName('insert', 0),
      'tools:ptc-only',
      'tool:bash',
    ])
  })

  it('reads as one block in the rendered prompt', () => {
    expect(rendered({ kind: 'insert', after: 'harness:identity', text: 'RIGHT HERE.' }))
      .toBe(['You are an agent.', 'RIGHT HERE.', 'Only call tools through code.', 'Prefer bash for files.'].join('\n\n'))
  })

  it('lands behind the last section when it names that one', () => {
    expect(names({ kind: 'insert', after: 'tool:bash', text: 'LAST.' }))
      .toEqual(['harness:identity', 'tools:ptc-only', 'tool:bash', ruleSectionName('insert', 0)])
  })

  it('warns and falls to the end when nothing carries the anchor', () => {
    const result = applyRules(
      SECTIONS,
      preset({ kind: 'insert', after: 'tool:absent', text: 'STILL SAID.' }),
      OPTIONS,
    )
    // The author asked for this text in the prompt and only said where; a
    // composition that stopped producing the anchor should not silently drop it.
    expect(result.sections.map(section => section.name).at(-1)).toBe(ruleSectionName('insert', 0))
    expect(result.warnings).toEqual([{ code: 'unknown-section', rule: 0, section: 'tool:absent' }])
  })

  it('can anchor to a section an earlier rule created', () => {
    expect(names(
      { kind: 'append', text: 'TAIL.' },
      { kind: 'insert', after: ruleSectionName('append', 0), text: 'AFTER THE TAIL.' },
    )).toEqual([
      'harness:identity',
      'tools:ptc-only',
      'tool:bash',
      ruleSectionName('append', 0),
      ruleSectionName('insert', 1),
    ])
  })

  it('renders its text literally unless it opts into interpolation', () => {
    const literal = applyRules(
      SECTIONS,
      preset({ kind: 'insert', after: 'harness:identity', text: 'Braces {{stay}}.' }),
      OPTIONS,
    )
    expect(literal.sections[1]?.interpolate).toBe(false)

    const opted = applyRules(
      SECTIONS,
      preset({ kind: 'insert', after: 'harness:identity', text: 'On {{model}}.', interpolate: true }),
      OPTIONS,
    )
    expect(opted.sections[1]?.interpolate).toBe(true)
  })

  it('is skipped when its author turned it off', () => {
    expect(names({ kind: 'insert', after: 'harness:identity', text: 'OFF.', enabled: false }))
      .toEqual(['harness:identity', 'tools:ptc-only', 'tool:bash'])
  })
})
