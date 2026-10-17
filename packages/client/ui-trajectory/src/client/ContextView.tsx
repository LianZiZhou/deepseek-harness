/**
 * Context view: the model context the current agent loop sends — derived
 * history, request header, and next-step prompt preview — with an edit mode
 * that rewrites the Session log in place and an any-message fork.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  SessionContextValue, SessionEdit, SessionRewriteValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, InlineEditor, JsonTree, RiskConfirmation, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { jsonTreeLabels } from './TrajectoryTable.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import {
  blocksText, contextRows, draftEdits, draftIsEmpty, draftThrough, EMPTY_DRAFT,
  type ContextBlock, type ContextDraft, type ContextRow,
} from './context-content.ts'
import css from './context-view.module.css'

/** Delay before refetching after the log grows, so a streaming turn refetches at most this often. */
const REFRESH_DELAY_MS = 500

/** Rewrite request fields the view supplies; the Session id is bound by the registration. */
export interface ContextRewrite {
  readonly expectedCursor: number
  readonly throughSeq: number
  readonly edits: readonly SessionEdit[]
  readonly interrupt?: boolean
  readonly resume?: boolean
}

/** Session-bound operations injected by the trajectory plugin. */
export interface ContextViewInjected {
  /** Read the current model context. */
  load: () => Promise<RemoteResult<SessionContextValue>>
  /** Rewrite the Session log in place. */
  rewrite: (request: ContextRewrite) => Promise<RemoteResult<SessionRewriteValue>>
  /** Fork a new Session after `seq` and open it. */
  forkAt: (seq: number) => void
}

type Pending =
  | { readonly kind: 'apply' }
  | { readonly kind: 'restart'; readonly seq: number }

/** One message being edited: its seq and draft blocks. */
interface Editing {
  readonly seq: number
  readonly blocks: readonly ContextBlock[]
}

const ROLE_TONE = {
  system: 'info',
  developer: 'neutral',
  user: 'solid',
  assistant: 'outline',
  tool: 'quiet',
} as const

