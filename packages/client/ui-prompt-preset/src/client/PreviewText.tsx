/** Literal prompt text with optional baseline edits and Host-attributed interpolation spans. */
import { Fragment, useMemo, type ReactNode } from 'react'
import { diffLines, diffWordsWithSpace, type ChangeObject } from 'diff'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives/client'
import type { PromptPresetPreviewSection } from '@deepseek-ai/dsh-prompt-presets/types'
import css from './PromptPreview.module.css'

type Source = Pick<PromptPresetPreviewSection, 'text' | 'variables'>
type Variables = NonNullable<Source['variables']>

/**
 * Translate section-local UTF-16 ranges into the Host prompt's coordinates.
 * @param text - authoritative prompt text; it is never rebuilt for display.
 * @param sections - Host order; empty sections contribute no join separator.
 * @returns the literal prompt and the ranges it can attribute.
 */
export function promptSource(text: string, sections: readonly PromptPresetPreviewSection[]): Source {
  if (!sections.some(section => section.variables?.length)) return { text }
  let end = 0
  const variables: Variables[number][] = []
  for (const section of sections) {
    if (!section.text) continue
    const start = end === 0 ? 0 : end + 2
    if ((end !== 0 && !text.startsWith('\n\n', end)) || !text.startsWith(section.text, start)) return { text }
    for (const span of section.variables ?? []) {
      variables.push({ ...span, start: span.start + start, end: span.end + start })
    }
    end = start + section.text.length
  }
  return end === text.length ? { text, variables } : { text }
}

/** Read successive intervals without rescanning resolved values or previously consumed spans. */
function sourceReader({ text, variables = [] }: Source, inRow = false) {
  let position = 0
  let variable = 0
  let lastAnchor = -1
  return (length: number, skip = false): ReactNode => {
    const end = position + length
    const parts: ReactNode[] = []
    while (position < end) {
      const span = variables[variable]
      if (span === undefined || span.start >= end) break
      if (span.end <= position) { variable++; continue }
      if (position < span.start && !skip) parts.push(text.slice(position, span.start))
      const limit = Math.min(span.end, end)
      if (!skip && span.start < span.end) {
        parts.push(
          <Tooltip key={span.start} label={span.token} side="top" portal openOnClick={!inRow}>
            <span tabIndex={inRow ? undefined : lastAnchor === variable ? -1 : 0} className={css.variable}>
              {text.slice(Math.max(position, span.start), limit)}
            </span>
          </Tooltip>,
        )
        lastAnchor = variable
      }
      position = limit
    }
    if (!skip && position < end) parts.push(text.slice(position, end))
    position = end
    return parts
  }
}

/**
 * Render the hoverable excerpt inside a section's dialog button without nesting keyboard stops.
 * @param section - rendered text and its template expansions.
 * @returns the start of the section, with the same variable marks as the full text.
 */
export function sectionExcerpt(section: Source): ReactNode {
  return sourceReader(section, true)(Math.min(section.text.length, 160))
}

type Hunk = { equal: string } | { removed: string; added: string }

/** Keep both sides of a replacement together so a deletion never looks like current text. */
function* hunks(changes: readonly ChangeObject<string>[]): Generator<Hunk> {
  let removed = ''
  let added = ''
  for (const change of changes) {
    if (change.removed) removed += change.value
    else if (change.added) added += change.value
    else {
      if (removed || added) yield { removed, added }
      yield { equal: change.value }
      removed = added = ''
    }
  }
  if (removed || added) yield { removed, added }
}

const EMPTY: Source = { text: '' }
/** Keep synchronous edit searches bounded; above either limit both source fragments remain visible. */
const LINE_EDIT_LIMIT = 256
const WORD_EDIT_LIMIT = 96
const INLINE_TEXT_LIMIT = 1024

function compare(before: Source, after: Source): ReactNode {
  const oldText = sourceReader(before)
  const newText = sourceReader(after)
  const parts: ReactNode[] = []
  let oldEnd = 0
  let newEnd = 0
  function emit(hunk: Hunk, block: boolean) {
    const key = `${oldEnd}:${newEnd}`
    if ('equal' in hunk) {
      oldEnd += hunk.equal.length
      newEnd += hunk.equal.length
      oldText(hunk.equal.length, true)
      parts.push(<Fragment key={key}>{newText(hunk.equal.length)}</Fragment>)
      return
    }
    oldEnd += hunk.removed.length
    newEnd += hunk.added.length
    const edit = <>
      {hunk.removed !== '' && <del>{oldText(hunk.removed.length)}</del>}
      {hunk.added !== '' && <ins>{newText(hunk.added.length)}</ins>}
    </>
    parts.push(
      <span key={key} className={css.edit} data-block={block || undefined}>
        {hunk.removed && hunk.added ? <mark>{edit}</mark> : edit}
      </span>,
    )
  }

  if (!before.text || !after.text) {
    emit({ removed: before.text, added: after.text }, true)
    return parts
  }
  const lines = diffLines(before.text, after.text, { maxEditLength: LINE_EDIT_LIMIT })
  for (const hunk of lines ? hunks(lines) : [{ removed: before.text, added: after.text }]) {
    if (!('equal' in hunk) && hunk.added && hunk.removed
      && hunk.added.length + hunk.removed.length <= INLINE_TEXT_LIMIT
      && !/\n./s.test(hunk.added) && !/\n./s.test(hunk.removed)) {
      const words = diffWordsWithSpace(hunk.removed, hunk.added, { maxEditLength: WORD_EDIT_LIMIT })
      if (words !== undefined) {
        for (const word of hunks(words)) emit(word, false)
        continue
      }
    }
    emit(hunk, true)
  }
  return parts
}

/**
 * Render one inspected source without mounting tooltip anchors behind a disclosure.
 * @param props - current and no-preset text (either may be absent), highlight toggle and presentation.
 * @returns whitespace-preserving literal text, optionally decorated with baseline edits.
 */
export function PreviewText({ current = EMPTY, baseline = EMPTY, highlight, className }: {
  current: Source | undefined
  baseline: Source | undefined
  highlight: boolean
  className: string | undefined
}) {
  const content = useMemo(() => {
    if (highlight && current.text !== baseline.text) return compare(baseline, current)
    return sourceReader(current)(current.text.length)
  }, [current, baseline, highlight])
  return <pre dir="auto" className={className}>{content}</pre>
}
