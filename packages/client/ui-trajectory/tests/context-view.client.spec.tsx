// @vitest-environment jsdom
/**
 * Context view behavior: it lists the model context the Session's next
 * request sends, forks after any message, and in edit mode stages content
 * edits, deletions, and inserted user messages that it commits as one
 * in-place rewrite, optionally restarting from a chosen message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { SessionContextValue } from '@deepseek-ai/dsh-api-session-controller/types'
import { ContextView } from '../src/client/ContextView.tsx'
import {
  blocksText, draftEdits, draftThrough, EMPTY_DRAFT, parseContextBlocks, toEditBlocks,
} from '../src/client/context-content.ts'
import { t } from './locale.client.ts'

afterEach(() => {
  cleanup()
})

const CONTEXT: SessionContextValue = {
  cursor: 9,
  request: { config: { provider: 'mock', model: 'mock' } },
  next: { systemPrompt: 'You are helpful.', tools: [{ name: 'bash' }] },
  messages: [
    { seq: 0, event: 'system/message', role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
    { seq: 2, event: 'user/message', role: 'user', content: [{ type: 'text', text: 'list files' }] },
    {
      seq: 4, event: 'assistant/message', role: 'assistant', content: [
        { type: 'reasoning', text: 'use ls' },
        { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"cmd":"ls"}' },
      ],
    },
    { seq: 6, event: 'tool/result', role: 'tool', toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'a.txt' }] },
  ],
}

function setup(options: { running?: boolean; access?: boolean; load?: ComponentProps<typeof ContextView>['load'] } = {}) {
  const load = vi.fn(options.load ?? (() => Promise.resolve({ ok: true as const, value: CONTEXT })))
  const rewrite = vi.fn(() => Promise.resolve({ ok: true as const, value: { sessionId: 's1', cursor: 3 } }))
  const forkAt = vi.fn()
  const props = {
    useSession: (select: (snapshot: { running: boolean }) => unknown) => select({ running: options.running ?? false }),
    useTrajectory: (select: (snapshot: { eventNodes: readonly { seq: number }[] }) => unknown) => select({ eventNodes: [{ seq: 9 }] }),
    useAccess: () => options.access ?? true,
    load,
    rewrite,
    forkAt,
    t,
  } as never as ComponentProps<typeof ContextView>
  render(<ContextView {...props} />)
  return { load, rewrite, forkAt }
}

function row(seq: number): HTMLElement {
  const item = screen.getAllByRole('listitem').find(element => element.textContent?.includes(`#${seq} ·`))
  if (item === undefined) throw new Error(`no row for seq ${seq}`)
  return item
}

async function confirm(): Promise<void> {
  fireEvent.click(await screen.findByRole('checkbox', { name: t('context.acknowledge') }))
  const dialog = screen.getByRole('dialog')
  const buttons = within(dialog).getAllByRole('button')
  const confirmButton = buttons.at(-1)
  if (confirmButton === undefined) throw new Error('confirmation has no buttons')
  fireEvent.click(confirmButton)
}

describe('ContextView', () => {
  it('lists every context message with its role, seq, and content', async () => {
    setup()
    await screen.findByText('list files')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(within(row(4)).getByText('{"cmd":"ls"}')).toBeTruthy()
    expect(within(row(4)).getByText('use ls')).toBeTruthy()
    expect(within(row(6)).getByText(t('context.toolError'))).toBeTruthy()
    expect(screen.getByText(t('context.cursor', { seq: '9' }))).toBeTruthy()
    expect(screen.queryByText(t('context.promptChanges'))).toBeNull()
  })

  it('forks after any message without edit mode', async () => {
    const { forkAt } = setup()
    await screen.findByText('list files')
    fireEvent.click(within(row(4)).getByRole('button', { name: t('context.fork') }))
    expect(forkAt).toHaveBeenCalledWith(4)
  })

  it('hides edit mode and fork without access', async () => {
    setup({ access: false })
    await screen.findByText('list files')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: t('context.fork') })).toBeNull()
  })

  it('stages a content edit and applies it as one rewrite through the cursor', async () => {
    const { rewrite, load } = setup()
    await screen.findByText('list files')
    fireEvent.click(screen.getByRole('switch', { name: t('context.editMode') }))
    fireEvent.click(within(row(2)).getByRole('button', { name: t('context.edit') }))
    fireEvent.change(within(row(2)).getByRole('textbox', { name: t('context.editText') }), { target: { value: 'list hidden files' } })
    fireEvent.click(within(row(2)).getByRole('button', { name: t('context.stage') }))
    expect(within(row(2)).getByText(t('context.edited'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('context.apply') }))
    await confirm()
    await waitFor(() => { expect(rewrite).toHaveBeenCalledOnce() })
    expect(rewrite).toHaveBeenCalledWith({
      expectedCursor: 9,
      throughSeq: 9,
      edits: [{ kind: 'replace-content', seq: 2, content: [{ type: 'text', text: 'list hidden files' }] }],
      interrupt: false,
      resume: false,
    })
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })

  it('restarts from a message with only the staged changes it keeps, interrupting a running Session', async () => {
    const { rewrite } = setup({ running: true })
    await screen.findByText('list files')
    fireEvent.click(screen.getByRole('switch', { name: t('context.editMode') }))
    fireEvent.click(within(row(6)).getByRole('button', { name: t('context.delete') }))
    fireEvent.click(within(row(2)).getByRole('button', { name: t('context.insertAfter') }))
    const editor = within(row(2)).getByRole('textbox', { name: t('context.insertAfter') })
    fireEvent.change(editor, { target: { value: 'count them too' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(within(row(2)).getByText('count them too')).toBeTruthy()
    fireEvent.click(within(row(4)).getByRole('button', { name: t('context.restartHere') }))
    await confirm()
    await waitFor(() => { expect(rewrite).toHaveBeenCalledOnce() })
    expect(rewrite).toHaveBeenCalledWith({
      expectedCursor: 9,
      throughSeq: 4,
      edits: [{ kind: 'insert-user', afterSeq: 2, content: [{ type: 'text', text: 'count them too' }] }],
      interrupt: true,
      resume: true,
    })
  })

  it('reports a failed load in place', async () => {
    setup({ load: () => Promise.resolve({ ok: false as const, error: { code: 'session/not-found', message: 'gone' } as never }) })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', t('context.error', { message: 'gone' }))
  })

  it('discards staged changes when edit mode turns off', async () => {
    setup()
    await screen.findByText('list files')
    const toggle = screen.getByRole('switch', { name: t('context.editMode') })
    fireEvent.click(toggle)
    fireEvent.click(within(row(6)).getByRole('button', { name: t('context.delete') }))
    expect(screen.getByRole('button', { name: t('context.apply') })).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: t('context.apply') })).toBeNull()
    expect(screen.queryByText(t('context.deleted'))).toBeNull()
  })
})

describe('context content', () => {
  it('parses known blocks and keeps the rest as opaque blocks', () => {
    const blocks = parseContextBlocks([
      { type: 'text', text: 'a' },
      { type: 'image', attachment: { id: 'x' } },
      'stray',
      { type: 'tool-call', id: 'c', name: 'n' },
    ])
    expect(blocks.map(block => block.kind)).toEqual(['text', 'other', 'other', 'other'])
    expect(parseContextBlocks('scalar')).toEqual([{ kind: 'other', type: 'content', value: 'scalar' }])
    expect(blocksText(blocks)).toBe('a\n[image]\n[unknown]\n[tool-call]')
    expect(toEditBlocks(blocks)).toEqual([
      { type: 'text', text: 'a' }, { type: 'keep', index: 1 }, { type: 'keep', index: 2 }, { type: 'keep', index: 3 },
    ])
  })

  it('drops replacements of deleted messages and cuts drafts at a seq', () => {
    const draft = {
      replaced: new Map([[2, parseContextBlocks([{ type: 'text', text: 'x' }])], [6, []]]),
      deleted: new Set([6]),
      inserted: [{ afterSeq: 7, text: 'late' }],
    }
    expect(draftEdits(draft)).toEqual([
      { kind: 'replace-content', seq: 2, content: [{ type: 'text', text: 'x' }] },
      { kind: 'delete', seq: 6 },
      { kind: 'insert-user', afterSeq: 7, content: [{ type: 'text', text: 'late' }] },
    ])
    expect(draftEdits(draftThrough(draft, 5))).toEqual([{ kind: 'replace-content', seq: 2, content: [{ type: 'text', text: 'x' }] }])
    expect(draftEdits(EMPTY_DRAFT)).toEqual([])
  })
})
