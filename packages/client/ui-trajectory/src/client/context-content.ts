/**
 * Context view content model: parses the JSON content blocks `session.context`
 * returns and turns a staged draft into `session.rewrite` edits.
 */

import type {
  SessionContextMessage, SessionEdit, SessionEditBlock,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** One content block as the Context view shows and edits it. */
export type ContextBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
  /** Any other block (image, file, tool change): shown as JSON, kept unchanged by edits. */
  | { readonly kind: 'other'; readonly type: string; readonly value: JsonValue }

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: { readonly [key: string]: JsonValue }, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' ? field : undefined
}

/**
 * Parse wire content blocks. Values that are not block objects become `other`
 * blocks, so a newer Host block type stays visible and is kept on edit.
 * @param content - the `content` field of one context message.
 * @returns the blocks in order.
 */
export function parseContextBlocks(content: JsonValue): ContextBlock[] {
  if (!Array.isArray(content)) return [{ kind: 'other', type: 'content', value: content }]
  return content.map((block): ContextBlock => {
    if (!isRecord(block)) return { kind: 'other', type: 'unknown', value: block }
    const type = stringField(block, 'type') ?? 'unknown'
    const text = stringField(block, 'text')
    if ((type === 'text' || type === 'reasoning') && text !== undefined) return { kind: type, text }
    const id = stringField(block, 'id')
    const name = stringField(block, 'name')
    const args = stringField(block, 'arguments')
    if (type === 'tool-call' && id !== undefined && name !== undefined && args !== undefined) {
      return { kind: 'tool-call', id, name, arguments: args }
    }
    return { kind: 'other', type, value: block }
  })
}

/**
 * Plain text of a message for previews and comparisons.
 * @param blocks - parsed message blocks.
 * @returns the blocks' text joined by newlines, with other blocks named by type.
 */
export function blocksText(blocks: readonly ContextBlock[]): string {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'text':
      case 'reasoning':
        return block.text
      case 'tool-call':
        return `${block.name}(${block.arguments})`
      case 'other':
        return `[${block.type}]`
    }
  }).join('\n')
}

/**
 * Wire blocks for an edited message: edited text, reasoning, and tool calls
 * are sent as new content; every other original block is kept by index.
 * @param blocks - the edited blocks, in the original order.
 * @returns the edit blocks for `replace-content`.
 */
export function toEditBlocks(blocks: readonly ContextBlock[]): SessionEditBlock[] {
  return blocks.map((block, index): SessionEditBlock => {
    switch (block.kind) {
      case 'text':
      case 'reasoning':
        return { type: block.kind, text: block.text }
      case 'tool-call':
        return { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments }
      case 'other':
        return { type: 'keep', index }
    }
  })
}

/** Locally staged changes, keyed by the seqs of the snapshot they were made against. */
export interface ContextDraft {
  /** Replacement blocks by message seq. */
  readonly replaced: ReadonlyMap<number, readonly ContextBlock[]>
  /** Deleted message seqs. */
  readonly deleted: ReadonlySet<number>
  /** User message text inserted after a seq, in insertion order. */
  readonly inserted: readonly { readonly afterSeq: number; readonly text: string }[]
}

/** A draft with nothing staged. */
export const EMPTY_DRAFT: ContextDraft = { replaced: new Map(), deleted: new Set(), inserted: [] }

/**
 * Whether the draft stages no change.
 * @param draft - staged changes.
 * @returns true when nothing is replaced, deleted, or inserted.
 */
export function draftIsEmpty(draft: ContextDraft): boolean {
  return draft.replaced.size === 0 && draft.deleted.size === 0 && draft.inserted.length === 0
}

/**
 * Turn a draft into rewrite edits. Replacements of deleted messages are
 * dropped; inserts follow in the order they were staged.
 * @param draft - staged changes.
 * @returns edits addressed by the snapshot's seqs.
 */
export function draftEdits(draft: ContextDraft): SessionEdit[] {
  const edits: SessionEdit[] = []
  for (const [seq, blocks] of draft.replaced) {
    if (!draft.deleted.has(seq)) edits.push({ kind: 'replace-content', seq, content: toEditBlocks(blocks) })
  }
  for (const seq of draft.deleted) edits.push({ kind: 'delete', seq })
  for (const insert of draft.inserted) {
    edits.push({ kind: 'insert-user', afterSeq: insert.afterSeq, content: [{ type: 'text', text: insert.text }] })
  }
  return edits
}

/**
 * Restrict a draft to the messages kept by a cut at `throughSeq`.
 * @param draft - staged changes.
 * @param throughSeq - inclusive seq of the last kept event.
 * @returns the staged changes at or before the cut.
 */
export function draftThrough(draft: ContextDraft, throughSeq: number): ContextDraft {
  return {
    replaced: new Map([...draft.replaced].filter(([seq]) => seq <= throughSeq)),
    deleted: new Set([...draft.deleted].filter(seq => seq <= throughSeq)),
    inserted: draft.inserted.filter(insert => insert.afterSeq <= throughSeq),
  }
}

/** The editable message view of one context message. */
export interface ContextRow {
  readonly message: SessionContextMessage
  readonly blocks: readonly ContextBlock[]
}

/**
 * Pair each context message with its parsed blocks.
 * @param messages - messages from one context snapshot.
 * @returns rows in model order.
 */
export function contextRows(messages: readonly SessionContextMessage[]): ContextRow[] {
  return messages.map(message => ({ message, blocks: parseContextBlocks(message.content) }))
}
