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
import { shippedTemplate } from './rows.ts'
import { readSettings } from './settings.ts'
import { admitMessages, admitSections } from './transform.ts'

export type { ContextInjectionRow, ContextInjectionRowId, ContextInjectionVariant } from './rows.ts'
export type { InjectionSetting, InjectionVariantSetting } from './transform.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'context-injections'

/**
 * Which injections reach the model and in what words. Each `…Enabled` field
 * switches one injection. Each `…Text` field is the template for one shape of
 * an injection's text: it defaults to the producer's own wording, with every
 * runtime value as a `{{variable}}`, and `{{text}}` stands for the whole
 * original. An empty template sends the original. Every field is volatile.
 */
export interface Config {
  /** Send the notice that the session's model changed. */
  modelSwitchEnabled: Volatile<boolean>
  /** Template for the model-switch notice; `{{from}}` and `{{to}}` are the two models. */
  modelSwitchText: Volatile<string>
  /** Send the current-time reading. */
  timeContextEnabled: Volatile<boolean>
  /** Template for the time reading when the browser time zone is known; `{{zone}}` is that zone. */
  timeContextKnownText: Volatile<string>
  /** Template for the time reading when the browser time zone is mixed or unavailable; `{{zone}}` says which. */
  timeContextUnclearText: Volatile<string>
  /** Send the notice that the approval policy changed. */
  approvalNoticeEnabled: Volatile<boolean>
  /** Template for the approval-policy change notice; `{{from}}` and `{{to}}` are the two policies. */
  approvalNoticeText: Volatile<string>
  /** Send the notice that the working directory changed. */
  workingDirectoryNoticeEnabled: Volatile<boolean>
  /** Template for a working-directory change; `{{from}}` and `{{to}}` are JSON-quoted paths. */
  workingDirectoryNoticeChangedText: Volatile<string>
  /** Template for a working directory that became unavailable; `{{from}}` and `{{to}}` are JSON-quoted paths. */
  workingDirectoryNoticeUnavailableText: Volatile<string>
  /** Send the notice that the session entered or left plan mode. */
  planModeNoticeEnabled: Volatile<boolean>
  /** Template for the notice that the session entered plan mode. */
  planModeNoticeEnteredText: Volatile<string>
  /** Template for the notice that the session left plan mode. */
  planModeNoticeLeftText: Volatile<string>
  /** Send the reminder about a repeated tool call. */
  repeatToolReminderEnabled: Volatile<boolean>
  /** Template for the first repeated-call reminder. */
  repeatToolReminderFirstText: Volatile<string>
  /** Template for later repeated-call reminders; `{{tool}}`, `{{count}}`, and `{{arguments}}` describe the call. */
  repeatToolReminderRepeatedText: Volatile<string>
  /** Send the project instructions read from instruction files such as `AGENTS.md`. */
  agentInstructionsEnabled: Volatile<boolean>
  /** Template for loaded instructions; `{{instructions}}` is every file's heading and content. */
  agentInstructionsLoadedText: Volatile<string>
  /** Template for instructions trimmed to the byte budget; `{{budget}}` states what was omitted or cut. */
  agentInstructionsTrimmedText: Volatile<string>
  /** Template for instructions that replace an earlier set; `{{instructions}}` is every file's heading and content. */
  agentInstructionsReplacedText: Volatile<string>
  /** Template for the notice that no instructions remain active. */
  agentInstructionsClearedText: Volatile<string>
  /** Template for instruction files added, changed, or removed; `{{changes}}` lists them with their content. */
  agentInstructionsUpdatedText: Volatile<string>
  /** Send the catalog of available skills. */
  skillCatalogEnabled: Volatile<boolean>
  /** Template for the first skill catalog; `{{skills}}` is one line per skill. */
  skillCatalogCatalogText: Volatile<string>
  /** Template for the first skill catalog after incomplete discovery; `{{skills}}` is one line per confirmed skill. */
  skillCatalogCatalogPartialText: Volatile<string>
  /** Template for a changed skill catalog; `{{skills}}` is one line per skill. */
  skillCatalogChangedText: Volatile<string>
  /** Template for a changed skill catalog after incomplete discovery; `{{skills}}` is one line per confirmed skill. */
  skillCatalogChangedPartialText: Volatile<string>
  /** Send the tmux pane snapshot. */
  tmuxContextEnabled: Volatile<boolean>
  /** Template for the tmux location reading; its variables are the tmux session, window, and pane fields. */
  tmuxContextText: Volatile<string>
  /** Template for the working-directory section, which is always stated; `{{cwd}}` is the JSON-quoted path. */
  workingDirectoryText: Volatile<string>
  /** State the file-access policy section, including `danger-full-access`. */
  sandboxPolicyEnabled: Volatile<boolean>
  /** Template for the read-only file policy. */
  sandboxPolicyReadOnlyText: Volatile<string>
  /** Template for the workspace-write file policy; `{{workspace}}` is the JSON-quoted workspace. */
  sandboxPolicyWorkspaceWriteText: Volatile<string>
  /** Template for the workspace-write file policy with extra writable directories; `{{directories}}` is their JSON list. */
  sandboxPolicyWorkspaceWriteRootsText: Volatile<string>
  /** Template for the danger-full-access file policy. */
  sandboxPolicyFullAccessText: Volatile<string>
  /** State the approval policy section. */
  approvalPolicyEnabled: Volatile<boolean>
  /** Template for the policy that approval prompts may ask. */
  approvalPolicyAskText: Volatile<string>
  /** Template for the policy that approval prompts are disabled. */
  approvalPolicyNeverText: Volatile<string>
  /** State the subagent delegation section. */
  subagentDelegationEnabled: Volatile<boolean>
  /** Template for the subagent delegation section. */
  subagentDelegationText: Volatile<string>
  /** State the harness source-checkout section. */
  harnessSourceEnabled: Volatile<boolean>
  /** Template for the harness source-checkout section; `{{checkout}}` is the JSON-quoted path. */
  harnessSourceText: Volatile<string>
  /** State the Web surface section. */
  webSurfaceEnabled: Volatile<boolean>
  /** Template for the Web surface section; `{{url}}` is the JSON-quoted address. */
  webSurfaceText: Volatile<string>
}

