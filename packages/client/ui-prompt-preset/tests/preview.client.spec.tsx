// @vitest-environment jsdom
/** Preview interaction through the same portaled modal and tooltip used in Settings. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives/client'
import { PromptPresetPreview, type PromptPresetPreviewProps } from '../src/client/PromptPreview.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t: PromptPresetPreviewProps['t'] = (key, params) => typeof params?.section === 'string' ? `${key} ${params.section}` : key
const first = { name: 'tools:first', text: '<literal> {{model}}' }
const removed = { name: 'tools:missing', text: 'removed body' }
const original = { name: 'tools:second', text: '界🙂 old שלום  \r\n', variables: [{ start: 4, end: 7, token: '{{old}}' }] }
const edited = { name: original.name, text: '界🙂 new שלום  \r\n', variables: [{ start: 4, end: 7, token: '{{new}}' }] }
const added = { name: 'tools:third', text: 'new' }
const preview: PromptPresetPreviewProps['preview'] = {
  status: 'ready', error: null,
  warnings: [{ code: 'duplicate-section', section: edited.name }],
  baseline: [first, removed, original],
  sections: [first, { name: 'empty', text: '' }, edited, added],
  baselinePrompt: '<literal> {{model}}\n\nremoved body\n\n界🙂 old שלום  \r\n',
  prompt: '<literal> {{model}}\n\n界🙂 new שלום  \r\n\n\nnew',
}
function pane(data = preview) {
  return <PromptPresetPreview hasSession onRefresh={vi.fn()} t={t} preview={data} />
}
function click(name: string | RegExp) { fireEvent.click(screen.getByRole('button', { name })) }
function highlight() { fireEvent.click(screen.getByRole('checkbox', { name: 'preview.highlightChanges' })) }
function bodyOf(element: ParentNode): HTMLPreElement {
  const body = element.querySelector('pre')
  if (!body) throw new Error('Expected open prompt text')
  return body
}
/** Read either complete side, including whitespace that a word diff could otherwise discard. */
function side(pre: HTMLPreElement, discard: 'del' | 'ins') {
  const copy = pre.cloneNode(true) as HTMLPreElement
  copy.querySelectorAll(discard).forEach((edit) => { edit.remove() })
  return copy.textContent
}

it('inspects one complete ID, traps Tab, and returns Escape focus without closing Settings', () => {
  const closeSettings = vi.fn()
  render(<Modal open title="Settings" closeLabel="Close settings" onClose={closeSettings}>{pane()}</Modal>)
  expect(screen.getByRole('alert').textContent).toContain('preview.warn.duplicateSection tools:second')
  const trigger = screen.getByRole('button', { name: /tools:second/ })
  fireEvent.click(trigger)
  const detail = screen.getByRole('dialog', { name: 'preview.detail tools:second' })
  const close = within(detail).getByRole('button', { name: 'preview.close' })
  expect(document.activeElement).toBe(close)
  const pre = bodyOf(detail)
  expect(pre.textContent).toBe(edited.text)
  expect(pre.querySelector('mark, ins, del')).toBeNull()
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement?.textContent).toBe('new')
  expect(screen.getByRole('tooltip').textContent).toBe('{{new}}')
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(detail.isConnected).toBe(true)
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
  expect(document.activeElement).toBe(close)

  highlight()
  expect(pre.querySelector('mark del')?.textContent).toBe('old')
  expect(pre.querySelector('mark ins')?.textContent).toBe('new')
  expect(side(pre, 'ins')).toBe(original.text)
  expect(side(pre, 'del')).toBe(edited.text)
  fireEvent.click(pre.querySelector('del [tabindex]')!)
  expect(screen.getByRole('tooltip').textContent).toBe('{{old}}')
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  fireEvent.keyDown(close, { key: 'Escape' })
  expect(detail.isConnected).toBe(false)
  expect(document.activeElement).toBe(trigger)
  expect(closeSettings).not.toHaveBeenCalled()

  click(/tools:missing/)
  const missing = screen.getByRole('dialog', { name: 'preview.detail tools:missing' })
  expect(bodyOf(missing).querySelector('del')?.textContent).toBe(removed.text)
  highlight()
  expect(bodyOf(missing).textContent).toBe(removed.text)
  expect(bodyOf(missing).querySelector('del')).toBeNull()
  highlight()
  fireEvent.click(within(missing).getByRole('button', { name: 'preview.close' }))
  click(/tools:third/)
  expect(bodyOf(screen.getByRole('dialog', { name: 'preview.detail tools:third' })).querySelector('ins')?.textContent).toBe('new')
})

it('marks the real expansion in a list excerpt without nesting a tab stop in the row button', () => {
  render(pane())
  const row = screen.getByRole('button', { name: /tools:second/ })
  const expansion = within(row).getByText('new', { exact: true })
  expect(expansion.hasAttribute('tabindex')).toBe(false)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  fireEvent.pointerEnter(expansion, { pointerType: 'mouse' })
  expect(screen.getByRole('tooltip').textContent).toBe('{{new}}')
  fireEvent.click(row)
  expect(screen.getByRole('dialog', { name: 'preview.detail tools:second' })).toBeTruthy()
})

