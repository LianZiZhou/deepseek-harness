/** The page's staged form over the `context-injections` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsBooleanField, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { PAGE_ROWS, type ContextInjectionsRowId } from './rows.ts'

/** The namespace section as the page reads it: `<id>Enabled` booleans and `<id>Text` strings. */
export type ContextInjectionsSettings = Readonly<Record<string, boolean | string>>

/** One row as the page renders it. */
export interface ContextInjectionsRowState {
  /** Row id. */
  id: ContextInjectionsRowId
  /** The switch, absent for a section that is always stated. */
  enabled?: SettingsFieldState
  /** The replacement text. */
  text: SettingsFieldState
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
 * Config field holding a row's replacement text.
 * @param id - the row id.
 * @returns `<id>Text`.
 */
export function textField(id: ContextInjectionsRowId): string {
  return `${id}Text`
}

/** Bridges the `context-injections` scope onto the page's staged form. */
export class ContextInjectionsController {
  private readonly form: SettingsFormModel<ContextInjectionsSettings>
  private readonly store: SnapshotStore<ContextInjectionsState>

  /** @param scope - the bound settings scope for the `context-injections` namespace. */
  constructor(scope: SettingsFormScope<ContextInjectionsSettings>) {
    this.form = new SettingsFormModel(scope, PAGE_ROWS.flatMap(row => [
      ...row.switchable ? [settingsBooleanField(enabledField(row.id))] : [],
      settingsTextField(textField(row.id)),
    ]))
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ContextInjectionsState {
    return {
      ...this.form.shell(),
      rows: PAGE_ROWS.map(row => ({
        id: row.id,
        ...row.switchable ? { enabled: this.form.field(enabledField(row.id)) } : {},
        text: this.form.field(textField(row.id)),
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
