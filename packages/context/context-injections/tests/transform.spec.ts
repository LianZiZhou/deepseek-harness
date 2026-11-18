/** The pure rewrites: drop, keep, and replacement text with `{{text}}`. */
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, ImageBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { admitMessages, admitSections, rewriteText } from '../src/transform.ts'
import type { InjectionSetting } from '../src/transform.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'transform-notice': { kind: 'transform-notice' } & ContextFormed
    'transform-snapshot': { kind: 'transform-snapshot' } & ContextFormed
  }
}

const off: InjectionSetting = { enabled: false, text: '' }
const keep: InjectionSetting = { enabled: true, text: '' }
const wrap: InjectionSetting = { enabled: true, text: '<< {{text}} >>' }

function notice(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'transform-notice', form: 'notice', summary: 'notice' } })
}

describe('rewriteText', () => {
  it('keeps the original for an empty replacement', () => {
    expect(rewriteText('', 'original')).toBe('original')
  })

  it('substitutes every placeholder and leaves other braces literal', () => {
    expect(rewriteText('{{text}} / {{text}} {{model}} {', 'x')).toBe('x / x {{model}} {')
  })

  it('replaces outright when the replacement names no placeholder', () => {
    expect(rewriteText('fixed', 'original')).toBe('fixed')
  })
})

describe('admitMessages', () => {
  it('passes a kind no row names, including a person\'s own prompt', () => {
    const user = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    const other = notice('other')
    expect(admitMessages([user, other], new Map([['model-selection', off]]))).toEqual([user, other])
  })

  it('drops a switched-off kind and keeps an unchanged one by identity', () => {
    const dropped = notice('drop')
    const kept = createUserMessage({ content: [{ type: 'text', text: 'keep' }], source: { kind: 'transform-snapshot' } })
    const admitted = admitMessages([dropped, kept], new Map([['transform-notice', off], ['transform-snapshot', keep]]))
    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toBe(kept)
  })

  it('rewrites text blocks only and keeps the notice source', () => {
    const image: ImageBlock = {
      type: 'image',
      attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: 'one' }, image, { type: 'text', text: 'two' }],
      source: { kind: 'transform-notice', form: 'notice', summary: 'notice' },
    })
    const [admitted] = admitMessages([message], new Map([['transform-notice', wrap]]))
    expect(admitted?.content).toEqual([{ type: 'text', text: '<< one >>' }, image, { type: 'text', text: '<< two >>' }])
    expect(admitted?.source).toEqual(message.source)
  })

  it('rewrites the snapshot sections that mirror a rewritten block', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'now' }],
      source: { kind: 'transform-snapshot', form: 'snapshot', sections: [{ name: 'clock', text: 'now' }, { name: 'other', text: 'elsewhere' }] },
    })
    const [admitted] = admitMessages([message], new Map([['transform-snapshot', wrap]]))
    expect(admitted?.content).toEqual([{ type: 'text', text: '<< now >>' }])
    expect(admitted?.source).toEqual({
      kind: 'transform-snapshot',
      form: 'snapshot',
      sections: [{ name: 'clock', text: '<< now >>' }, { name: 'other', text: 'elsewhere' }],
    })
  })
})

describe('admitSections', () => {
  it('drops, rewrites, and passes sections by name', () => {
    const sections = [{ name: 'a', text: 'A' }, { name: 'b', text: 'B' }, { name: 'c', text: 'C' }]
    expect(admitSections(sections, new Map([['a', off], ['b', wrap], ['c', keep]])))
      .toEqual([{ name: 'b', text: '<< B >>' }, { name: 'c', text: 'C' }])
    expect(admitSections(sections, new Map())).toEqual(sections)
  })
})
