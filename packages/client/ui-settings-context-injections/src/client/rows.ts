/**
 * The rows the page lists. Spelled here rather than imported: a client package
 * must not depend on a Host package. The Host row table in
 * `@deepseek-ai/dsh-context-injections` is the authority; a test keeps the two
 * in step. The templates themselves are not spelled here: each shape's field
 * defaults to its shipped template, and the page shows the field's value.
 */

/** Settings namespace the Host plugin's row is mounted under. */
export const CONTEXT_INJECTIONS_NS = 'context-injections'

/** One shape of a row's text as the page lists it. */
export interface ContextInjectionsPageVariant {
  /** Variant id; empty for a row's only shape. */
  readonly id: string
  /** Locale key of a named shape's label, `<row>.<variant>`; absent for a row's only shape. */
  readonly label?: ContextInjectionsVariantKey
  /** The variables the shipped template fills in, in template order, without `text`. */
  readonly variables: readonly string[]
}

/** One row: which group it is listed under, whether it can be switched off, and its shapes. */
export interface ContextInjectionsPageRow {
  readonly id: ContextInjectionsRowId
  readonly group: 'notice' | 'context'
  readonly switchable: boolean
  readonly variants: readonly ContextInjectionsPageVariant[]
}

/** Every row id, in page order. */
export type ContextInjectionsRowId =
  | 'modelSwitch' | 'timeContext' | 'approvalNotice' | 'workingDirectoryNotice' | 'planModeNotice'
  | 'repeatToolReminder' | 'agentInstructions' | 'skillCatalog' | 'tmuxContext'
  | 'workingDirectory' | 'sandboxPolicy' | 'approvalPolicy' | 'subagentDelegation' | 'harnessSource' | 'webSurface'

/** Every named shape, as `<row>.<variant>`; the page labels each one. */
export type ContextInjectionsVariantKey =
  | 'timeContext.known' | 'timeContext.unclear'
  | 'workingDirectoryNotice.changed' | 'workingDirectoryNotice.unavailable'
  | 'planModeNotice.entered' | 'planModeNotice.left'
  | 'repeatToolReminder.first' | 'repeatToolReminder.repeated'
  | 'agentInstructions.loaded' | 'agentInstructions.trimmed' | 'agentInstructions.replaced'
  | 'agentInstructions.cleared' | 'agentInstructions.updated'
  | 'skillCatalog.catalog' | 'skillCatalog.catalogPartial' | 'skillCatalog.changed' | 'skillCatalog.changedPartial'
  | 'sandboxPolicy.readOnly' | 'sandboxPolicy.workspaceWrite' | 'sandboxPolicy.workspaceWriteRoots' | 'sandboxPolicy.fullAccess'
  | 'approvalPolicy.ask' | 'approvalPolicy.never'

const only = (...variables: string[]): readonly ContextInjectionsPageVariant[] => [{ id: '', variables }]
const TIME = ['turn', 'step', 'time', 'zone', 'baseline', 'elapsed']

/** The page's rows, in the order they are listed. */
export const PAGE_ROWS: readonly ContextInjectionsPageRow[] = [
  { id: 'modelSwitch', group: 'notice', switchable: true, variants: only('from', 'to') },
  {
    id: 'timeContext',
    group: 'notice',
    switchable: true,
    variants: [{ id: 'known', label: 'timeContext.known', variables: TIME }, { id: 'unclear', label: 'timeContext.unclear', variables: TIME }],
  },
  { id: 'approvalNotice', group: 'notice', switchable: true, variants: only('from', 'to') },
  {
    id: 'workingDirectoryNotice',
    group: 'notice',
    switchable: true,
    variants: [{ id: 'changed', label: 'workingDirectoryNotice.changed', variables: ['from', 'to'] }, { id: 'unavailable', label: 'workingDirectoryNotice.unavailable', variables: ['from', 'to'] }],
  },
  {
    id: 'planModeNotice',
    group: 'notice',
    switchable: true,
    variants: [{ id: 'entered', label: 'planModeNotice.entered', variables: [] }, { id: 'left', label: 'planModeNotice.left', variables: [] }],
  },
  {
    id: 'repeatToolReminder',
    group: 'notice',
    switchable: true,
    variants: [{ id: 'first', label: 'repeatToolReminder.first', variables: [] }, { id: 'repeated', label: 'repeatToolReminder.repeated', variables: ['tool', 'count', 'arguments'] }],
  },
  {
    id: 'agentInstructions',
    group: 'notice',
    switchable: true,
    variants: [
      { id: 'loaded', label: 'agentInstructions.loaded', variables: ['instructions'] },
      { id: 'trimmed', label: 'agentInstructions.trimmed', variables: ['budget', 'instructions'] },
      { id: 'replaced', label: 'agentInstructions.replaced', variables: ['instructions'] },
      { id: 'cleared', label: 'agentInstructions.cleared', variables: [] },
      { id: 'updated', label: 'agentInstructions.updated', variables: ['changes'] },
    ],
  },
  {
    id: 'skillCatalog',
    group: 'notice',
    switchable: true,
    variants: [
      { id: 'catalog', label: 'skillCatalog.catalog', variables: ['skills'] },
      { id: 'catalogPartial', label: 'skillCatalog.catalogPartial', variables: ['skills'] },
      { id: 'changed', label: 'skillCatalog.changed', variables: ['skills'] },
      { id: 'changedPartial', label: 'skillCatalog.changedPartial', variables: ['skills'] },
    ],
  },
  {
    id: 'tmuxContext',
    group: 'notice',
    switchable: true,
    variants: only('turn', 'session', 'windowIndex', 'windowName', 'paneIndex', 'paneId', 'windowActive', 'paneActive', 'layout'),
  },
  { id: 'workingDirectory', group: 'context', switchable: false, variants: only('cwd') },
  {
    id: 'sandboxPolicy',
    group: 'context',
    switchable: true,
    variants: [
      { id: 'readOnly', label: 'sandboxPolicy.readOnly', variables: [] },
      { id: 'workspaceWrite', label: 'sandboxPolicy.workspaceWrite', variables: ['workspace'] },
      { id: 'workspaceWriteRoots', label: 'sandboxPolicy.workspaceWriteRoots', variables: ['workspace', 'directories'] },
      { id: 'fullAccess', label: 'sandboxPolicy.fullAccess', variables: [] },
    ],
  },
  {
    id: 'approvalPolicy',
    group: 'context',
    switchable: true,
    variants: [{ id: 'ask', label: 'approvalPolicy.ask', variables: [] }, { id: 'never', label: 'approvalPolicy.never', variables: [] }],
  },
  { id: 'subagentDelegation', group: 'context', switchable: true, variants: only() },
  { id: 'harnessSource', group: 'context', switchable: true, variants: only('checkout') },
  { id: 'webSurface', group: 'context', switchable: true, variants: only('url') },
]
