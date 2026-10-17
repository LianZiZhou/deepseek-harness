/**
 * Destructive in-place Session log rewrite: truncate a stored log at an
 * inclusive seq, apply user edits to the kept prefix, and close any open tail
 * turn so the agent loop can restart from that point under the same Session id.
 * @module @deepseek-ai/dsh-session/rewrite
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { openTurnClosers } from './repair.ts'
import { SessionLogOffset, SessionSeq } from './types.ts'
import type {
  SessionEvent, SessionLogOffset as SessionLogOffsetType, SessionSeq as SessionSeqType,
  SurfaceEventType,
} from './types.ts'

/**
 * One user edit against the original seqs of the log being rewritten.
 *
 * - `replace-content`: replace the content blocks of one message-producing
 *   event, keeping its id, role, and source. A tool result may also change
 *   `isError`. An assistant edit drops its embedded stream, usage, and
 *   provider replay state, and updates matching `tool/call` events.
 * - `delete`: remove one message-producing event other than the system head.
 * - `insert-user`: add a user message immediately after `afterSeq`.
 */
export type SessionEditOp =
  | {
    readonly kind: 'replace-content'
    readonly seq: SessionSeqType
    readonly content: readonly ContentBlock[]
    readonly isError?: boolean
  }
  | { readonly kind: 'delete'; readonly seq: SessionSeqType }
  | { readonly kind: 'insert-user'; readonly afterSeq: SessionSeqType; readonly content: readonly ContentBlock[] }

/** A rewrite request: keep `events[0..throughSeq]`, then apply `edits` in order. */
export interface SessionRewritePlan {
  /** Inclusive original seq of the last kept event. */
  readonly throughSeq: SessionSeqType
  /** Edits addressed by original seqs, all at or below `throughSeq`. */
  readonly edits: readonly SessionEditOp[]
}

/** The rewritten log and the fork metadata it now carries. */
export interface SessionRewriteResult {
  /** Contiguous events from seq 0, closed for restart. */
  readonly events: SessionEvent[]
  /** Fork-inherited prefix length of the rewritten log. */
  readonly inheritedEventCount: SessionLogOffsetType
  /** Whether the rewritten log still carries an unedited inherited fork prefix. */
  readonly isSeeded: boolean
}

/**
 * Rewrite rejection codes: an out-of-range seq (`INVALID_BOUNDARY`), an edit
 * aimed at an event that carries no message (`NOT_A_MESSAGE`), an edit whose
 * renumbering would move an event whose data may cite seqs this module cannot
 * remap (`UNMAPPABLE_REFERENCE`), or a result that breaks Session or tool-call
 * pairing invariants (`INVALID_RESULT`).
 */
export type SessionRewriteErrorCode =
  | 'INVALID_BOUNDARY'
  | 'NOT_A_MESSAGE'
  | 'UNMAPPABLE_REFERENCE'
  | 'INVALID_RESULT'

/** Typed rejection of a rewrite plan; the source log is never modified. */
export class SessionRewriteError extends Error {
  /**
   * @param message - actionable description naming the offending seq.
   * @param code - stable rejection category.
   * @param seq - original seq the rejection names, when one applies.
   */
  constructor(message: string, public readonly code: SessionRewriteErrorCode, public readonly seq?: SessionSeqType) {
    super(message)
    this.name = 'SessionRewriteError'
  }
}

/**
 * Event types whose seq can move: none of them cite other seqs in `data`
 * except `developer/message.headerSeq`, which this module remaps. Surface
 * envelope fields (`surfaceOp`, `sourceEventSeqs`) are remapped for every event.
 */
const RENUMBERABLE_TYPES: ReadonlySet<string> = new Set([
  'turn/start', 'turn/end', 'step/start', 'step/end',
  'system/message', 'developer/message', 'user/message', 'assistant/message', 'assistant/attempt',
  'tool/call', 'tool/result', 'request/header', 'request/context', 'session/end-seed',
  'llm/retry', 'llm/retry-started',
])

const SURFACE_TYPES: ReadonlySet<string> = new Set<SurfaceEventType>([
  'system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result',
])

type Slot = { readonly original: SessionSeqType | null; event: SessionEvent }

/**
 * Build the replacement log for an in-place rewrite. Events after
 * `throughSeq` are discarded; an open tail turn receives `interrupted`
 * closers, which the resume policy accepts. An edit or cut that reaches into
 * an inherited fork prefix turns the result into an unseeded log, because the
 * copy no longer matches the parent.
 *
 * @param events - complete stored log, contiguous from seq 0.
 * @param inheritedEventCount - stored fork-inherited prefix length.
 * @param plan - cut point and edits addressed by original seqs.
 * @returns the replacement events and fork metadata; the input is not modified.
 * @throws SessionRewriteError when the plan is out of range, targets a non-message, needs an unsafe renumbering, or yields an invalid log.
 */
