import { describe, expect, it } from 'vitest'
import { createDeveloperMessage, createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { buildRewriteLog, SessionRewriteError } from '@deepseek-ai/dsh-session/rewrite'
import { Session, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test/cites-seq': { seq: number }
  }
}

const CALL = ToolCallId('call-1')

/** One closed turn with a tool round trip, then a closed second step. */
function toolTurn(): Session {
  const session = Session.create(SessionId('rewrite'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'list files' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1, step: 1, stream: [], usage: { inputTokens: 3, outputTokens: 2 },
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: CALL, name: 'bash', arguments: '{"cmd":"ls"}' }],
      source: { kind: 'model', provider: 'mock', model: 'mock', replayState: { opaque: true } },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId: CALL, name: 'bash', arguments: '{"cmd":"ls"}' })
  session.append('tool/result', {
    turn: 1, step: 1,
    message: createMessage({ role: 'tool', toolCallId: CALL, source: { kind: 'tool', callId: CALL }, content: [{ type: 'text', text: 'a.txt' }], isError: true }),
    error: { name: 'E', code: 'E' },
  }, { surfaceOp: 'append', sourceEventSeqs: [SessionSeq(4)] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1, step: 2, stream: [],
    message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

function events(session: Session): readonly SessionEvent[] {
  // oxlint-disable-next-line typescript/no-deprecated -- test reads a detached Session's full log.
  return session.snapshotEvents()
}

function rewrite(log: readonly SessionEvent[], plan: Parameters<typeof buildRewriteLog>[2]) {
  return buildRewriteLog(log, SessionLogOffset(0), plan)
}

describe('buildRewriteLog', () => {
  it('truncates a closed log without closers and leaves it valid for restore', () => {
    const log = events(toolTurn())
    const result = rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [] })
    expect(result.events).toEqual(log)
    expect(() => Session.create(SessionId('copy'), result.events)).not.toThrow()
  })

  it('closes a mid-step cut with interrupted closers that answer the open call', () => {
    const log = events(toolTurn())
    const result = rewrite(log, { throughSeq: SessionSeq(4), edits: [] })
    expect(result.events.slice(5).map(e => e.type)).toEqual(['tool/result', 'step/end', 'turn/end'])
    expect(result.events.at(-1)).toMatchObject({ data: { reason: { kind: 'interrupted' } } })
    expect(() => Session.create(SessionId('copy'), result.events)).not.toThrow()
  })

  it('replaces user content in place and keeps the message identity', () => {
    const log = events(toolTurn())
    const result = rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'replace-content', seq: SessionSeq(1), content: [{ type: 'text', text: 'list hidden files' }] }] })
    const before = log[1] as SessionEvent<'user/message'>
    expect(result.events[1]).toMatchObject({ seq: 1, data: { id: before.data.id, content: [{ type: 'text', text: 'list hidden files' }] } })
    expect(result.events).toHaveLength(log.length)
  })

  it('drops stream, usage, and replay state from an edited assistant message and syncs its tool/call', () => {
    const log = events(toolTurn())
    const result = rewrite(log, {
      throughSeq: SessionSeq(log.length - 1),
      edits: [{ kind: 'replace-content', seq: SessionSeq(3), content: [{ type: 'tool-call', id: CALL, name: 'bash', arguments: '{"cmd":"ls -a"}' }] }],
    })
    const assistant = result.events[3] as SessionEvent<'assistant/message'>
    expect(assistant.data.usage).toBeUndefined()
    expect(assistant.data.stream).toEqual([])
    expect(assistant.data.message.source).toEqual({ kind: 'model', provider: 'mock', model: 'mock' })
    expect(result.events[4]).toMatchObject({ type: 'tool/call', data: { arguments: '{"cmd":"ls -a"}' } })
  })

  it('clears failure identity when a tool result becomes a success', () => {
    const log = events(toolTurn())
    const result = rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'replace-content', seq: SessionSeq(5), content: [{ type: 'text', text: 'b.txt' }], isError: false }] })
    const toolResult = result.events[5] as SessionEvent<'tool/result'>
    expect(toolResult.data.error).toBeUndefined()
    expect(toolResult.data.message).toMatchObject({ isError: false, content: [{ type: 'text', text: 'b.txt' }] })
    expect(() => Session.create(SessionId('copy'), result.events)).not.toThrow()
  })

  it('deletes and inserts messages while remapping cited seqs', () => {
    const log = events(toolTurn())
    const result = rewrite(log, {
      throughSeq: SessionSeq(log.length - 1),
      edits: [
        { kind: 'insert-user', afterSeq: SessionSeq(1), content: [{ type: 'text', text: 'also count them' }] },
        { kind: 'delete', seq: SessionSeq(8) },
      ],
    })
    expect(result.events.map(e => e.seq)).toEqual(result.events.map((_, index) => index))
    expect(result.events[2]).toMatchObject({ type: 'user/message', data: { content: [{ type: 'text', text: 'also count them' }] } })
    expect(result.events[6]).toMatchObject({ type: 'tool/result', sourceEventSeqs: [5] })
    expect(result.events.filter(e => e.type === 'assistant/message')).toHaveLength(1)
    expect(() => Session.create(SessionId('copy'), result.events)).not.toThrow()
  })

  it('rejects a deletion that would orphan a tool result', () => {
    const log = events(toolTurn())
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'delete', seq: SessionSeq(3) }] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_RESULT' }))
  })

  it('rejects a deletion that removes a cited source event', () => {
    const session = toolTurn()
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }), { surfaceOp: 'append', sourceEventSeqs: [SessionSeq(1)] })
    const log = events(session)
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'delete', seq: SessionSeq(1) }] }))
      .toThrow(expect.objectContaining({ code: 'UNMAPPABLE_REFERENCE' }))
  })

  it('rejects renumbering across an event whose data may cite seqs', () => {
    const session = toolTurn()
    session.append('test/cites-seq', { seq: 1 })
    const log = events(session)
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'delete', seq: SessionSeq(8) }] }))
      .toThrow(expect.objectContaining({ code: 'UNMAPPABLE_REFERENCE', seq: log.length - 1 }))
  })

  it('rejects edits outside the kept range and on non-message events', () => {
    const log = events(toolTurn())
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length), edits: [] })).toThrow(SessionRewriteError)
    expect(() => rewrite(log, { throughSeq: SessionSeq(3), edits: [{ kind: 'delete', seq: SessionSeq(5) }] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_BOUNDARY' }))
    expect(() => rewrite(log, { throughSeq: SessionSeq(5), edits: [{ kind: 'replace-content', seq: SessionSeq(0), content: [] }] }))
      .toThrow(expect.objectContaining({ code: 'NOT_A_MESSAGE' }))
  })

  it('keeps an untouched inherited prefix and unseeds a log edited inside it', () => {
    const parent = events(toolTurn())
    const seed = buildForkSeed(parent, SessionSeq(parent.length - 1))
    const inherited = SessionLogOffset(parent.length)
    const kept = buildRewriteLog(seed, inherited, { throughSeq: SessionSeq(seed.length - 1), edits: [] })
    expect(kept).toMatchObject({ isSeeded: true, inheritedEventCount: inherited })

    const edited = buildRewriteLog(seed, inherited, { throughSeq: SessionSeq(seed.length - 1), edits: [{ kind: 'replace-content', seq: SessionSeq(1), content: [{ type: 'text', text: 'x' }] }] })
    expect(edited).toMatchObject({ isSeeded: false, inheritedEventCount: 0 })
    expect(edited.events.at(-1)).toMatchObject({ type: 'session/end-seed', data: {} })
    expect(() => Session.create(SessionId('copy'), edited.events)).not.toThrow()
  })
})

