/** Per-model reasoning-effort declaration for the pi-ai catalog editor. */

import { useId } from 'react'
import type { ReactNode } from 'react'
import { Checkbox, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Every level a model can offer, in the order selectors show them. */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One reasoning level. */
type Level = typeof LEVELS[number]

/** The stored declaration: absent inherits, `false` disables, a dict declares levels and wire values. */
type Efforts = Partial<Record<Level, string | null>>

/** The three ways a row can declare reasoning. */
type Mode = 'auto' | 'none' | 'custom'

/** What switching to Custom starts from: the common levels, sent by their own names. */
const STARTER: Efforts = { off: null, low: 'low', medium: 'medium', high: 'high' }

/** Locale key of each level's label. */
const LEVEL_KEYS: Readonly<Record<Level, ModelsKey>> = {
  off: 'reasoningLevelOff',
  minimal: 'reasoningLevelMinimal',
  low: 'reasoningLevelLow',
  medium: 'reasoningLevelMedium',
  high: 'reasoningLevelHigh',
  xhigh: 'reasoningLevelXhigh',
  max: 'reasoningLevelMax',
}

/**
 * Read a row's declaration the way the Host does.
 * @param value - the row's raw `reasoningEfforts`.
 * @returns the mode and, for Custom, the declared levels.
 */
function modeOf(value: unknown): { mode: Mode; efforts: Efforts } {
  if (value === undefined) return { mode: 'auto', efforts: {} }
  if (value === false) return { mode: 'none', efforts: {} }
  // A hand-written null or non-dict still reads as Custom, so the inline
  // validation names it instead of the editor silently rewriting it.
  return { mode: 'custom', efforts: typeof value === 'object' && value !== null ? value : {} }
}

/** Props of {@link ModelReasoningEfforts}. */
interface ModelReasoningEffortsProps {
  /** Effective model row, including fields outside the curated editor. */
  model: DeepSeekModelDraft
  /** One-based row position for accessible labels. */
  position: number
  /** Prevent changes while read-only or saving. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Replace this row, preserving unrelated configuration. */
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Choose whether a model borrows its reasoning levels from the built-in
 * catalog by name, does not reason, or declares its own levels and the wire
 * value each one sends.
 * @param props - model declaration and row replacement action.
 * @returns the reasoning-effort fieldset.
 */
export function ModelReasoningEfforts({ model, position, disabled, t, onChange }: ModelReasoningEffortsProps): ReactNode {
  const id = useId()
  const { mode, efforts } = modeOf(model['reasoningEfforts'])
  const write = (next: Efforts | false | undefined) => {
    const row = { ...model }
    if (next === undefined) Reflect.deleteProperty(row, 'reasoningEfforts')
    else row['reasoningEfforts'] = next
    onChange(row)
  }
  const setLevel = (level: Level, wire: string | null | undefined) => {
    const next = { ...efforts }
    if (wire === undefined) Reflect.deleteProperty(next, level)
    else next[level] = wire
    write(next)
  }
  // The Host's own rules, shown before a save it would refuse.
  const valid = LEVELS.some(level => level !== 'off' && efforts[level] !== undefined)
  return (
    <fieldset className={styles['modelReasoning']} aria-label={`${t('reasoningEfforts')} ${String(position)}`}>
      <legend className={styles['modelFieldLabel']}>{t('reasoningEfforts')}</legend>
      <SegmentedControl
        id={id}
        label={`${t('reasoningEfforts')} ${String(position)}`}
        value={mode}
        disabled={disabled}
        options={[
          { value: 'auto', label: t('reasoningAuto') },
          { value: 'none', label: t('reasoningNone') },
          { value: 'custom', label: t('reasoningCustom') },
        ]}
        onChange={(next) => {
          write(next === 'auto' ? undefined : next === 'none' ? false : { ...STARTER })
        }}
      />
      {mode === 'custom'
        ? (
          <div className={styles['modelReasoningLevels']}>
            {LEVELS.map((level) => {
              const wire = efforts[level]
              const on = wire !== undefined
              return (
                <div className={styles['modelReasoningLevel']} key={level}>
                  <Checkbox
                    label={t(LEVEL_KEYS[level])}
                    checked={on}
                    disabled={disabled}
                    onChange={(checked) => {
                      setLevel(level, checked ? (level === 'off' ? null : level) : undefined)
                    }}
                  />
                  <input
                    className={styles['input']}
                    type="text"
                    // Empty sends the level's own name (`off`: nothing at all).
                    value={on && wire !== null && wire !== level ? wire : ''}
                    placeholder={level === 'off' ? t('reasoningWireOff') : level}
                    aria-label={`${t('reasoningWire')} ${level} ${String(position)}`}
                    disabled={disabled || !on}
                    onChange={(event) => {
                      const text = event.target.value.trim()
                      setLevel(level, text !== '' ? text : level === 'off' ? null : level)
                    }}
                  />
                </div>
              )
            })}
            {valid ? null : <p className={styles['modelReasoningError']} role="alert">{t('reasoningNeedsLevel')}</p>}
          </div>
        )
        : <p className={styles['modelReasoningHint']}>{t(mode === 'auto' ? 'reasoningAutoHint' : 'reasoningNoneHint')}</p>}
    </fieldset>
  )
}
