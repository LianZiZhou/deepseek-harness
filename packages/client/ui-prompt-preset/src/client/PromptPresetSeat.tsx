/**
 * The per-session prompt-preset switcher, beside the mode chip.
 *
 * It offers a live choice rather than a label: the system prompt is re-rendered
 * every step, so a switch reaches the model on the next turn and rewrites
 * nothing the task has already sent. The copy says exactly that.
 */

import { useEffect, useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconContextInjectionOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-prompt-presets/types'
import type { PromptPresetSeatState } from './seat-store.ts'
import css from './PromptPresetSeat.module.css'

/** Registration-side business face for the switcher. */
export interface PromptPresetSeatInjected {
  hooks: {
    /** Seat state bound by the renderer as usePromptPresetSeat. */
    promptPresetSeat: SnapshotStore<PromptPresetSeatState>
  }
  /** Read the roster the menu offers. */
  load: () => Promise<void>
  /** Switch this session's preset; `''` runs none. */
  select: (id: string) => Promise<void>
  /** Clear the last refusal. */
  clearError: () => void
}

/**
 * Full component props.
 *
 * The Hero seat is `session-maybe` and the header seat is `session`, so the
 * wider of the two types the component: a Hero shown before any task exists
 * has no session to read a selection from.
 */
export type PromptPresetSeatProps =
  PropsRuntime<'conversation.hero.controls'>
  & PropsLocale<'settings.promptPreset'>
  & InjectFace<PromptPresetSeatInjected>

/**
 * Render this session's prompt-preset control.
 * @param props - composed slot props.
 * @returns the control, or null while this deployment stores no presets.
 */
export function PromptPresetSeat({
  sessionId, useSessions, usePromptPresetSeat, load, select, clearError, t,
}: PromptPresetSeatProps) {
  const [open, setOpen] = useState(false)
  const state = usePromptPresetSeat(value => value)
  const selected = useSessions((sessions) => {
    const value = sessionId === undefined
      ? undefined
      : sessions.byId[sessionId]?.projectionValues?.promptPreset
    return typeof value === 'string' ? value : ''
  })

  useEffect(() => { void load() }, [load])

  if (state.status === 'unavailable' || state.options.length === 0) return null

  const current = state.options.find(option => option.id === selected)
  const label = current?.name ?? t('seat.none')

  return (
    <span className={css.root}>
      <Menu
        open={open}
        anchor={(
          <Button
            size="sm"
            icon={<IconContextInjectionOutline16 size={14} />}
            title={t('seat.hint')}
            aria-label={t('seat.label')}
            disabled={state.switching}
            onClick={() => { setOpen(true) }}
          >
            {label}
          </Button>
        )}
        selectedId={selected}
        items={[
          { id: '', label: t('seat.none') },
          ...state.options.map(option => ({ id: option.id, label: option.name })),
        ]}
        footer={[{ type: 'label' as const, id: 'note', text: t('seat.appliesNextTurn') }]}
        onSelect={(id) => {
          setOpen(false)
          void select(id)
        }}
        onClose={() => { setOpen(false) }}
      />
      {state.error !== null && (
        <button type="button" className={css.error} onClick={clearError}>
          {t('seat.switchFailed', { message: state.error })}
        </button>
      )}
    </span>
  )
}