/** Runtime schema for {@link Config}; every injection is sent in its producer's wording by default. */
export const Config = z.object({
  modelSwitchEnabled: z.boolean().default(true).volatile(),
  modelSwitchText: z.string().default(shippedTemplate('modelSwitch')).volatile(),
  timeContextEnabled: z.boolean().default(true).volatile(),
  timeContextKnownText: z.string().default(shippedTemplate('timeContext', 'known')).volatile(),
  timeContextUnclearText: z.string().default(shippedTemplate('timeContext', 'unclear')).volatile(),
  approvalNoticeEnabled: z.boolean().default(true).volatile(),
  approvalNoticeText: z.string().default(shippedTemplate('approvalNotice')).volatile(),
  workingDirectoryNoticeEnabled: z.boolean().default(true).volatile(),
  workingDirectoryNoticeChangedText: z.string().default(shippedTemplate('workingDirectoryNotice', 'changed')).volatile(),
  workingDirectoryNoticeUnavailableText: z.string().default(shippedTemplate('workingDirectoryNotice', 'unavailable')).volatile(),
  planModeNoticeEnabled: z.boolean().default(true).volatile(),
  planModeNoticeEnteredText: z.string().default(shippedTemplate('planModeNotice', 'entered')).volatile(),
  planModeNoticeLeftText: z.string().default(shippedTemplate('planModeNotice', 'left')).volatile(),
  repeatToolReminderEnabled: z.boolean().default(true).volatile(),
  repeatToolReminderFirstText: z.string().default(shippedTemplate('repeatToolReminder', 'first')).volatile(),
  repeatToolReminderRepeatedText: z.string().default(shippedTemplate('repeatToolReminder', 'repeated')).volatile(),
  agentInstructionsEnabled: z.boolean().default(true).volatile(),
  agentInstructionsLoadedText: z.string().default(shippedTemplate('agentInstructions', 'loaded')).volatile(),
  agentInstructionsTrimmedText: z.string().default(shippedTemplate('agentInstructions', 'trimmed')).volatile(),
  agentInstructionsReplacedText: z.string().default(shippedTemplate('agentInstructions', 'replaced')).volatile(),
  agentInstructionsClearedText: z.string().default(shippedTemplate('agentInstructions', 'cleared')).volatile(),
  agentInstructionsUpdatedText: z.string().default(shippedTemplate('agentInstructions', 'updated')).volatile(),
  skillCatalogEnabled: z.boolean().default(true).volatile(),
  skillCatalogCatalogText: z.string().default(shippedTemplate('skillCatalog', 'catalog')).volatile(),
  skillCatalogCatalogPartialText: z.string().default(shippedTemplate('skillCatalog', 'catalogPartial')).volatile(),
  skillCatalogChangedText: z.string().default(shippedTemplate('skillCatalog', 'changed')).volatile(),
  skillCatalogChangedPartialText: z.string().default(shippedTemplate('skillCatalog', 'changedPartial')).volatile(),
  tmuxContextEnabled: z.boolean().default(true).volatile(),
  tmuxContextText: z.string().default(shippedTemplate('tmuxContext')).volatile(),
  workingDirectoryText: z.string().default(shippedTemplate('workingDirectory')).volatile(),
  sandboxPolicyEnabled: z.boolean().default(true).volatile(),
  sandboxPolicyReadOnlyText: z.string().default(shippedTemplate('sandboxPolicy', 'readOnly')).volatile(),
  sandboxPolicyWorkspaceWriteText: z.string().default(shippedTemplate('sandboxPolicy', 'workspaceWrite')).volatile(),
  sandboxPolicyWorkspaceWriteRootsText: z.string().default(shippedTemplate('sandboxPolicy', 'workspaceWriteRoots')).volatile(),
  sandboxPolicyFullAccessText: z.string().default(shippedTemplate('sandboxPolicy', 'fullAccess')).volatile(),
  approvalPolicyEnabled: z.boolean().default(true).volatile(),
  approvalPolicyAskText: z.string().default(shippedTemplate('approvalPolicy', 'ask')).volatile(),
  approvalPolicyNeverText: z.string().default(shippedTemplate('approvalPolicy', 'never')).volatile(),
  subagentDelegationEnabled: z.boolean().default(true).volatile(),
  subagentDelegationText: z.string().default(shippedTemplate('subagentDelegation')).volatile(),
  harnessSourceEnabled: z.boolean().default(true).volatile(),
  harnessSourceText: z.string().default(shippedTemplate('harnessSource')).volatile(),
  webSurfaceEnabled: z.boolean().default(true).volatile(),
  webSurfaceText: z.string().default(shippedTemplate('webSurface')).volatile(),
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
