/**
 * One rule in the stack: its position, its on/off state, and its own fields.
 *
 * Reordering is explicit buttons rather than dragging: there is no shared
 * drag affordance to reuse, and a keyboard reaches these directly.
 */

import { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconTrashOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PromptRule } from '@deepseek-ai/dsh-prompt-presets/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ruleBlocker } from './preset-model.ts'
import type { Blocker, DraftRule } from './preset-model.ts'
import { RuleFields } from './RuleFields.tsx'
import css from './RuleCard.module.css'

/** Everything one rule card renders and reports. */
export interface RuleCardProps {
  /** The rule and its stable editor key. */
  entry: DraftRule
  /** Its position in the stack, from one. */
  position: number
  /** How many rules the stack holds, so the ends disable their move button. */
  total: number
  /** Whether an earlier enabled `replace` leaves this rule nothing to act on. */
  shadowed: boolean
  /**
   * A complaint the stack as a whole makes about this rule, which its own
   * fields cannot see — a second enabled `replace` is only wrong in context.
   */
  stackBlocker?: Blocker | undefined
  /** Whether a save is in flight. */
  disabled: boolean
  /** Section names the current preview offers. */
  sectionNames: readonly string[]
  /** Replace this rule's own fields. */
  onChange: (rule: PromptRule) => void
  /** Turn the rule on or off without deleting it. */
  onToggle: (enabled: boolean) => void
  /** Move the rule one position earlier or later. */
  onMove: (direction: -1 | 1) => void
  /** Delete the rule. */
  onDelete: () => void
  /** Localized copy. */
  t: TranslateNS<'settings.promptPreset'>
}

/**
 * Render one rule of the stack.
 * @param props - the rule, its position, its callbacks, and localized copy.
 * @returns the card.
 */
export function RuleCard({
  entry, position, total, shadowed, disabled, sectionNames, stackBlocker,
  onChange, onToggle, onMove, onDelete, t,
}: RuleCardProps) {
  const enabled = entry.rule.enabled !== false
  const invalid = enabled && (ruleBlocker(entry.rule) !== undefined || stackBlocker !== undefined)
  const kindName = t(`rule.${entry.rule.kind}.name`)

  return (
    <li className={css.card} aria-label={`${String(position)}. ${kindName}`}>
      <div className={css.head}>
        <span className={css.order}>
          <Button
            size="sm"
            icon={<IconChevronUpOutlineRegular />}
            aria-label={t('rule.moveUp', { position: String(position), total: String(total) })}
            disabled={disabled || position === 1}
            onClick={() => { onMove(-1) }}
          />
          <Button
            size="sm"
            icon={<IconChevronDownOutlineRegular />}
            aria-label={t('rule.moveDown', { position: String(position), total: String(total) })}
            disabled={disabled || position === total}
            onClick={() => { onMove(1) }}
          />
        </span>
        <span className={css.title}>
          <span className={css.kind}>{kindName}</span>
          <span className={css.hint}>{t(`rule.${entry.rule.kind}.hint`)}</span>
        </span>
        {invalid && (
          <Tag tone="danger">
            <IconWarningOutlineRegular size={12} />
            {t('rule.badge.invalid')}
          </Tag>
        )}
        {!enabled && <Tag>{t('rule.badge.disabled')}</Tag>}
        {enabled && shadowed && <Tag>{t('rule.badge.shadowed')}</Tag>}
        <Switch
          checked={enabled}
          onChange={onToggle}
          label={t('rule.enabled')}
          disabled={disabled}
          className={css.toggle}
        />
        <Button
          size="sm"
          icon={<IconTrashOutlineRegular />}
          aria-label={t('rule.delete')}
          disabled={disabled}
          onClick={onDelete}
        />
      </div>
      <RuleFields
        rule={entry.rule}
        onChange={onChange}
        disabled={disabled || !enabled}
        sectionNames={sectionNames}
        t={t}
      />
      {stackBlocker !== undefined && (
        <p className={css.error} role="alert">{t(stackBlocker.key, stackBlocker.params)}</p>
      )}
    </li>
  )
}
