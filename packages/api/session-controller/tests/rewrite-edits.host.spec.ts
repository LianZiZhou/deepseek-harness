/** Wire edits resolve against the addressed log, and rewrite failures map to stable Remote errors. */
import { describe, expect, it } from 'vitest'
import { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionRewriteError } from '@deepseek-ai/dsh-session/rewrite'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ApiSessionForeignOwner } from '../src/agent.ts'
import { rewriteFailure, toEditOp } from '../src/rewrite-edits.ts'

const id = SessionId('edits')

function log(): readonly SessionEvent[] {
  const session = Session.create(id)
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'see image' }, { type: 'image', attachment: { id: 'att' } as never }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1, step: 1, stream: [],
    message: createMessage({ role: 'assistant', content: [{ type: 'reasoning', text: 'r' }], source: { kind: 'model', provider: 'm', model: 'm' } }),
  }, { surfaceOp: 'append' })
  // oxlint-disable-next-line typescript/no-deprecated -- test reads its detached Session's log.
  return session.snapshotEvents()
}

describe('toEditOp', () => {
  it('keeps original blocks by index and converts new text, reasoning, and tool calls', () => {
    expect(toEditOp({
      kind: 'replace-content', seq: 1, isError: false,
      content: [{ type: 'text', text: 'new' }, { type: 'keep', index: 1 }, { type: 'reasoning', text: 'why' },
        { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }],
    }, log())).toEqual({
      kind: 'replace-content', seq: 1, isError: false,
      content: [
        { type: 'text', text: 'new' },
        { type: 'image', attachment: { id: 'att' } },
        { type: 'reasoning', text: 'why' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{}' },
      ],
    })
  })

  it('reads kept blocks from envelope messages and refuses a missing one', () => {
    expect(toEditOp({ kind: 'replace-content', seq: 3, content: [{ type: 'keep', index: 0 }] }, log()))
      .toEqual({ kind: 'replace-content', seq: 3, content: [{ type: 'reasoning', text: 'r' }] })
    expect(() => toEditOp({ kind: 'replace-content', seq: 0, content: [{ type: 'keep', index: 0 }] }, log()))
      .toThrow(new SessionRewriteError('event 0 has no content block 0 to keep', 'NOT_A_MESSAGE', SessionSeq(0)))
    expect(() => toEditOp({ kind: 'replace-content', seq: 99, content: [{ type: 'keep', index: 0 }] }, log()))
      .toThrow(expect.objectContaining({ code: 'NOT_A_MESSAGE', seq: 99 }))
  })

  it('converts deletions and inserted user messages, refusing kept blocks in an insertion', () => {
    expect(toEditOp({ kind: 'delete', seq: 1 }, log())).toEqual({ kind: 'delete', seq: 1 })
    expect(toEditOp({ kind: 'insert-user', afterSeq: 1, content: [{ type: 'text', text: 'more' }] }, log()))
      .toEqual({ kind: 'insert-user', afterSeq: 1, content: [{ type: 'text', text: 'more' }] })
    expect(() => toEditOp({ kind: 'insert-user', afterSeq: 1, content: [{ type: 'keep', index: 0 }] }, log()))
      .toThrow(SessionRewriteError)
  })

  it('refuses a seq that is not a non-negative safe integer', () => {
    expect(() => toEditOp({ kind: 'delete', seq: -1 }, log()))
      .toThrow(expect.objectContaining({ code: 'INVALID_BOUNDARY' }))
  })
})

describe('rewriteFailure', () => {
  it('passes Remote errors through and maps rewrite, ownership, storage, and seed failures', () => {
    const remote = new RemoteError('session/not-found', 'gone', { sessionId: id })
    expect(rewriteFailure(id, remote)).toBe(remote)
    expect(rewriteFailure(id, new SessionRewriteError('bad', 'INVALID_RESULT', SessionSeq(4))))
      .toMatchObject({ code: 'session/rewrite-invalid', details: { sessionId: id, code: 'INVALID_RESULT', seq: 4 } })
    expect(rewriteFailure(id, new SessionRewriteError('bad', 'INVALID_BOUNDARY')))
      .toMatchObject({ code: 'session/rewrite-invalid', details: { sessionId: id, code: 'INVALID_BOUNDARY' } })
    expect(rewriteFailure(id, new ApiSessionForeignOwner(id)))
      .toMatchObject({ code: 'session/rewrite-unavailable', details: { reason: 'foreign-owner' } })
    for (const name of ['SessionAlreadyOwnedError', 'SessionReplaceUnsupportedError', 'SessionFormatUnsupportedError']) {
      const error = Object.assign(new Error(name), { name })
      expect(rewriteFailure(id, error)).toMatchObject({ code: 'session/rewrite-unavailable', details: { reason: name } })
    }
    expect(rewriteFailure(id, new Error('invalid seed event at index 3: bad')))
      .toMatchObject({ code: 'session/rewrite-invalid', details: { code: 'INVALID_RESULT' } })
    expect(rewriteFailure(id, 'disk full')).toMatchObject({ code: 'gateway/internal' })
  })
})
