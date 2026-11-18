/**
 * The rows the page lists. Spelled here rather than imported: a client package
 * must not depend on a Host package. The Host row table in
 * `@deepseek-ai/dsh-context-injections` is the authority; a test keeps the two
 * in step.
 */

/** Settings namespace the Host plugin's row is mounted under. */
export const CONTEXT_INJECTIONS_NS = 'context-injections'

/** One row: which group it is listed under and whether it can be switched off. */
export interface ContextInjectionsPageRow {
  /** Row id; the Config fields are `<id>Enabled` and `<id>Text`. */
  readonly id: ContextInjectionsRowId
  /** `notice` for injected messages, `context` for runtime-context sections. */
  readonly group: 'notice' | 'context'
  /** False for a section that is always stated. */
  readonly switchable: boolean
}

/** Every row id, in page order. */
export type ContextInjectionsRowId =
  | 'modelSwitch' | 'timeContext' | 'approvalNotice' | 'workingDirectoryNotice' | 'planModeNotice'
  | 'repeatToolReminder' | 'agentInstructions' | 'skillCatalog' | 'tmuxContext'
  | 'workingDirectory' | 'sandboxPolicy' | 'approvalPolicy' | 'subagentDelegation' | 'harnessSource' | 'webSurface'

/** The page's rows, in the order they are listed. */
export const PAGE_ROWS: readonly ContextInjectionsPageRow[] = [
  { id: 'modelSwitch', group: 'notice', switchable: true },
  { id: 'timeContext', group: 'notice', switchable: true },
  { id: 'approvalNotice', group: 'notice', switchable: true },
  { id: 'workingDirectoryNotice', group: 'notice', switchable: true },
  { id: 'planModeNotice', group: 'notice', switchable: true },
  { id: 'repeatToolReminder', group: 'notice', switchable: true },
  { id: 'agentInstructions', group: 'notice', switchable: true },
  { id: 'skillCatalog', group: 'notice', switchable: true },
  { id: 'tmuxContext', group: 'notice', switchable: true },
  { id: 'workingDirectory', group: 'context', switchable: false },
  { id: 'sandboxPolicy', group: 'context', switchable: true },
  { id: 'approvalPolicy', group: 'context', switchable: true },
  { id: 'subagentDelegation', group: 'context', switchable: true },
  { id: 'harnessSource', group: 'context', switchable: true },
  { id: 'webSurface', group: 'context', switchable: true },
]