export function buildRewriteLog(
  events: readonly SessionEvent[],
  inheritedEventCount: SessionLogOffsetType,
  plan: SessionRewritePlan,
): SessionRewriteResult {
  const { throughSeq } = plan
  if (!Number.isSafeInteger(throughSeq) || throughSeq < 0 || throughSeq >= events.length || events[throughSeq]?.seq !== throughSeq) {
    throw new SessionRewriteError(`rewrite boundary ${String(throughSeq)} does not exist (last seq: ${String(events.at(-1)?.seq ?? 'none')})`, 'INVALID_BOUNDARY', throughSeq)
  }
  const slots: Slot[] = events.slice(0, throughSeq + 1).map(event => ({ original: event.seq, event }))
  let earliestChange: number = throughSeq + 1
  let renumbered = false
  for (const edit of plan.edits) {
    const target = edit.kind === 'insert-user' ? edit.afterSeq : edit.seq
    if (!Number.isSafeInteger(target) || target < 0 || target > throughSeq) {
      throw new SessionRewriteError(`edit seq ${String(target)} is outside the kept range 0..${throughSeq}`, 'INVALID_BOUNDARY', target)
    }
    const index = slots.findIndex(slot => slot.original === target)
    if (index < 0) throw new SessionRewriteError(`edit seq ${target} was already deleted`, 'INVALID_BOUNDARY', target)
    earliestChange = Math.min(earliestChange, target)
    switch (edit.kind) {
      case 'replace-content':
        applyReplace(slots, index, edit)
        break
      case 'delete': {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- index came from findIndex.
        const event = slots[index]!.event
        if (!SURFACE_TYPES.has(event.type) || event.type === 'system/message') {
          throw new SessionRewriteError(`event ${target} (${event.type}) cannot be deleted; only user, developer, assistant, and tool-result messages can`, 'NOT_A_MESSAGE', target)
        }
        slots.splice(index, 1)
        renumbered = true
        break
      }
      case 'insert-user': {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- index came from findIndex.
        const anchor = slots[index]!.event
        slots.splice(index + 1, 0, {
          original: null,
          event: {
            type: 'user/message',
            seq: SessionSeq(0),
            time: anchor.time,
            data: {
              id: brandString<MessageId>(`rewrite-user-${target}-${index}`),
              role: 'user',
              content: edit.content,
              source: { kind: 'user' },
            },
            surfaceOp: 'append',
          },
        })
        renumbered = true
        break
      }
    }
  }
  if (renumbered) assertRenumberable(slots)
  const kept = renumber(slots)
  assertToolPairing(kept)

  const keepsInherited = inheritedEventCount > 0 && earliestChange > inheritedEventCount && throughSeq >= inheritedEventCount
  const prefix = keepsInherited ? kept : kept.map(event => event.type === 'session/end-seed' && event.data.inherited === true
    ? { ...event, data: {} }
    : event)
  const result = prefix.concat(openTurnClosers(prefix, { kind: 'interrupted' }))
  return {
    events: result,
    inheritedEventCount: keepsInherited ? inheritedEventCount : SessionLogOffset(0),
    isSeeded: keepsInherited,
  }
}

function applyReplace(slots: Slot[], index: number, edit: Extract<SessionEditOp, { kind: 'replace-content' }>): void {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- index came from findIndex.
  const slot = slots[index]!
  const event = slot.event
  switch (event.type) {
    case 'user/message':
      slot.event = { ...event, data: { ...event.data, content: edit.content } }
      return
    case 'developer/message':
    case 'system/message':
      slot.event = { ...event, data: { ...event.data, message: { ...event.data.message, content: edit.content } } } as SessionEvent
      return
    case 'tool/result': {
      // A successful result may not carry failure identity.
      const { error, ...data } = event.data
      const isError = edit.isError ?? event.data.message.isError
      slot.event = {
        ...event,
        data: {
          ...data,
          message: { ...event.data.message, content: edit.content, ...isError === undefined ? {} : { isError } },
          ...isError === true && error !== undefined ? { error } : {},
        },
      }
      return
    }
    case 'assistant/message': {
      const { usage: _usage, interrupted: _interrupted, ...rest } = event.data
      const { replayState: _replay, ...source } = event.data.message.source
      slot.event = {
        ...event,
        data: { ...rest, stream: [], message: { ...event.data.message, content: edit.content, source } },
      }
      syncToolCalls(slots, edit.content, event.data.turn, event.data.step)
      return
    }
    default:
      throw new SessionRewriteError(`event ${String(slot.original)} (${event.type}) carries no editable message`, 'NOT_A_MESSAGE', slot.original ?? undefined)
  }
}