export function ContextView({
  useSession, useAccess, useTrajectory, load, rewrite, forkAt, t,
}: ConvViewProps & InjectFace<ContextViewInjected> & PropsLocale<'trajectory'>) {
  const running = useSession(snapshot => snapshot.running)
  const latestSeq = useTrajectory(snapshot => snapshot.eventNodes.at(-1)?.seq ?? -1)
  const canRewrite = useAccess('session/rewrite')
  const canFork = useAccess('session/fork')
  const [value, setValue] = useState<SessionContextValue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<ContextDraft>(EMPTY_DRAFT)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [inserting, setInserting] = useState<{ readonly afterSeq: number; readonly text: string } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const current = ++generation.current
    const result = await load()
    if (current !== generation.current) return
    if (result.ok) {
      setValue(result.value)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [load])

  // A staged draft addresses the snapshot it was made against, so edit mode freezes refetches.
  const frozen = editMode && !draftIsEmpty(draft)
  useEffect(() => {
    if (frozen) return
    const timer = setTimeout(() => { void refresh() }, value === null ? 0 : REFRESH_DELAY_MS)
    return () => { clearTimeout(timer) }
    // `value` only selects the first-load delay; a new value must not trigger another load.
  }, [latestSeq, frozen, refresh])

  const rows = useMemo(() => contextRows(value?.messages ?? []), [value])
  const systemNow = rows.find(row => row.message.role === 'system')
  const nextPrompt = value?.next?.systemPrompt
  const promptChanges = nextPrompt !== undefined && nextPrompt !== (systemNow === undefined ? '' : blocksText(systemNow.blocks))

  const commit = async (): Promise<void> => {
    if (pending === null || value === null) return
    const throughSeq = pending.kind === 'restart' ? pending.seq : value.cursor
    const staged = pending.kind === 'restart' ? draftThrough(draft, throughSeq) : draft
    setBusy(true)
    const result = await rewrite({
      expectedCursor: value.cursor,
      throughSeq,
      edits: draftEdits(staged),
      interrupt: running,
      resume: pending.kind === 'restart',
    })
    setBusy(false)
    setPending(null)
    setAcknowledged(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDraft(EMPTY_DRAFT)
    setEditing(null)
    await refresh()
  }

  const stageEdit = (): void => {
    if (editing === null) return
    const replaced = new Map(draft.replaced)
    replaced.set(editing.seq, editing.blocks)
    setDraft({ ...draft, replaced })
    setEditing(null)
  }

  const toggleDelete = (seq: number): void => {
    const deleted = new Set(draft.deleted)
    if (deleted.has(seq)) deleted.delete(seq)
    else deleted.add(seq)
    setDraft({ ...draft, deleted })
  }

  const stageInsert = (): void => {
    if (inserting === null || inserting.text.trim() === '') return
    setDraft({ ...draft, inserted: [...draft.inserted, inserting] })
    setInserting(null)
  }

  return (
    <div className={css.root} data-context-view>
      <div className={css.toolbar} role="toolbar" aria-label={t('context.toolbar')}>
        <span className={css.title}>{t('context.title')}</span>
        {value !== null && <Tag tone="quiet">{t('context.cursor', { seq: String(value.cursor) })}</Tag>}
        <Button size="sm" variant="toolbar" disabled={frozen} onClick={() => { void refresh() }}>{t('context.refresh')}</Button>
        <span className={css.spacer} />
        {canRewrite && (
          <Switch
            checked={editMode}
            label={t('context.editMode')}
            onChange={(next) => {
              setEditMode(next)
              if (!next) {
                setDraft(EMPTY_DRAFT)
                setEditing(null)
                setInserting(null)
              }
            }}
          />
        )}
        {editMode && !draftIsEmpty(draft) && (
          <>
            <Button size="sm" variant="outline" onClick={() => { setDraft(EMPTY_DRAFT) }}>{t('context.discard')}</Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => { setPending({ kind: 'apply' }) }}>{t('context.apply')}</Button>
          </>
        )}
      </div>
      <p className={css.note}>{t('context.note')}</p>
      {error !== null && <p className={css.error} role="alert">{t('context.error', { message: error })}</p>}
      {value === null && error === null && <p className={css.note}>{t('context.loading')}</p>}
      {value !== null && (
        <div className={css.body}>
          {value.request !== undefined && (
            <details className={css.section}>
              <summary>{t('context.request')}</summary>
              <ContextJson value={value.request} label={t('context.request')} t={t} />
            </details>
          )}
          {value.next !== undefined && (
            <details className={css.section}>
              <summary>
                {t('context.nextTools')}
                {promptChanges && <Tag tone="warning">{t('context.promptChanges')}</Tag>}
              </summary>
              {promptChanges && <pre className={css.text}>{value.next.systemPrompt}</pre>}
              <ContextJson value={value.next.tools} label={t('context.nextTools')} t={t} />
            </details>
          )}
          <ol className={css.messages} aria-label={t('context.messages')}>
            {rows.map(row => (
              <ContextMessageRow
                key={row.message.seq}
                row={row}
                draftBlocks={draft.replaced.get(row.message.seq)}
                deleted={draft.deleted.has(row.message.seq)}
                inserted={draft.inserted.filter(insert => insert.afterSeq === row.message.seq)}
                editMode={editMode}
                canFork={canFork}
                editing={editing?.seq === row.message.seq ? editing : null}
                onEdit={() => { setEditing({ seq: row.message.seq, blocks: draft.replaced.get(row.message.seq) ?? row.blocks }) }}
                onEditChange={(blocks) => { setEditing({ seq: row.message.seq, blocks }) }}
                onEditSave={stageEdit}
                onEditCancel={() => { setEditing(null) }}
                onDelete={() => { toggleDelete(row.message.seq) }}
                inserting={inserting?.afterSeq === row.message.seq ? inserting.text : null}
                onInsert={() => { setInserting({ afterSeq: row.message.seq, text: '' }) }}
                onInsertChange={(text) => { setInserting({ afterSeq: row.message.seq, text }) }}
                onInsertSave={stageInsert}
                onInsertCancel={() => { setInserting(null) }}
                onRestart={() => { setPending({ kind: 'restart', seq: row.message.seq }) }}
                onFork={() => { forkAt(row.message.seq) }}
                t={t}
              />
            ))}
          </ol>
        </div>
      )}
      <RiskConfirmation
        open={pending !== null}
        title={pending?.kind === 'restart' ? t('context.confirmRestartTitle') : t('context.confirmApplyTitle')}
        description={pending?.kind === 'restart'
          ? t('context.confirmRestart', { seq: String(pending.seq) })
          : t('context.confirmApply')}
        acknowledgeLabel={t('context.acknowledge')}
        cancelLabel={t('context.cancel')}
        closeLabel={t('context.cancel')}
        confirmLabel={pending?.kind === 'restart' ? t('context.restart') : t('context.apply')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setPending(null)
          setAcknowledged(false)
        }}
        onConfirm={() => { void commit() }}
      />
    </div>
  )
}

