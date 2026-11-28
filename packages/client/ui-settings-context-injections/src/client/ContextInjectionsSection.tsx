/**
 * The context injections settings page: one row per injection, grouped into
 * notices and runtime context. A row's switch decides whether the injection is
 * sent; its replacement text stays folded until opened, and opens by itself
 * while the row carries one.
 */

import { useState } from 'react'
import { SettingsForm, SettingsSwitchField, SettingsTextAreaField } from '@deepseek-ai/dsh-client-ui-primitives/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots/client'
import { enabledField, type ContextInjectionsFace, type ContextInjectionsRowState } from './controller.ts'
import { formLabels, type ContextInjectionsLocaleKey } from './locales.ts'
import { PAGE_ROWS, type ContextInjectionsPageRow } from './rows.ts'
import css from './ContextInjectionsSection.module.css'

/** Props the renderer binds for the page. */
export type ContextInjectionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.contextInjections'>
  & InjectFace<ContextInjectionsFace>

/** What one row needs from the page. */
interface RowProps {
  row: ContextInjectionsRowState
  disabled: boolean
  t: (key: ContextInjectionsLocaleKey) => string
  edit: ContextInjectionsFace['edit']
  resetField: ContextInjectionsFace['resetField']
}

/** Render one injection's switch and its folded templates. */
function InjectionRow({ row, disabled, t, edit, resetField }: RowProps) {
  const [opened, setOpened] = useState(false)
  const overridden = row.variants.some(variant => variant.text.overridden)
  const expanded = opened || overridden
  const enabledId = `context-injections-${row.id}-enabled`
  const textsId = `context-injections-${row.id}-text`
  const label = t(`row.${row.id}`)
  const hint = t(`row.${row.id}.hint`)
  const fieldCopy = { overriddenLabel: t('overridden'), resetLabel: t('reset'), disabled }
  return (
    <div className={css.row} data-row={row.id}>
      {row.enabled === undefined
        ? (
          <div className={css.fixed}>
            <span className={css.fixedLabel}>{label}</span>
            <p className={css.fixedHint}>{hint} {t('alwaysStated')}</p>
          </div>
        )
        : (
          <SettingsSwitchField
            {...fieldCopy}
            id={enabledId}
            label={label}
            hint={hint}
            text={row.enabled.text}
            overridden={row.enabled.overridden}
            onEdit={(text) => { edit(enabledField(row.id), text) }}
            onReset={() => { resetField(enabledField(row.id)) }}
          />
        )}
      {expanded
        ? (
          <div className={css.text} id={textsId}>
            {row.variants.map((variant) => {
              const { label, variables } = variant.shape
              return (
                <SettingsTextAreaField
                  {...fieldCopy}
                  key={variant.field}
                  id={`context-injections-${variant.field}`}
                  label={label === undefined ? t('textLabel') : t(`variant.${label}`)}
                  hint={variablesHint(t, variables)}
                  placeholder={t('textPlaceholder')}
                  invalidLabel={t('invalid')}
                  rows={templateRows(variant.text.text)}
                  text={variant.text.text}
                  overridden={variant.text.overridden}
                  invalid={variant.text.invalid}
                  onEdit={(text) => { edit(variant.field, text) }}
                  onReset={() => { resetField(variant.field) }}
                />
              )
            })}
          </div>
        )
        : null}
      {overridden
        ? null
        : (
          <button
            type="button"
            className={css.disclosure}
            aria-expanded={expanded}
            aria-controls={expanded ? textsId : undefined}
            onClick={() => { setOpened(!opened) }}
          >
            {expanded ? t('hideText') : t('editText')}
          </button>
        )}
    </div>
  )
}

/**
 * The hint under one template: the variables it can use, then how the box behaves.
 * @param t - the page's translator.
 * @param variables - the shape's variable names, without `text`.
 * @returns the hint text.
 */
function variablesHint(t: (key: ContextInjectionsLocaleKey) => string, variables: readonly string[]): string {
  const names = [...variables, 'text'].map(name => `{{${name}}}`).join(' ')
  return `${t('variablesLabel')} ${names}. ${t('textHint')}`
}

/**
 * Rows a template box opens with: enough for the template, at most twelve.
 * @param text - the template.
 * @returns the textarea row count.
 */
function templateRows(text: string): number {
  return Math.min(12, Math.max(3, text.split('\n').length + 1))
}

/** Render one group's heading and rows. */
function InjectionGroup(props: {
  group: ContextInjectionsPageRow['group']
  rows: readonly ContextInjectionsRowState[]
  disabled: boolean
  t: (key: ContextInjectionsLocaleKey) => string
  edit: ContextInjectionsFace['edit']
  resetField: ContextInjectionsFace['resetField']
}) {
  const { group, t } = props
  const members = new Set(PAGE_ROWS.filter(row => row.group === group).map(row => row.id))
  return (
    <section className={css.group} aria-labelledby={`context-injections-${group}`}>
      <h3 id={`context-injections-${group}`} className={css.groupHeading}>
        {t(group === 'notice' ? 'noticesHeading' : 'contextHeading')}
      </h3>
      <p className={css.groupIntro}>{t(group === 'notice' ? 'noticesIntro' : 'contextIntro')}</p>
      {props.rows.filter(row => members.has(row.id)).map(row => (
        <InjectionRow key={row.id} row={row} disabled={props.disabled} t={t} edit={props.edit} resetField={props.resetField} />
      ))}
    </section>
  )
}

/**
 * Render the context injections page.
 * @param props - locale copy, the form snapshot, and its actions.
 * @returns the page.
 */
export function ContextInjectionsSection(props: ContextInjectionsSectionProps) {
  const { t } = props
  const state = props.useContextInjections(snapshot => snapshot)
  const shared = { rows: state.rows, disabled: !state.writable || state.saving, t, edit: props.edit, resetField: props.resetField }
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        <InjectionGroup group="notice" {...shared} />
        <InjectionGroup group="context" {...shared} />
      </SettingsForm>
    </div>
  )
}
