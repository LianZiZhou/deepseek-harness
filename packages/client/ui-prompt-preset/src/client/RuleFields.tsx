/**
 * The per-kind field sets of one rule.
 *
 * Every rule kind edits different things, so the card delegates its body here
 * and keeps its own chrome — order, on/off, delete — identical across kinds.
 */

import clsx from 'clsx'
import { Checkbox, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PromptRule } from '@deepseek-ai/dsh-prompt-presets/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { parseSections, ruleBlocker } from './preset-model.ts'
import { TextArea } from './TextArea.tsx'
import css from './RuleCard.module.css'

/** What one rule body needs to render and report. */
export interface RuleFieldsProps {
  /** The rule being edited. */
  rule: PromptRule
  /** Called with the rule as it now stands. */
  onChange: (rule: PromptRule) => void
  /** Whether editing is blocked while a save is in flight. */
  disabled: boolean
  /** The section names this preview offers, as chips beside the section fields. */
  sectionNames: readonly string[]
  /** Localized copy. */
  t: TranslateNS<'settings.promptPreset'>
}

/**
 * The section names this preview offers, as chips that fill the field beside them.
 * @param props - the names, which are chosen, the group's name, and the pick callback.
 * @returns the chips, or null while no preview has named any section.
 */
function SectionPicker({ names, chosen, label, disabled, onPick }: {
  names: readonly string[]
  chosen: readonly string[]
  label: string
  disabled: boolean
  onPick: (name: string) => void
}) {
  if (names.length === 0) return null
  return (
    <div className={css.picker} role="group" aria-label={label}>
      {names.map((name) => {
        const active = chosen.includes(name)
        return (
          <Pill
            key={name}
            className={css.pick}
            active={active}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => { onPick(name) }}
          >
            {name}
          </Pill>
        )
      })}
    </div>
  )
}

/**
 * Add a section name to a list, or take it out when it is already there.
 * @param sections - the names chosen so far.
 * @param name - the name picked.
 * @returns the list with `name` toggled, in pick order.
 */
function toggleSection(sections: readonly string[], name: string): string[] {
  return sections.includes(name) ? sections.filter(entry => entry !== name) : [...sections, name]
}

/** The rule kinds that carry text and may interpolate variables into it. */
type TextRule = Extract<PromptRule, { kind: 'prepend' | 'append' | 'replace' | 'insert' }>

/**
 * The text field and interpolation checkbox every text-carrying rule shows.
 * @param props - the rule, its change callback, the field's height, whether the text is the refused field, and localized copy.
 * @returns the text field followed by its checkbox.
 */
function RuleText({ rule, onChange, rows, invalid, disabled, t }: {
  rule: TextRule
  onChange: (rule: PromptRule) => void
  rows: number
  invalid: boolean
  disabled: boolean
  t: TranslateNS<'settings.promptPreset'>
}) {
  return (
    <>
      <TextArea
        value={rule.text}
        onChange={(text) => { onChange({ ...rule, text }) }}
        ariaLabel={t('rule.field.text')}
        placeholder={t('rule.field.textPlaceholder')}
        rows={rows}
        maxRows={24}
        invalid={invalid}
        disabled={disabled}
      />
      <Checkbox
        checked={rule.interpolate === true}
        onChange={(interpolate) => { onChange({ ...rule, interpolate }) }}
        label={t('rule.field.interpolate')}
        disabled={disabled}
      />
    </>
  )
}

/**
 * Render the fields one rule kind owns.
 * @param props - the rule, its change callback, and localized copy.
 * @returns the field set.
 */
