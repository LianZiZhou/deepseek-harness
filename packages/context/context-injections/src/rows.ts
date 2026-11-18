/**
 * The context injections this package switches and rewrites, and the Config
 * field names each one owns. Client-safe: the settings page reads the same
 * table through `@deepseek-ai/dsh-context-injections/types`.
 * @module @deepseek-ai/dsh-context-injections/types
 */

/**
 * One switchable injection. A `message` row matches injected user messages by
 * `source.kind`; a `section` row matches a runtime-context section by name. A
 * `required` section is always stated, so only its text is adjustable.
 */
export type ContextInjectionRow =
  | { readonly id: string; readonly target: 'message'; readonly source: string }
  | { readonly id: string; readonly target: 'section'; readonly section: string; readonly required?: true }

/** Every row, in the order the settings page lists them. */
export const CONTEXT_INJECTION_ROWS = [
  { id: 'modelSwitch', target: 'message', source: 'model-selection' },
  { id: 'timeContext', target: 'message', source: 'time-context' },
  { id: 'approvalNotice', target: 'message', source: 'user-approval' },
  { id: 'workingDirectoryNotice', target: 'message', source: 'working-directory' },
  { id: 'planModeNotice', target: 'message', source: 'plan-mode' },
  { id: 'repeatToolReminder', target: 'message', source: 'repeat-tool-reminder' },
  { id: 'agentInstructions', target: 'message', source: 'agent-instructions' },
  { id: 'skillCatalog', target: 'message', source: 'skill-catalog' },
  { id: 'tmuxContext', target: 'message', source: 'tmux-context' },
  { id: 'workingDirectory', target: 'section', section: 'working-directory:current', required: true },
  { id: 'sandboxPolicy', target: 'section', section: 'sandbox:policy' },
  { id: 'approvalPolicy', target: 'section', section: 'approval:policy' },
  { id: 'subagentDelegation', target: 'section', section: 'subagent:delegation' },
  { id: 'harnessSource', target: 'section', section: 'harness:source' },
  { id: 'webSurface', target: 'section', section: 'app:web-surface' },
] as const satisfies readonly ContextInjectionRow[]

/** Id of one row in {@link CONTEXT_INJECTION_ROWS}. */
export type ContextInjectionRowId = typeof CONTEXT_INJECTION_ROWS[number]['id']

/** The placeholder a replacement text uses to keep the original injected text. */
export const ORIGINAL_TEXT_PLACEHOLDER = '{{text}}'

/**
 * Config field holding whether a row's injection is sent.
 * @param id - the row id.
 * @returns the field name, `<id>Enabled`.
 */
export function enabledField(id: string): string {
  return `${id}Enabled`
}

/**
 * Config field holding a row's replacement text.
 * @param id - the row id.
 * @returns the field name, `<id>Text`.
 */
export function textField(id: string): string {
  return `${id}Text`
}

/**
 * Whether a row can be switched off.
 * @param row - the row.
 * @returns false for a required section, true otherwise.
 */
export function isSwitchable(row: ContextInjectionRow): boolean {
  return row.target === 'message' || row.required !== true
}
