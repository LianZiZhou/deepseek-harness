/** The pure rewrites: drop, keep, and a person's template rendered with the recovered variables. */
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, ImageBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { compileTemplate } from '../src/template.ts'
import { admitMessages, admitSections, rewriteText } from '../src/transform.ts'
import type { InjectionSetting, InjectionVariantSetting } from '../src/transform.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'transform-notice': { kind: 'transform-notice' } & ContextFormed
    'transform-snapshot': { kind: 'transform-snapshot' } & ContextFormed
  }
}

const SHIPPED = 'value {{v}} here'

function variant(text: string, template = SHIPPED): InjectionVariantSetting {
  return { template: compileTemplate(template), text }
}

const off: InjectionSetting = { enabled: false, variants: [variant(SHIPPED)] }
const keep: InjectionSetting = { enabled: true, variants: [variant(SHIPPED)] }
const wrap: InjectionSetting = { enabled: true, variants: [variant('<< {{v}} >>')] }

function notice(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'transform-notice', form: 'notice', summary: 'notice' } })
}

describe('rewriteText', () => {
  it('keeps the original for an empty template or the shipped one', () => {
    expect(rewriteText('value 1 here', [variant('')])).toBe('value 1 here')
    expect(rewriteText('value 1 here', [variant(SHIPPED)])).toBe('value 1 here')
  })

  it('renders the first matching shape with its variables and the whole text', () => {
    const variants = [variant('A={{a}}', 'first {{a}}!'), variant('V={{v}} / {{text}} / {{a}}')]
    expect(rewriteText('value 1 here', variants)).toBe('V=1 / value 1 here / {{a}}')
    expect(rewriteText('first x!', variants)).toBe('A=x')
  })

  it('sends a text no shape matches unchanged', () => {
    expect(rewriteText('worded differently', [variant('<< {{v}} >>')])).toBe('worded differently')
  })
})

describe('admitMessages', () => {
  it('passes a kind no row names, including a person\'s own prompt', () => {
    const user = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    const other = notice('other')
    expect(admitMessages([user, other], new Map([['model-selection', off]]))).toEqual([user, other])
  })

  it('drops a switched-off kind and keeps an unchanged one by identity', () => {
    const dropped = notice('value 1 here')
    const kept = createUserMessage({ content: [{ type: 'text', text: 'value 2 here' }], source: { kind: 'transform-snapshot' } })
    const admitted = admitMessages([dropped, kept], new Map([['transform-notice', off], ['transform-snapshot', keep]]))
    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toBe(kept)
  })

  it('rewrites matching text blocks only and keeps the notice source', () => {
    const image: ImageBlock = {
      type: 'image',
      attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: 'value 1 here' }, image, { type: 'text', text: 'unmatched' }],
      source: { kind: 'transform-notice', form: 'notice', summary: 'notice' },
    })
    const [admitted] = admitMessages([message], new Map([['transform-notice', wrap]]))
    expect(admitted?.content).toEqual([{ type: 'text', text: '<< 1 >>' }, image, { type: 'text', text: 'unmatched' }])
    expect(admitted?.content[2]).toBe(message.content[2])
    expect(admitted?.source).toEqual(message.source)
  })

  it('rewrites the snapshot sections that mirror a rewritten block', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'value now here' }, { type: 'text', text: 'elsewhere' }],
      source: {
        kind: 'transform-snapshot',
        form: 'snapshot',
        sections: [{ name: 'clock', text: 'value now here' }, { name: 'other', text: 'elsewhere' }, { name: 'gone', text: 'x' }],
      },
    })
    const [admitted] = admitMessages([message], new Map([['transform-snapshot', wrap]]))
    expect(admitted?.content).toEqual([{ type: 'text', text: '<< now >>' }, { type: 'text', text: 'elsewhere' }])
    expect(admitted?.source).toEqual({
      kind: 'transform-snapshot',
      form: 'snapshot',
      sections: [{ name: 'clock', text: '<< now >>' }, { name: 'other', text: 'elsewhere' }, { name: 'gone', text: 'x' }],
    })
  })
})

describe('admitSections', () => {
  it('drops, rewrites, and passes sections by name', () => {
    const sections = [{ name: 'a', text: 'value A here' }, { name: 'b', text: 'value B here' }, { name: 'c', text: 'value C here' }]
    const admitted = admitSections(sections, new Map([['a', off], ['b', wrap], ['c', keep]]))
    expect(admitted).toEqual([{ name: 'b', text: '<< B >>' }, { name: 'c', text: 'value C here' }])
    expect(admitted[1]).toBe(sections[2])
    expect(admitSections(sections, new Map())).toEqual(sections)
  })
})
