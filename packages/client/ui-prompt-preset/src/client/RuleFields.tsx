/**
 * The per-kind field sets of one rule.
 *
 * Every rule kind edits different things, so the card delegates its body here
 * and keeps its own chrome — order, on/off, delete — identical across kinds.
 */

import clsx from 'clsx'
import { Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives/client'
import type { PromptRule } from '@deepseek-ai/dsh-prompt-presets/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots/client'
import type { Blocker } from './preset-model.ts'
import { SectionPicker } from './SectionPicker.tsx'
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
  /** Names available at this rule in the preview. */
  sectionNames: readonly string[]
  /** Names the deployment protects from removal and rewriting. */
  protectedSections: readonly string[]
  /** First field or stack complaint for this rule. */
  blocker: Blocker | undefined
  /** Localized copy. */
  t: TranslateNS<'settings.promptPreset'>
}

/** The rule kinds that carry text and may interpolate variables into it. */
type TextRule = Extract<PromptRule, { kind: 'prepend' | 'append' | 'replace' | 'insert' | 'rewrite' }>

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
export function RuleFields({ rule, onChange, disabled, sectionNames, protectedSections, blocker, t }: RuleFieldsProps) {
  const picker = { names: sectionNames, disabled, t }
  if (rule.kind === 'prepend' || rule.kind === 'append' || rule.kind === 'replace') {
    const invalidId = blocker?.key === 'rule.error.duplicateSection' || blocker?.key === 'rule.error.sectionIdInvalid'
    return (
      <div className={css.fields}>
        {rule.kind !== 'replace' && (
          <label className={css.label}>
            {t('rule.field.sectionId')}
            <Input
              value={rule.sectionId ?? ''}
              placeholder={t('rule.field.autoId')}
              aria-invalid={invalidId}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => {
                const { sectionId: _previous, ...rest } = rule
                const sectionId = event.target.value
                onChange(sectionId === '' ? rest : { ...rest, sectionId })
              }}
            />
          </label>
        )}
        <RuleText
          rule={rule}
          onChange={onChange}
          rows={rule.kind === 'replace' ? 6 : 3}
          invalid={blocker?.key === 'rule.error.textRequired'}
          disabled={disabled}
          t={t}
        />
      </div>
    )
  }

  if (rule.kind === 'insert' || rule.kind === 'rewrite') {
    const insert = rule.kind === 'insert'
    const value = insert ? rule.after : rule.section
    return (
      <div className={css.fields}>
        <SectionPicker
          {...picker}
          multiple={false}
          selected={value === '' ? [] : [value]}
          label={t(insert ? 'rule.field.after' : 'rule.field.section')}
          invalid={blocker !== undefined && blocker.key !== 'rule.error.textRequired'}
          {...insert ? {} : { protectedSections }}
          onChange={([section = '']) => {
            onChange(insert ? { ...rule, after: section } : { ...rule, section })
          }}
        />
        <RuleText
          rule={rule}
          onChange={onChange}
          rows={3}
          invalid={blocker?.key === 'rule.error.textRequired'}
          disabled={disabled}
          t={t}
        />
      </div>
    )
  }

  if (rule.kind === 'remove') {
    return (
      <SectionPicker
        {...picker}
        multiple
        selected={rule.sections}
        label={t('rule.field.sections')}
        protectedSections={protectedSections}
        invalid={blocker !== undefined}
        onChange={(sections) => { onChange({ ...rule, sections }) }}
      />
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
            aria-invalid={blocker !== undefined}
            className={clsx(blocker !== undefined && css.invalid)}
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
      <SectionPicker
        {...picker}
        multiple
        selected={rule.sections ?? []}
        label={t('rule.field.sections')}
        emptySelectionLabel={t('rule.field.sectionsAll')}
        onChange={(sections) => { onChange({ ...rule, sections }) }}
      />
    </div>
  )
}
