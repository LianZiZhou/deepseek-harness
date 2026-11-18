/**
 * Switch off or rewrite the context the harness injects into a model request:
 * notices and reminders that producers add as user messages, and the named
 * sections of the runtime-context snapshot. Every setting is volatile, so a
 * change from the settings page applies to the next step without a remount.
 *
 * The listeners sit on the loop's admission events, which run after every
 * `agent/pre-step` listener and before anything is committed, so what the
 * model receives is exactly what the session log records.
 *
 * @module @deepseek-ai/dsh-context-injections
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the agent admission events' merges.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: the optional settings service's Context merge.
import type {} from '@deepseek-ai/dsh-settings'
import { readSettings } from './settings.ts'
import { admitMessages, admitSections } from './transform.ts'

export type { ContextInjectionRow, ContextInjectionRowId } from './rows.ts'
export type { InjectionSetting } from './transform.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'context-injections'

/**
 * Which injections reach the model and in what words. Each `…Enabled` field
 * switches one injection; each `…Text` field replaces its text, where
 * `{{text}}` stands for the original and an empty value keeps it. Every field
 * is volatile.
 */
export interface Config {
  /** Send the notice that the session's model changed. */
  modelSwitchEnabled: Volatile<boolean>
  /** Replacement for the model-change notice. */
  modelSwitchText: Volatile<string>
  /** Send the current-time reading. */
  timeContextEnabled: Volatile<boolean>
  /** Replacement for the current-time reading. */
  timeContextText: Volatile<string>
  /** Send the notice that the approval policy changed. */
  approvalNoticeEnabled: Volatile<boolean>
  /** Replacement for the approval-policy change notice. */
  approvalNoticeText: Volatile<string>
  /** Send the notice that the working directory changed. */
  workingDirectoryNoticeEnabled: Volatile<boolean>
  /** Replacement for the working-directory change notice. */
  workingDirectoryNoticeText: Volatile<string>
  /** Send the notice that the session entered or left plan mode. */
  planModeNoticeEnabled: Volatile<boolean>
  /** Replacement for the plan-mode notice. */
  planModeNoticeText: Volatile<string>
  /** Send the reminder about a repeated tool call. */
  repeatToolReminderEnabled: Volatile<boolean>
  /** Replacement for the repeated-tool-call reminder. */
  repeatToolReminderText: Volatile<string>
  /** Send the project instructions read from instruction files such as `AGENTS.md`. */
  agentInstructionsEnabled: Volatile<boolean>
  /** Replacement for the project instructions. */
  agentInstructionsText: Volatile<string>
  /** Send the catalog of available skills. */
  skillCatalogEnabled: Volatile<boolean>
  /** Replacement for the skill catalog. */
  skillCatalogText: Volatile<string>
  /** Send the tmux pane snapshot. */
  tmuxContextEnabled: Volatile<boolean>
  /** Replacement for the tmux pane snapshot. */
  tmuxContextText: Volatile<string>
  /** Replacement for the current working directory section, which is always stated. */
  workingDirectoryText: Volatile<string>
  /** State the file-access policy section, including `danger-full-access`. */
  sandboxPolicyEnabled: Volatile<boolean>
  /** Replacement for the file-access policy section. */
  sandboxPolicyText: Volatile<string>
  /** State the approval policy section. */
  approvalPolicyEnabled: Volatile<boolean>
  /** Replacement for the approval policy section. */
  approvalPolicyText: Volatile<string>
  /** State the subagent delegation section. */
  subagentDelegationEnabled: Volatile<boolean>
  /** Replacement for the subagent delegation section. */
  subagentDelegationText: Volatile<string>
  /** State the harness source-checkout section. */
  harnessSourceEnabled: Volatile<boolean>
  /** Replacement for the harness source-checkout section. */
  harnessSourceText: Volatile<string>
  /** State the Web surface section. */
  webSurfaceEnabled: Volatile<boolean>
  /** Replacement for the Web surface section. */
  webSurfaceText: Volatile<string>
}

/** Runtime schema for {@link Config}; every injection is sent unchanged by default. */
export const Config = z.object({
  modelSwitchEnabled: z.boolean().default(true).volatile(),
  modelSwitchText: z.string().default('').volatile(),
  timeContextEnabled: z.boolean().default(true).volatile(),
  timeContextText: z.string().default('').volatile(),
  approvalNoticeEnabled: z.boolean().default(true).volatile(),
  approvalNoticeText: z.string().default('').volatile(),
  workingDirectoryNoticeEnabled: z.boolean().default(true).volatile(),
  workingDirectoryNoticeText: z.string().default('').volatile(),
  planModeNoticeEnabled: z.boolean().default(true).volatile(),
  planModeNoticeText: z.string().default('').volatile(),
  repeatToolReminderEnabled: z.boolean().default(true).volatile(),
  repeatToolReminderText: z.string().default('').volatile(),
  agentInstructionsEnabled: z.boolean().default(true).volatile(),
  agentInstructionsText: z.string().default('').volatile(),
  skillCatalogEnabled: z.boolean().default(true).volatile(),
  skillCatalogText: z.string().default('').volatile(),
  tmuxContextEnabled: z.boolean().default(true).volatile(),
  tmuxContextText: z.string().default('').volatile(),
  workingDirectoryText: z.string().default('').volatile(),
  sandboxPolicyEnabled: z.boolean().default(true).volatile(),
  sandboxPolicyText: z.string().default('').volatile(),
  approvalPolicyEnabled: z.boolean().default(true).volatile(),
  approvalPolicyText: z.string().default('').volatile(),
  subagentDelegationEnabled: z.boolean().default(true).volatile(),
  subagentDelegationText: z.string().default('').volatile(),
  harnessSourceEnabled: z.boolean().default(true).volatile(),
  harnessSourceText: z.string().default('').volatile(),
  webSurfaceEnabled: z.boolean().default(true).volatile(),
  webSurfaceText: z.string().default('').volatile(),
})

/**
 * Register the admission listeners for the lifetime of `ctx`. Settings are
 * read on every admission, so an edit applies from the next step.
 * @param ctx - plugin context; the listeners are disposed with it.
 * @param config - the resolved entry config.
 */
export function apply(ctx: Context, config: Config): void {
  // The settings page renders its own form, so the generic page must not also
  // generate a raw one for these fields.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('agent/admit-messages', async (_payload, next) => admitMessages(await next(), readSettings(config).messages))
  ctx.on('agent/admit-context', async (_payload, next) => admitSections(await next(), readSettings(config).sections))
}
