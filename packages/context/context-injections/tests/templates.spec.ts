/** The shipped templates against each other and against every text the recorded sessions hold. */
import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONTEXT_INJECTION_ROWS, shippedTemplate, type ContextInjectionRow } from '../src/rows.ts'
import { pairVariants } from '../src/settings.ts'
import { compileTemplate, renderTemplate } from '../src/template.ts'

const ROWS: readonly ContextInjectionRow[] = CONTEXT_INJECTION_ROWS
const REPO = fileURLToPath(new URL('../../../..', import.meta.url))

/** The variant id the row's matching order picks for a text, or undefined when none matches. */
function matchedVariant(row: ContextInjectionRow, text: string): string | undefined {
  const templates = row.variants.map(variant => compileTemplate(variant.template))
  const ordered = pairVariants(templates, row.variants.map(variant => variant.template))
  const found = ordered.find(variant => variant.template.match(text) !== undefined)
  return row.variants.find(variant => variant.template === found?.template.source)?.id
}

describe('shipped templates', () => {
  it('gives every shape a distinct id and separates every two variables with constant text', () => {
    for (const row of ROWS) {
      expect(new Set(row.variants.map(variant => variant.id)).size, row.id).toBe(row.variants.length)
      expect(row.variants.length === 1 ? row.variants[0]?.id : 'named', row.id).not.toBeUndefined()
      for (const variant of row.variants) {
        expect(variant.template, `${row.id}/${variant.id}`).not.toMatch(/\}\}\{\{/)
        expect(variant.template, `${row.id}/${variant.id}`).not.toContain('{{text}}')
      }
    }
  })

  it('names a row\'s only shape with the empty id and every shape of a row with several', () => {
    for (const row of ROWS) {
      const ids = row.variants.map(variant => variant.id)
      expect(row.variants.length === 1 ? ids : ids.filter(id => id === ''), row.id).toEqual(row.variants.length === 1 ? [''] : [])
    }
  })

  it('recognises each shape as itself, so no broader shape shadows it', () => {
    for (const row of ROWS) {
      for (const variant of row.variants) {
        const compiled = compileTemplate(variant.template)
        const sample = renderTemplate(variant.template, new Map(compiled.variables.map(name => [name, `‹${name}›`])))
        expect(matchedVariant(row, sample), `${row.id}/${variant.id}`).toBe(variant.id)
      }
    }
  })

  it('returns each shape\'s template by id and rejects an unknown shape', () => {
    expect(shippedTemplate('planModeNotice', 'left')).toBe('The user switched this session back to the default mode.')
    expect(shippedTemplate('webSurface')).toBe('Current DeepSeek Harness Web GUI URL: {{url}}.')
    expect(() => shippedTemplate('planModeNotice')).toThrow('no shipped template for planModeNoticeText')
  })
})

describe('pairVariants', () => {
  it('orders shapes with more constant text first', () => {
    const narrow = compileTemplate('a {{x}} b c d')
    const broad = compileTemplate('a {{x}}')
    expect(pairVariants([broad, narrow], ['1', '2']).map(variant => variant.text)).toEqual(['2', '1'])
  })

  it('rejects a mismatched template list and keeps the shipped template for a hole', () => {
    const template = compileTemplate('a {{x}}')
    expect(() => pairVariants([template], [])).toThrow('1 shapes but 0 templates')
    expect(pairVariants([template], Array<string>(1))[0]?.text).toBe('a {{x}}')
  })
})

/** Every recorded text a row matches, with where it was recorded. */
function recordedTexts(): { row: ContextInjectionRow; text: string; file: string }[] {
  const byKind = new Map(ROWS.flatMap(row => row.target === 'message' ? [[row.source, row]] : []))
  const bySection = new Map(ROWS.flatMap(row => row.target === 'section' ? [[row.section, row]] : []))
  const found: { row: ContextInjectionRow; text: string; file: string }[] = []
  for (const file of globSync('snapshots/**/*.v4.jsonl', { cwd: REPO })) {
    for (const line of readFileSync(`${REPO}/${file}`, 'utf8').split('\n')) {
      if (!line.includes('"type":"user/message"')) continue
      const event = JSON.parse(line) as { type: string; data: RecordedMessage }
      if (event.type !== 'user/message') continue
      const { content, source } = event.data
      const row = byKind.get(source.kind)
      if (row !== undefined) {
        for (const block of content) if (block.type === 'text') found.push({ row, text: denormalize(block.text ?? ''), file })
      }
      if (source.kind !== 'runtime-context') continue
      for (const section of source.sections ?? []) {
        const sectionRow = bySection.get(section.name)
        if (sectionRow !== undefined) found.push({ row: sectionRow, text: section.text, file })
      }
    }
  }
  return found
}

interface RecordedMessage {
  content: { type: string; text?: string }[]
  source: { kind: string; sections?: { name: string; text: string }[] }
}

/** The Web snapshot normalizer replaces the elapsed reading and its full stop with `{{elapsed}}`. */
function denormalize(text: string): string {
  return text.endsWith(': {{elapsed}}') ? `${text}.` : text
}

describe('recorded sessions', () => {
  it('match a shipped template for every injection a row covers', () => {
    const recorded = recordedTexts()
    expect(new Set(recorded.map(entry => entry.row.id)).size).toBeGreaterThanOrEqual(12)
    const unmatched = recorded.filter(entry => matchedVariant(entry.row, entry.text) === undefined)
    expect(unmatched.map(entry => `${entry.row.id} in ${entry.file}: ${entry.text.slice(0, 160)}`)).toEqual([])
  })
})
