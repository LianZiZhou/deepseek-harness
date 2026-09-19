/**
 * The per-kind field sets of one rule.
 *
 * Every rule kind edits different things, so the card delegates its body here
 * and keeps its own chrome — order, on/off, delete — identical across kinds.
 */

import { Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
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
  /** The section names this preview offers, for the section fields' help text. */
  sectionNames: readonly string[]
  /** Localized copy. */
  t: TranslateNS<'settings.promptPreset'>
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
        <TextArea
          value={rule.text}
          onChange={(text) => { onChange({ ...rule, text }) }}
          ariaLabel={t('rule.field.text')}
          placeholder={t('rule.field.textPlaceholder')}
          rows={rule.kind === 'replace' ? 6 : 3}
          maxRows={24}
          invalid={message !== undefined}
          disabled={disabled}
        />
        <Checkbox
          checked={rule.interpolate === true}
          onChange={(interpolate) => { onChange({ ...rule, interpolate }) }}
          label={t('rule.field.interpolate')}
          disabled={disabled}
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
            disabled={disabled}
            onChange={(event) => { onChange({ ...rule, after: event.target.value.trim() }) }}
          />
        </label>
        <p className={css.hint}>{sectionNames.join(', ')}</p>
        <TextArea
          value={rule.text}
          onChange={(text) => { onChange({ ...rule, text }) }}
          ariaLabel={t('rule.field.text')}
          placeholder={t('rule.field.textPlaceholder')}
          rows={3}
          maxRows={24}
          invalid={message !== undefined && rule.after.trim() !== ''}
          disabled={disabled}
        />
        <Checkbox
          checked={rule.interpolate === true}
          onChange={(interpolate) => { onChange({ ...rule, interpolate }) }}
          label={t('rule.field.interpolate')}
          disabled={disabled}
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
            disabled={disabled}
            onChange={(event) => { onChange({ ...rule, sections: parseSections(event.target.value) }) }}
          />
        </label>
        <p className={css.hint}>{sectionNames.join(', ')}</p>
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
      {message !== undefined && <p className={css.error} role="alert">{message}</p>}
    </div>
  )
}
