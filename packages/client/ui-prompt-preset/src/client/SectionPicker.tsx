/** Filter preview section names without filtering out a rule's current selections. */
import { useMemo, useRef, useState } from 'react'
import { IconCloseOutlineRegular, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots/client'
import { TextSearchIndex } from '@deepseek-ai/dsh-util-text-search'
import css from './RuleCard.module.css'

interface SectionPickerProps {
  names: readonly string[]
  selected: readonly string[]
  protectedSections?: readonly string[]
  multiple: boolean
  disabled: boolean
  invalid?: boolean
  label: string
  emptySelectionLabel?: string
  onChange: (sections: string[]) => void
  t: TranslateNS<'settings.promptPreset'>
}

/**
 * Select exact section IDs from the available names or by entering an ID directly.
 * @param props - available names, current selection, protection policy and localized labels.
 * @returns the filter, removable selections and matching options.
 */
export function SectionPicker({
  names, selected, protectedSections, multiple, disabled, invalid, label, emptySelectionLabel, onChange, t,
}: SectionPickerProps) {
  const [query, setQuery] = useState('')
  const filter = useRef<HTMLInputElement>(null)
  const index = useMemo(() => new TextSearchIndex([...new Set(names)], name => ({ fuzzy: [name] })), [names])
  const matches = index.search(query).filter(name => !selected.includes(name))
  const exact = query.trim()
  const manual = exact !== '' && !names.includes(exact) && !selected.includes(exact)
  const restricted = (name: string) => protectedSections?.includes(name) === true
  const pick = (name: string) => {
    if (disabled || restricted(name) || selected.includes(name)) return
    onChange(multiple ? [...new Set([...selected, name])] : [name])
    setQuery('')
    filter.current?.focus()
  }
  return (
    <div role="group" aria-label={label} className={css.fields}>
      <label className={css.label}>
        {label}
        <Input
          ref={filter}
          value={query}
          aria-label={t('rule.field.filter')}
          placeholder={t('rule.field.filter')}
          aria-invalid={invalid}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && exact !== '') {
              event.preventDefault()
              pick(exact)
            }
          }}
        />
      </label>
      {selected.length > 0 ? (
        <div className={css.picker}>
          {[...new Set(selected)].map(name => (
            <Pill
              key={name}
              className={css.pick}
              active
              aria-pressed
              disabled={disabled}
              onClick={() => {
                onChange(selected.filter(id => id !== name))
                filter.current?.focus()
              }}
            >
              {name}<IconCloseOutlineRegular size={12} />
            </Pill>
          ))}
        </div>
      ) : emptySelectionLabel !== undefined && <span className={css.hint}>{emptySelectionLabel}</span>}
      {matches.length > 0 && (
        <div className={css.options}>
          {matches.map(name => (
            <button
              key={name}
              type="button"
              className={css.option}
              disabled={disabled || restricted(name)}
              onClick={() => { pick(name) }}
            >
              <span>{name}</span>
              {restricted(name) && <span className={css.hint}>{t('rule.field.protected')}</span>}
            </button>
          ))}
        </div>
      )}
      {query !== '' && matches.length === 0 && !selected.includes(exact) && (
        <span className={css.hint}>{t('rule.field.noMatches')}</span>
      )}
      {manual && (
        <button type="button" className={css.option} disabled={disabled || restricted(exact)} onClick={() => { pick(exact) }}>
          <span>{t('rule.field.addId', { section: exact })}</span>
          {restricted(exact) && <span className={css.hint}>{t('rule.field.protected')}</span>}
        </button>
      )}
    </div>
  )
}