function ContextMessageRow({
  row, draftBlocks, deleted, inserted, editMode, canFork, editing, inserting,
  onEdit, onEditChange, onEditSave, onEditCancel, onDelete,
  onInsert, onInsertChange, onInsertSave, onInsertCancel, onRestart, onFork, t,
}: {
  row: ContextRow
  draftBlocks: readonly ContextBlock[] | undefined
  deleted: boolean
  inserted: readonly { readonly text: string }[]
  editMode: boolean
  canFork: boolean
  editing: Editing | null
  inserting: string | null
  onEdit: () => void
  onEditChange: (blocks: readonly ContextBlock[]) => void
  onEditSave: () => void
  onEditCancel: () => void
  onDelete: () => void
  onInsert: () => void
  onInsertChange: (text: string) => void
  onInsertSave: () => void
  onInsertCancel: () => void
  onRestart: () => void
  onFork: () => void
} & PropsLocale<'trajectory'>) {
  const { message } = row
  const blocks = draftBlocks ?? row.blocks
  const deletable = message.role !== 'system'
  return (
    <li className={css.message} data-deleted={deleted || undefined} data-edited={draftBlocks !== undefined || undefined}>
      <div className={css.messageHeader}>
        <Tag tone={ROLE_TONE[message.role]}>{t(`context.role.${message.role}`)}</Tag>
        <span className={css.meta}>{t('context.seq', { seq: String(message.seq), event: message.event })}</span>
        {message.projected === true && <Tag tone="info">{t('context.projected')}</Tag>}
        {message.isError === true && <Tag tone="danger">{t('context.toolError')}</Tag>}
        {draftBlocks !== undefined && <Tag tone="warning">{t('context.edited')}</Tag>}
        {deleted && <Tag tone="danger">{t('context.deleted')}</Tag>}
        <span className={css.spacer} />
        {canFork && <Button size="sm" variant="ghost" onClick={onFork}>{t('context.fork')}</Button>}
        {editMode && (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit}>{t('context.edit')}</Button>
            {deletable && <Button size="sm" variant="ghost" onClick={onDelete}>{deleted ? t('context.undelete') : t('context.delete')}</Button>}
            <Button size="sm" variant="ghost" onClick={onInsert}>{t('context.insertAfter')}</Button>
            <Button size="sm" variant="ghost" onClick={onRestart}>{t('context.restartHere')}</Button>
          </>
        )}
      </div>
      {editing === null
        ? <ContextBlocks blocks={blocks} t={t} />
        : <BlockEditor blocks={editing.blocks} onChange={onEditChange} onSave={onEditSave} onCancel={onEditCancel} t={t} />}
      {inserted.map((insert, index) => (
        <div key={index} className={css.inserted}>
          <Tag tone="warning">{t('context.insertedUser')}</Tag>
          <pre className={css.text}>{insert.text}</pre>
        </div>
      ))}
      {inserting !== null && (
        <InlineEditor
          value={inserting}
          label={t('context.insertAfter')}
          onChange={onInsertChange}
          onSave={onInsertSave}
          onCancel={onInsertCancel}
        />
      )}
    </li>
  )
}

function ContextBlocks({ blocks, t }: { blocks: readonly ContextBlock[] } & PropsLocale<'trajectory'>) {
  return (
    <div className={css.blocks}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'text':
            return <pre key={index} className={css.text}>{block.text}</pre>
          case 'reasoning':
            return <pre key={index} className={css.reasoning} aria-label={t('context.reasoning')}>{block.text}</pre>
          case 'tool-call':
            return (
              <div key={index} className={css.toolCall}>
                <span className={css.meta}>{t('context.toolCall', { name: block.name, id: block.id })}</span>
                <pre className={css.text}>{block.arguments}</pre>
              </div>
            )
          case 'other':
            return <ContextJson key={index} value={block.value} label={block.type} t={t} />
        }
      })}
    </div>
  )
}

function BlockEditor({ blocks, onChange, onSave, onCancel, t }: {
  blocks: readonly ContextBlock[]
  onChange: (blocks: readonly ContextBlock[]) => void
  onSave: () => void
  onCancel: () => void
} & PropsLocale<'trajectory'>) {
  const update = (index: number, next: ContextBlock): void => {
    onChange(blocks.map((block, at) => at === index ? next : block))
  }
  return (
    <div className={css.blocks}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'text':
          case 'reasoning':
            return (
              <textarea
                key={index}
                className={css.editor}
                aria-label={block.kind === 'text' ? t('context.editText') : t('context.reasoning')}
                value={block.text}
                onChange={(event) => { update(index, { ...block, text: event.currentTarget.value }) }}
              />
            )
          case 'tool-call':
            return (
              <div key={index} className={css.toolCall}>
                <span className={css.meta}>{t('context.toolCall', { name: block.name, id: block.id })}</span>
                <textarea
                  className={css.editor}
                  aria-label={t('context.editArguments')}
                  value={block.arguments}
                  onChange={(event) => { update(index, { ...block, arguments: event.currentTarget.value }) }}
                />
              </div>
            )
          case 'other':
            return <p key={index} className={css.meta}>{t('context.keptBlock', { type: block.type })}</p>
        }
      })}
      <div className={css.editorActions}>
        <Button size="sm" variant="outline" onClick={onCancel}>{t('context.cancel')}</Button>
        <Button size="sm" variant="primary" onClick={onSave}>{t('context.stage')}</Button>
      </div>
    </div>
  )
}

function ContextJson({ value, label, t }: { value: JsonValue; label: string } & PropsLocale<'trajectory'>) {
  if (typeof value !== 'object' || value === null) return <pre className={css.text}>{JSON.stringify(value)}</pre>
  return <JsonTree data={value} label={label} copyable labels={jsonTreeLabels(t)} />
}
