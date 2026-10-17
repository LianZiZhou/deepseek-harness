/** Wire-edit resolution and failure mapping for `session.rewrite`. */

import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionRewriteError, type SessionEditOp } from '@deepseek-ai/dsh-session/rewrite'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ApiSessionForeignOwner } from './agent.ts'
import type { SessionEdit, SessionEditBlock } from './types.ts'

/**
 * Map one rewrite failure to the Remote error vocabulary.
 * @param sessionId - Session the rewrite addressed.
 * @param error - failure raised while stopping, rewriting, replacing, or resuming.
 * @returns the Remote error reported to the caller.
 */
export function rewriteFailure(sessionId: SessionId, error: unknown): Error {
  if (remoteErrorOf(error) !== undefined) return error as Error
  if (error instanceof SessionRewriteError) {
    return new RemoteError('session/rewrite-invalid', error.message, {
      sessionId, code: error.code, ...(error.seq === undefined ? {} : { seq: error.seq }),
    })
  }
  if (error instanceof ApiSessionForeignOwner) {
    return new RemoteError('session/rewrite-unavailable', error.message, { sessionId, reason: 'foreign-owner' })
  }
  if (error instanceof Error && (error.name === 'SessionAlreadyOwnedError' || error.name === 'SessionReplaceUnsupportedError' || error.name === 'SessionFormatUnsupportedError')) {
    return new RemoteError('session/rewrite-unavailable', error.message, { sessionId, reason: error.name })
  }
  if (error instanceof Error && error.message.startsWith('invalid seed event')) {
    return new RemoteError('session/rewrite-invalid', error.message, { sessionId, code: 'INVALID_RESULT' })
  }
  return new RemoteError('gateway/internal', `failed to rewrite session "${sessionId}": ${String(error)}`, {})
}

/**
 * Resolve one wire edit against the log it addresses. `keep` blocks reuse the
 * original message's block, so a client can only reference attachments the
 * log already holds.
 * @param edit - wire edit addressed by the client's seqs.
 * @param events - complete stored log the edit addresses.
 * @returns the edit for the rewrite transform.
 * @throws SessionRewriteError for an invalid seq or a missing kept block.
 */
export function toEditOp(edit: SessionEdit, events: readonly SessionEvent[]): SessionEditOp {
  const seqOf = (value: number): SessionSeq => {
    try {
      return SessionSeq(value)
    } catch {
      throw new SessionRewriteError(`edit seq ${String(value)} is not a non-negative safe integer`, 'INVALID_BOUNDARY')
    }
  }
  switch (edit.kind) {
    case 'replace-content': {
      const seq = seqOf(edit.seq)
      const original = messageContent(events[seq])
      return {
        kind: 'replace-content', seq,
        content: edit.content.map(block => toContentBlock(block, original, seq)),
        ...(edit.isError === undefined ? {} : { isError: edit.isError }),
      }
    }
    case 'delete':
      return { kind: 'delete', seq: seqOf(edit.seq) }
    case 'insert-user': {
      const afterSeq = seqOf(edit.afterSeq)
      return { kind: 'insert-user', afterSeq, content: edit.content.map(block => toContentBlock(block, [], afterSeq)) }
    }
    /* v8 ignore next 2 -- closed wire-validated union */
    default:
      return assertNever(edit)
  }
}

function messageContent(event: SessionEvent | undefined): readonly ContentBlock[] {
  // A non-message event has no blocks to keep; the rewrite transform rejects edits aimed at it.
  const message = event === undefined ? null : deriveEventMessage(event)
  return message === null ? [] : message.content
}

function toContentBlock(block: SessionEditBlock, original: readonly ContentBlock[], seq: SessionSeq): ContentBlock {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return { type: block.type, text: block.text }
    case 'tool-call':
      return { type: 'tool-call', id: ToolCallId(block.id), name: block.name, arguments: block.arguments }
    case 'keep': {
      const kept = original[block.index]
      if (kept === undefined) {
        throw new SessionRewriteError(`event ${seq} has no content block ${block.index} to keep`, 'NOT_A_MESSAGE', seq)
      }
      return kept
    }
    /* v8 ignore next 2 -- closed wire-validated union */
    default:
      return assertNever(block)
  }
}
