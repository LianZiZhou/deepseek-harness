import { describe, expect, it } from 'vitest'
import { compileTemplate, renderTemplate, templateVariables } from '../src/template.ts'

describe('compileTemplate', () => {
  it('recovers each variable and the whole text', () => {
    const template = compileTemplate('[model changed: from {{from}}; to {{to}}]')
    expect(template.variables).toEqual(['from', 'to'])
    expect(Object.fromEntries(template.match('[model changed: from a.b; to c (d)]') ?? [])).toEqual({
      from: 'a.b', to: 'c (d)', text: '[model changed: from a.b; to c (d)]',
    })
  })

  it('matches multi-line values and treats regex characters in the constant text literally', () => {
    const template = compileTemplate('<x>\n{{body}}\n</x> (*)')
    expect(template.match('<x>\nline 1\nline 2\n</x> (*)')?.get('body')).toBe('line 1\nline 2')
    expect(template.match('<x>\nline\n</x> (+)')).toBeUndefined()
  })

  it('rejects a text of another shape', () => {
    expect(compileTemplate('The user switched this session to plan mode.').match('The user switched back.')).toBeUndefined()
  })

  it('requires a repeated variable to take one value', () => {
    const template = compileTemplate('{{a}} and {{a}}')
    expect(template.variables).toEqual(['a'])
    expect(template.match('x and x')?.get('a')).toBe('x')
    expect(template.match('x and y')).toBeUndefined()
  })

  it('leaves text out of the variable list', () => {
    expect(compileTemplate('Clock: {{text}}').variables).toEqual([])
  })
})

describe('renderTemplate', () => {
  it('fills known variables and leaves other braces as written', () => {
    const values = new Map([['from', 'a'], ['text', 'orig']])
    expect(renderTemplate('{{from}} / {{text}} / {{missing}} / {not} / {{ from }}', values))
      .toBe('a / orig / {{missing}} / {not} / {{ from }}')
  })
})

describe('templateVariables', () => {
  it('lists names in first-appearance order', () => {
    expect(templateVariables('{{b}} {{text}} {{a}} {{b}}')).toEqual(['b', 'text', 'a'])
  })
})
