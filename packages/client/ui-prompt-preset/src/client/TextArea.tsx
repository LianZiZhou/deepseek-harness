/**
 * Multi-line text field for rule bodies.
 *
 * Package-local by design: `ui-primitives` ships no multi-line control, and the
 * two raw textareas elsewhere in the client are not this control — one is a
 * mirrored auto-growing composer field, the other a fixed dialog note. Promote
 * this to `ui-primitives` the moment a second package needs exactly it.
 */

import { useLayoutEffect, useRef } from 'react'
import clsx from 'clsx'
import css from './TextArea.module.css'

/** Everything this field renders; every string arrives localized. */
export interface TextAreaProps {
  /** Current text. */
  value: string
  /** Called with the next text on every keystroke. */
  onChange: (next: string) => void
  /** Accessible name; the field carries no visible label of its own. */
  ariaLabel: string
  /** Placeholder shown while the field is empty. */
  placeholder?: string
  /** Rows to show before growing. */
  rows?: number
  /** Rows to grow to before scrolling. */
  maxRows?: number
  /** Whether the field is rejected, so it renders marked. */
  invalid?: boolean
  /** Render in a monospace face, for patterns and replacements. */
  monospace?: boolean
  /** Whether editing is blocked. */
  disabled?: boolean
}

/**
 * Render an auto-growing multi-line field.
 * @param props - the field's value, callbacks, and localized labels.
 * @returns the field.
 */
export function TextArea({
  value, onChange, ariaLabel, placeholder, rows = 3, maxRows = 16, invalid = false,
  monospace = false, disabled = false,
}: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    /* v8 ignore next -- the ref is attached before any effect can observe it. */
    if (element === null) return
    // Collapse first, so shrinking text shrinks the field too.
    element.style.height = 'auto'
    const line = Number.parseFloat(getComputedStyle(element).lineHeight) || 20
    element.style.height = `${String(Math.min(element.scrollHeight, line * maxRows))}px`
  }, [value, maxRows])

  return (
    <textarea
      ref={ref}
      className={clsx(css.field, monospace && css.mono, invalid && css.invalid)}
      value={value}
      rows={rows}
      spellCheck={!monospace}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      placeholder={placeholder}
      onChange={(event) => { onChange(event.target.value) }}
    />
  )
}
