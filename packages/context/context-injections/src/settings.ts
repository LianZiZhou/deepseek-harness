/** Per-row reads of the volatile Config, paired with each shape's compiled template. */

import type { Config } from './index.ts'
import { CONTEXT_INJECTION_ROWS, type ContextInjectionRowId, type ContextInjectionVariant } from './rows.ts'
import { compileTemplate, type CompiledTemplate } from './template.ts'
import type { InjectionSetting, InjectionVariantSetting } from './transform.ts'

/** One row's switch and its shapes' templates, in the row's variant order. */
interface RowRead {
  readonly enabled: boolean
  readonly texts: readonly string[]
}

/** Each row's fields; a required section has no switch. */
const READS: { readonly [Id in ContextInjectionRowId]: (c: Config) => RowRead } = {
  modelSwitch: c => ({ enabled: c.modelSwitchEnabled.get(), texts: [c.modelSwitchText.get()] }),
  timeContext: c => ({ enabled: c.timeContextEnabled.get(), texts: [c.timeContextKnownText.get(), c.timeContextUnclearText.get()] }),
  approvalNotice: c => ({ enabled: c.approvalNoticeEnabled.get(), texts: [c.approvalNoticeText.get()] }),
  workingDirectoryNotice: c => ({
    enabled: c.workingDirectoryNoticeEnabled.get(),
    texts: [
      c.workingDirectoryNoticeChangedText.get(),
      c.workingDirectoryNoticeUnavailableText.get(),
    ],
  }),
  planModeNotice: c => ({
    enabled: c.planModeNoticeEnabled.get(),
    texts: [
      c.planModeNoticeEnteredText.get(),
      c.planModeNoticeLeftText.get(),
    ],
  }),
  repeatToolReminder: c => ({
    enabled: c.repeatToolReminderEnabled.get(),
    texts: [
      c.repeatToolReminderFirstText.get(),
      c.repeatToolReminderRepeatedText.get(),
    ],
  }),
  agentInstructions: c => ({
    enabled: c.agentInstructionsEnabled.get(),
    texts: [
      c.agentInstructionsLoadedText.get(),
      c.agentInstructionsTrimmedText.get(),
      c.agentInstructionsReplacedText.get(),
      c.agentInstructionsClearedText.get(),
      c.agentInstructionsUpdatedText.get(),
    ],
  }),
  skillCatalog: c => ({ enabled: c.skillCatalogEnabled.get(), texts: [
    c.skillCatalogCatalogText.get(), c.skillCatalogCatalogPartialText.get(), c.skillCatalogChangedText.get(),
    c.skillCatalogChangedPartialText.get(),
  ] }),
  tmuxContext: c => ({ enabled: c.tmuxContextEnabled.get(), texts: [c.tmuxContextText.get()] }),
  workingDirectory: c => ({ enabled: true, texts: [c.workingDirectoryText.get()] }),
  sandboxPolicy: c => ({
    enabled: c.sandboxPolicyEnabled.get(),
    texts: [
      c.sandboxPolicyReadOnlyText.get(),
      c.sandboxPolicyWorkspaceWriteText.get(),
      c.sandboxPolicyWorkspaceWriteRootsText.get(),
      c.sandboxPolicyFullAccessText.get(),
    ],
  }),
  approvalPolicy: c => ({
    enabled: c.approvalPolicyEnabled.get(),
    texts: [
      c.approvalPolicyAskText.get(),
      c.approvalPolicyNeverText.get(),
    ],
  }),
  subagentDelegation: c => ({ enabled: c.subagentDelegationEnabled.get(), texts: [c.subagentDelegationText.get()] }),
  harnessSource: c => ({ enabled: c.harnessSourceEnabled.get(), texts: [c.harnessSourceText.get()] }),
  webSurface: c => ({ enabled: c.webSurfaceEnabled.get(), texts: [c.webSurfaceText.get()] }),
}

/** Each row with its shapes' templates compiled once, in the row's variant order. */
const COMPILED_ROWS = CONTEXT_INJECTION_ROWS.map(row => ({
  row,
  templates: (row.variants as readonly ContextInjectionVariant[]).map(variant => compileTemplate(variant.template)),
}))

/**
 * Pair a row's compiled templates with the person's templates, most specific
 * first: a shape with more constant text is tried before one whose variables
 * could also cover that text.
 * @param templates - the row's compiled shipped templates, in variant order.
 * @param texts - the person's templates, in the same order.
 * @returns the row's shapes in matching order.
 */
export function pairVariants(templates: readonly CompiledTemplate[], texts: readonly string[]): InjectionVariantSetting[] {
  if (templates.length !== texts.length) {
    throw new Error(`context-injections: ${String(templates.length)} shapes but ${String(texts.length)} templates`)
  }
  return templates
    // A hole in the person's templates keeps the shipped one.
    .map((template, index) => ({ template, text: texts[index] ?? template.source }))
    .sort((a, b) => b.template.literalLength - a.template.literalLength)
}

/**
 * Read every row's setting from the volatile Config.
 * @param config - the resolved entry config.
 * @returns message settings by source kind and section settings by section name.
 */
export function readSettings(config: Config): {
  messages: Map<string, InjectionSetting>
  sections: Map<string, InjectionSetting>
} {
  const messages = new Map<string, InjectionSetting>()
  const sections = new Map<string, InjectionSetting>()
  for (const { row, templates } of COMPILED_ROWS) {
    const read = READS[row.id](config)
    const setting: InjectionSetting = { enabled: read.enabled, variants: pairVariants(templates, read.texts) }
    if (row.target === 'message') messages.set(row.source, setting)
    else sections.set(row.section, setting)
  }
  return { messages, sections }
}
