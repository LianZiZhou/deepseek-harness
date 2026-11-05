/**
 * The per-session prompt-preset switcher, beside the mode chip and drawn as
 * that chip is.
 *
 * It offers a live choice rather than a label: the system prompt is re-rendered
 * every step, so a switch reaches the model on the next turn and rewrites
 * nothing the task has already sent. The copy says exactly that.
 */

import { useEffect, useState } from 'react'
import {
  IconChevronDownOutlineRegular, IconContextInjectionOutlineRegular, IconWarningOutlineRegular, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-prompt-presets/types'
import type { PromptPresetSeatState } from './seat-store.ts'
import css from './PromptPresetSeat.module.css'

/** How long a refused switch stays on screen, matching the agent-preset chip's refusal. */
const REFUSAL_HOLD_MS = 8000

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
  /** Clear the last refusal once its banner has run. */
  clearError: () => void
  /**
   * Which surface the control sits on: the new-task screen's chip row, or
   * the task header, where it takes the header's quieter preset-label size.
   */
  variant: 'hero' | 'header'
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
  sessionId, useSessions, usePromptPresetSeat, load, select, clearError, variant, t,
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
  // Name over summary, as the agent-preset menu beside it lists its presets.
  const item = (name: string, description: string) => (
    <span className={css.item}>
      <span className={css.itemName}>{name}</span>
      <span className={css.itemDesc}>{description}</span>
    </span>
  )

  return (
    <>
      <Menu
        open={open}
        align="start"
        portal
        className={css.menuAnchor}
        anchor={(
          <button
            type="button"
            className={variant === 'header' ? `${css.seat} ${css.header}` : css.seat}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${t('seat.label')}: ${label}`}
            title={t('seat.hint')}
            disabled={state.switching}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconContextInjectionOutlineRegular size={variant === 'header' ? 14 : 16} className={css.seatIcon} />
            <span className={css.seatLabel}>{label}</span>
            <IconChevronDownOutlineRegular size={variant === 'header' ? 12 : 14} className={css.chevron} />
          </button>
        )}
        selectedId={selected}
        items={[
          { id: '', label: item(t('seat.none'), t('seat.noneHint')) },
          ...state.options.map(option => ({
            id: option.id,
            label: item(option.name, option.description ?? t('noDescription')),
          })),
        ]}
        footer={[{ type: 'label' as const, id: 'note', text: t('seat.appliesNextTurn') }]}
        onSelect={(id) => {
          setOpen(false)
          void select(id)
        }}
        onClose={() => { setOpen(false) }}
      />
      {state.error !== null && (
        <Toast
          text={t('seat.switchFailed', { message: state.error })}
          icon={<IconWarningOutlineRegular />}
          holdMs={REFUSAL_HOLD_MS}
          // The composer card this control sits above or beside; absent, the
          // banner centers on the window.
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={clearError}
        />
      )}
    </>
  )
}