/** Keep logged `tool/call` events in the same step consistent with edited assistant tool-call blocks. */
function syncToolCalls(slots: Slot[], content: readonly ContentBlock[], turn: number, step: number): void {
  const calls = new Map<ToolCallId, { name: string; arguments: string }>()
  for (const block of content) {
    if (block.type === 'tool-call') calls.set(block.id, { name: block.name, arguments: block.arguments })
  }
  for (const slot of slots) {
    const event = slot.event
    if (event.type !== 'tool/call' || event.data.turn !== turn || event.data.step !== step) continue
    const call = calls.get(event.data.callId)
    if (call !== undefined) slot.event = { ...event, data: { ...event.data, ...call } }
  }
}

function assertRenumberable(slots: readonly Slot[]): void {
  let shifted = false
  for (const [index, slot] of slots.entries()) {
    if (slot.original !== index) shifted = true
    if (shifted && !RENUMBERABLE_TYPES.has(slot.event.type)) {
      throw new SessionRewriteError(
        `deleting or inserting before event ${String(slot.original)} (${slot.event.type}) would move an event whose data may cite other events; edit content instead, or cut the log before it`,
        'UNMAPPABLE_REFERENCE',
        slot.original ?? undefined,
      )
    }
  }
}

function renumber(slots: readonly Slot[]): SessionEvent[] {
  const map = new Map<number, SessionSeqType>()
  for (const [index, slot] of slots.entries()) {
    if (slot.original !== null) map.set(slot.original, SessionSeq(index))
  }
  const remap = (seq: SessionSeqType, at: number): SessionSeqType => {
    const next = map.get(seq)
    if (next === undefined) {
      throw new SessionRewriteError(`event at new position ${at} cites deleted event ${seq}`, 'UNMAPPABLE_REFERENCE', seq)
    }
    return next
  }
  return slots.map((slot, index) => {
    let event: SessionEvent = { ...slot.event, seq: SessionSeq(index) }
    if (slot.original === index) return event
    if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') {
      event = { ...event, surfaceOp: { op: 'replace', startSeq: remap(event.surfaceOp.startSeq, index), endSeq: remap(event.surfaceOp.endSeq, index) } } as SessionEvent
    }
    if (event.sourceEventSeqs !== undefined) {
      event = { ...event, sourceEventSeqs: event.sourceEventSeqs.map(seq => remap(seq, index)) } as SessionEvent
    }
    if (event.type === 'developer/message' && event.data.headerSeq !== undefined) {
      event = { ...event, data: { ...event.data, headerSeq: remap(event.data.headerSeq, index) } }
    }
    return event
  })
}

/**
 * Every tool result answers an earlier assistant tool-call of the same step,
 * and every closed step answers all of its calls. The open tail step is left
 * to the restart closers.
 */
function assertToolPairing(events: readonly SessionEvent[]): void {
  const pending = new Map<ToolCallId, SessionSeqType>()
  for (const event of events) {
    switch (event.type) {
      case 'assistant/message':
        for (const block of event.data.message.content) {
          if (block.type === 'tool-call') pending.set(block.id, event.seq)
        }
        break
      case 'tool/result': {
        const callId = event.data.message.toolCallId
        if (event.surfaceOp === 'append' && !pending.delete(callId)) {
          throw new SessionRewriteError(`tool result ${event.seq} answers call "${callId}", which no earlier assistant message in its step requests`, 'INVALID_RESULT', event.seq)
        }
        break
      }
      case 'user/message':
        if (pending.size > 0) {
          throw new SessionRewriteError(`user message ${event.seq} sits between a tool call and its result`, 'INVALID_RESULT', event.seq)
        }
        break
      case 'step/end':
      case 'turn/end':
        if (pending.size > 0) {
          const [callId, seq] = [...pending][0] ?? []
          throw new SessionRewriteError(`tool call "${String(callId)}" requested by event ${String(seq)} has no result before its step closed`, 'INVALID_RESULT', seq)
        }
        pending.clear()
        break
      case 'turn/start':
        pending.clear()
        break
      // Other events do not request or answer tool calls.
      default:
        break
    }
  }
}