export function RuleFields({ rule, onChange, disabled, sectionNames, t }: RuleFieldsProps) {
  const blocker = ruleBlocker(rule)
  const message = blocker === undefined ? undefined : t(blocker.key, blocker.params)

  if (rule.kind === 'prepend' || rule.kind === 'append' || rule.kind === 'replace') {
    return (
      <div className={css.fields}>
        <RuleText
          rule={rule}
          onChange={onChange}
          rows={rule.kind === 'replace' ? 6 : 3}
          invalid={message !== undefined}
          disabled={disabled}
          t={t}
        />
        {message !== undefined && <p className={css.error} role="alert">{message}</p>}
      </div>
    )
  }

  if (rule.kind === 'insert') {
    return (
      <div className={css.fields}>
        <label className={css.label}>
          {t('rule.field.after')}
          <Input
            value={rule.after}
            placeholder={t('rule.field.afterPlaceholder')}
            aria-label={t('rule.field.after')}
            aria-invalid={message !== undefined && rule.after.trim() === ''}
            className={clsx(message !== undefined && rule.after.trim() === '' && css.invalid)}
            disabled={disabled}
            onChange={(event) => { onChange({ ...rule, after: event.target.value.trim() }) }}
          />
        </label>
        <SectionPicker
          names={sectionNames}
          chosen={[rule.after]}
          label={t('rule.field.after')}
          disabled={disabled}
          onPick={(after) => { onChange({ ...rule, after }) }}
        />
        <RuleText
          rule={rule}
          onChange={onChange}
          rows={3}
          invalid={message !== undefined && rule.after.trim() !== ''}
          disabled={disabled}
          t={t}
        />
        {message !== undefined && <p className={css.error} role="alert">{message}</p>}
      </div>
    )
  }

  if (rule.kind === 'remove') {
    return (
      <div className={css.fields}>
        <label className={css.label}>
          {t('rule.field.sections')}
          <Input
            value={rule.sections.join(', ')}
            placeholder={t('rule.field.sectionsPlaceholder')}
            aria-label={t('rule.field.sections')}
            aria-invalid={message !== undefined}
            className={clsx(message !== undefined && css.invalid)}
            disabled={disabled}
            onChange={(event) => { onChange({ ...rule, sections: parseSections(event.target.value) }) }}
          />
        </label>
        <SectionPicker
          names={sectionNames}
          chosen={rule.sections}
          label={t('rule.field.sections')}
          disabled={disabled}
          onPick={(name) => { onChange({ ...rule, sections: toggleSection(rule.sections, name) }) }}
        />
        {message !== undefined && <p className={css.error} role="alert">{message}</p>}
      </div>
    )
  }

  return (
    <div className={css.fields}>
      <div className={css.row}>
        <label className={css.label}>
          {t('rule.field.pattern')}
          <Input
            value={rule.pattern}
            placeholder={t('rule.field.patternPlaceholder')}
            aria-label={t('rule.field.pattern')}
            aria-invalid={message !== undefined}
            className={clsx(message !== undefined && css.invalid)}
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => { onChange({ ...rule, pattern: event.target.value }) }}
          />
        </label>
        <label className={css.flags}>
          {t('rule.field.flags')}
          <Input
            value={rule.flags ?? ''}
            aria-label={t('rule.field.flags')}
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => { onChange({ ...rule, flags: event.target.value }) }}
          />
        </label>
      </div>
      <TextArea
        value={rule.replacement}
        onChange={(replacement) => { onChange({ ...rule, replacement }) }}
        ariaLabel={t('rule.field.replacement')}
        placeholder={t('rule.field.replacementPlaceholder')}
        rows={2}
        maxRows={8}
        monospace
        disabled={disabled}
      />
      <label className={css.label}>
        {t('rule.field.sections')}
        <Input
          value={(rule.sections ?? []).join(', ')}
          placeholder={t('rule.field.sectionsAll')}
          aria-label={t('rule.field.sections')}
          disabled={disabled}
          onChange={(event) => { onChange({ ...rule, sections: parseSections(event.target.value) }) }}
        />
      </label>
      <SectionPicker
        names={sectionNames}
        chosen={rule.sections ?? []}
        label={t('rule.field.sections')}
        disabled={disabled}
        onPick={(name) => { onChange({ ...rule, sections: toggleSection(rule.sections ?? [], name) }) }}
      />
      {message !== undefined && <p className={css.error} role="alert">{message}</p>}
    </div>
  )
}