describe('buildRewriteLog edge cases', () => {
  it('rejects an edit addressing a message deleted by an earlier edit', () => {
    const log = events(toolTurn())
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'delete', seq: SessionSeq(8) }, { kind: 'delete', seq: SessionSeq(8) }] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_BOUNDARY', seq: 8 }))
  })

  it('replaces system and developer message content inside the message envelope', () => {
    const session = Session.create(SessionId('system'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('system/message', { turn: 1, step: 1, message: createMessage({ role: 'system', content: [{ type: 'text', text: 'old' }], source: { kind: 'system-prompt' } }) }, { surfaceOp: 'append' })
    session.append('developer/message', { turn: 1, step: 1, message: createMessage({ role: 'developer', content: [{ type: 'text', text: 'dev' }], source: { kind: 'user' } }) }, { surfaceOp: 'append' })
    const log = events(session)
    const result = rewrite(log, {
      throughSeq: SessionSeq(3),
      edits: [
        { kind: 'replace-content', seq: SessionSeq(2), content: [{ type: 'text', text: 'new' }] },
        { kind: 'replace-content', seq: SessionSeq(3), content: [{ type: 'text', text: 'dev2' }] },
      ],
    })
    expect(result.events[2]).toMatchObject({ data: { message: { content: [{ type: 'text', text: 'new' }] } } })
    expect(result.events[3]).toMatchObject({ data: { message: { content: [{ type: 'text', text: 'dev2' }] } } })
    expect(result.events.slice(4).map(e => e.type)).toEqual(['step/end', 'turn/end'])
  })

  it('keeps failure identity on a failed tool result edited without a new flag', () => {
    const log = events(toolTurn())
    const result = rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'replace-content', seq: SessionSeq(5), content: [{ type: 'text', text: 'b' }] }] })
    expect(result.events[5]).toMatchObject({ data: { error: { code: 'E' }, message: { isError: true } } })
  })

  it('remaps a replacement surface operation across a deletion', () => {
    const session = Session.create(SessionId('replace'))
    const prompt = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', prompt('a'), { surfaceOp: 'append' })
    session.append('user/message', prompt('b'), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('user/message', prompt('summary'), { surfaceOp: { op: 'replace', startSeq: SessionSeq(2), endSeq: SessionSeq(2) }, sourceEventSeqs: [SessionSeq(2)] })
    const log = events(session)
    const result = rewrite(log, { throughSeq: SessionSeq(4), edits: [{ kind: 'delete', seq: SessionSeq(1) }] })
    expect(result.events[3]).toMatchObject({ surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, sourceEventSeqs: [1] })
    expect(() => Session.create(SessionId('copy'), result.events)).not.toThrow()
  })

  it('rejects a user message inserted between a tool call and its result', () => {
    const log = events(toolTurn())
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'insert-user', afterSeq: SessionSeq(4), content: [{ type: 'text', text: 'x' }] }] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_RESULT' }))
  })

  it('rejects an assistant edit that drops a tool call whose result remains', () => {
    const log = events(toolTurn())
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'replace-content', seq: SessionSeq(3), content: [{ type: 'text', text: 'no tools' }] }] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_RESULT', seq: 5 }))
  })

  it('rejects a deleted tool result whose call step then closes unanswered', () => {
    const log = events(toolTurn())
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'delete', seq: SessionSeq(5) }] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_RESULT', seq: 3 }))
  })

  it('refuses to delete boundary and system events', () => {
    const log = events(toolTurn())
    expect(() => rewrite(log, { throughSeq: SessionSeq(log.length - 1), edits: [{ kind: 'delete', seq: SessionSeq(0) }] }))
      .toThrow(expect.objectContaining({ code: 'NOT_A_MESSAGE', seq: 0 }))
  })

  it('remaps a developer message request-header reference across an insertion', () => {
    const session = Session.create(SessionId('developer'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    const headerSeq = session.append('request/header', {
      reason: 'initial', header: { config: { provider: 'test', model: 'test' }, tools: [{ name: 'search', description: 'Search', parameters: {} }] },
    }).seq
    session.append('developer/message', {
      turn: 1, step: 1, headerSeq,
      message: createDeveloperMessage({ source: { kind: 'test' }, content: [{ type: 'tool-addition', toolName: 'search' }] }),
    }, { surfaceOp: 'append' })
    const log = events(session)
    const result = rewrite(log, { throughSeq: SessionSeq(4), edits: [{ kind: 'insert-user', afterSeq: SessionSeq(1), content: [{ type: 'text', text: 'also' }] }] })
    expect(result.events[5]).toMatchObject({ type: 'developer/message', data: { headerSeq: 4 } })
    expect(() => Session.create(SessionId('copy'), result.events)).not.toThrow()
  })
})