it('keeps an inspected section closed if it vanishes and returns on a later preview', () => {
  const { rerender } = render(pane())
  click(/tools:second/)
  rerender(pane({ ...preview, sections: [], baseline: [] }))
  expect(screen.queryByRole('dialog')).toBeNull()
  rerender(pane())
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('preserves the exact Host prompt and annotates only the attributed value after an empty section', () => {
  const { container, rerender } = render(pane())
  click('preview.prompt')
  const pre = bodyOf(container)
  expect(pre.textContent).toBe(preview.prompt)
  const anchors = pre.querySelectorAll<HTMLElement>('[tabindex="0"]')
  expect([...anchors].map(el => el.textContent)).toEqual(['new'])
  act(() => { anchors[0]!.focus() })
  expect(screen.getByRole('tooltip').textContent).toBe('{{new}}')
  expect(pre.textContent).toBe(preview.prompt)
  highlight()
  expect(side(pre, 'ins')).toBe(preview.baselinePrompt)
  expect(side(pre, 'del')).toBe(preview.prompt)
  highlight()
  expect(pre.querySelector('mark, ins, del')).toBeNull()
  for (const prompt of ['new\n\nnew', preview.prompt.replace('\n\n', '  '), preview.prompt + ' trailing']) {
    rerender(pane({ ...preview, prompt }))
    expect(pre.textContent).toBe(prompt)
    expect(pre.querySelector('[tabindex]')).toBeNull()
  }
})

it('groups by full ID in model order, keeping removed neighbors only for comparison', () => {
  const { container } = render(pane())
  click('preview.prompt')
  click('preview.grouped')
  const groupIds = () => Array.from(container.querySelectorAll('li code'), el => el.textContent)
  expect(groupIds()).toEqual(['tools:first', 'empty', 'tools:second', 'tools:third'])
  expect(container.querySelector('pre')).toBeNull()
  click('tools:second')
  expect(bodyOf(container).textContent).toBe(edited.text)
  click('tools:second')
  expect(container.querySelector('pre')).toBeNull()
  highlight()
  expect(groupIds()).toEqual(['tools:first', 'empty', 'tools:missing', 'tools:second', 'tools:third'])
  click('preview.unfoldAll')
  expect([...container.querySelectorAll<HTMLPreElement>('li pre')].map(pre => side(pre, 'del')))
    .toEqual([first.text, '', '', edited.text, added.text])
  click('preview.foldAll')
  expect(container.querySelector('pre, li [tabindex]')).toBeNull()
  click('preview.textOnly')
  expect(side(bodyOf(container), 'ins')).toBe(preview.baselinePrompt)
})

it('keeps literal and interpolated copies distinct across multiline and non-Latin edits', () => {
  const previous = 'مرحبا 🙂\n東京\n서울\n'
  const current = 'مرحبا 🙂\n上海\n北京\n'
  const name = 'guide:locale'
  const { container } = render(pane({
    ...preview,
    baseline: [{ name, text: previous, variables: [{ start: 9, end: 14, token: '{{old}}' }] }],
    sections: [{ name, text: current, variables: [{ start: 9, end: 14, token: '{{cities}}' }] }],
    prompt: current, baselinePrompt: previous,
  }))
  click('preview.prompt')
  highlight()
  const pre = bodyOf(container)
  expect(side(pre, 'ins')).toBe(previous)
  expect(side(pre, 'del')).toBe(current)
  const value = pre.querySelector<HTMLElement>('ins [tabindex]')!
  expect(value.textContent).toBe('上海\n北京')
  fireEvent.pointerEnter(value, { pointerType: 'pen' })
  expect(screen.getByRole('tooltip').textContent).toBe('{{cities}}')
  fireEvent.pointerLeave(value)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('keeps one keyboard stop per resolved range even when a word edit splits it', () => {
  const name = 'model:description'
  const variables = [{ start: 6, end: 12, token: '{{model}}' }]
  const before = 'a red red AI, red'
  const after = 'a red new AI, red'
  const { container } = render(pane({
    ...preview, baseline: [{ name, text: before, variables }], sections: [{ name, text: after, variables }],
    baselinePrompt: before, prompt: after,
  }))
  click('preview.prompt')
  highlight()
  const pre = bodyOf(container)
  const anchors = [...pre.querySelectorAll<HTMLElement>('[tabindex]')]
  expect(anchors.map(anchor => anchor.textContent)).toEqual(['red', 'new', ' AI'])
  expect(anchors.map(anchor => anchor.tabIndex)).toEqual([0, 0, -1])
  expect(side(pre, 'ins')).toBe(before)
  expect(side(pre, 'del')).toBe(after)
})

it.each([
  ['long lines', 'A'.repeat(700), 'B'.repeat(700)],
  ['many changed lines', 'old\n'.repeat(140), 'new\n'.repeat(140)],
  ['many changed words', 'a,'.repeat(100), 'b;'.repeat(100)],
])('preserves both complete sides when %s exceed granular comparison limits', (_case, before, after) => {
  const { container } = render(pane({ ...preview, sections: [], baseline: [], baselinePrompt: before, prompt: after }))
  click('preview.prompt')
  highlight()
  const pre = bodyOf(container)
  expect(pre.querySelector('mark del')?.textContent).toBe(before)
  expect(pre.querySelector('mark ins')?.textContent).toBe(after)
})
