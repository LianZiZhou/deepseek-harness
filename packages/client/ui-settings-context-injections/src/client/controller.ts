/** The page's staged form over the `context-injections` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsBooleanField, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives/client'
import { PAGE_ROWS, type ContextInjectionsPageVariant, type ContextInjectionsRowId } from './rows.ts'

/** One editable shape of a row's text. */
export interface ContextInjectionsVariantState {
  /** The shape as the page lists it: its id, label key, and variables. */
  shape: ContextInjectionsPageVariant
  /** Field the template is stored under. */
  field: string
  /** The template, prefilled with the shipped one. */
  text: SettingsFieldState
}

/** The namespace section as the page reads it: `<id>Enabled` booleans and `<id>Text` strings. */
export type ContextInjectionsSettings = Readonly<Record<string, boolean | string>>

/** One row as the page renders it. */
export interface ContextInjectionsRowState {
  /** Row id. */
  id: ContextInjectionsRowId
  /** The switch, absent for a section that is always stated. */
  enabled?: SettingsFieldState
  /** Each shape's template. */
  variants: ContextInjectionsVariantState[]
}

/** What the page renders. */
export interface ContextInjectionsState extends SettingsFormShell {
  /** Every row, in page order. */
  rows: ContextInjectionsRowState[]
}

/** The registration-side face the page's slot entry injects. */
export interface ContextInjectionsFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useContextInjections. */
    contextInjections: SnapshotStore<ContextInjectionsState>
  }
}

/**
 * Config field holding whether a row's injection is sent.
 * @param id - the row id.
 * @returns `<id>Enabled`.
 */
export function enabledField(id: ContextInjectionsRowId): string {
  return `${id}Enabled`
}

/**
 * Config field holding one shape's template.
 * @param id - the row id.
 * @param variant - the variant id; empty for a row's only shape.
 * @returns `<id>Text`, or `<id><Variant>Text` for a named shape.
 */
export function textField(id: ContextInjectionsRowId, variant = ''): string {
  return variant === '' ? `${id}Text` : `${id}${variant.charAt(0).toUpperCase()}${variant.slice(1)}Text`
}

/** Bridges the `context-injections` scope onto the page's staged form. */
export class ContextInjectionsController {
  private readonly form: SettingsFormModel<ContextInjectionsSettings>
  private readonly store: SnapshotStore<ContextInjectionsState>

  /** @param scope - the bound settings scope for the `context-injections` namespace. */
  constructor(scope: SettingsFormScope<ContextInjectionsSettings>) {
    this.form = new SettingsFormModel(scope, PAGE_ROWS.flatMap(row => [
      ...row.switchable ? [settingsBooleanField(enabledField(row.id))] : [],
      ...row.variants.map(variant => settingsTextField(textField(row.id, variant.id))),
    ]))
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ContextInjectionsState {
    return {
      ...this.form.shell(),
      rows: PAGE_ROWS.map(row => ({
        id: row.id,
        ...row.switchable ? { enabled: this.form.field(enabledField(row.id)) } : {},
        variants: row.variants.map((shape) => {
          const field = textField(row.id, shape.id)
          return { shape, field, text: this.form.field(field) }
        }),
      })),
    }
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): ContextInjectionsFace {
    return { hooks: { contextInjections: this.store }, ...this.form.actions() }
  }

  /** Release accepted-value subscriptions. */
  dispose(): void { this.form.dispose() }
}
