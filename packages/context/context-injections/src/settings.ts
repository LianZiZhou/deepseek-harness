/** Per-row reads of the volatile Config, keyed by what each row matches. */

import type { Config } from './index.ts'
import { CONTEXT_INJECTION_ROWS, type ContextInjectionRowId } from './rows.ts'
import type { InjectionSetting } from './transform.ts'

/** Each row's current setting, read from its own two fields. */
const SETTINGS: { readonly [Id in ContextInjectionRowId]: (config: Config) => InjectionSetting } = {
  modelSwitch: c => ({ enabled: c.modelSwitchEnabled.get(), text: c.modelSwitchText.get() }),
  timeContext: c => ({ enabled: c.timeContextEnabled.get(), text: c.timeContextText.get() }),
  approvalNotice: c => ({ enabled: c.approvalNoticeEnabled.get(), text: c.approvalNoticeText.get() }),
  workingDirectoryNotice: c => ({ enabled: c.workingDirectoryNoticeEnabled.get(), text: c.workingDirectoryNoticeText.get() }),
  planModeNotice: c => ({ enabled: c.planModeNoticeEnabled.get(), text: c.planModeNoticeText.get() }),
  repeatToolReminder: c => ({ enabled: c.repeatToolReminderEnabled.get(), text: c.repeatToolReminderText.get() }),
  agentInstructions: c => ({ enabled: c.agentInstructionsEnabled.get(), text: c.agentInstructionsText.get() }),
  skillCatalog: c => ({ enabled: c.skillCatalogEnabled.get(), text: c.skillCatalogText.get() }),
  tmuxContext: c => ({ enabled: c.tmuxContextEnabled.get(), text: c.tmuxContextText.get() }),
  workingDirectory: c => ({ enabled: true, text: c.workingDirectoryText.get() }),
  sandboxPolicy: c => ({ enabled: c.sandboxPolicyEnabled.get(), text: c.sandboxPolicyText.get() }),
  approvalPolicy: c => ({ enabled: c.approvalPolicyEnabled.get(), text: c.approvalPolicyText.get() }),
  subagentDelegation: c => ({ enabled: c.subagentDelegationEnabled.get(), text: c.subagentDelegationText.get() }),
  harnessSource: c => ({ enabled: c.harnessSourceEnabled.get(), text: c.harnessSourceText.get() }),
  webSurface: c => ({ enabled: c.webSurfaceEnabled.get(), text: c.webSurfaceText.get() }),
}

/**
 * Read every row of one target into a lookup keyed by what it matches.
 * @param config - the resolved entry config.
 * @returns message settings keyed by source kind, and section settings keyed by section name.
 */
export function readSettings(config: Config): {
  messages: Map<string, InjectionSetting>
  sections: Map<string, InjectionSetting>
} {
  const messages = new Map<string, InjectionSetting>()
  const sections = new Map<string, InjectionSetting>()
  for (const row of CONTEXT_INJECTION_ROWS) {
    const setting = SETTINGS[row.id](config)
    if (row.target === 'message') messages.set(row.source, setting)
    else sections.set(row.section, setting)
  }
  return { messages, sections }
}
