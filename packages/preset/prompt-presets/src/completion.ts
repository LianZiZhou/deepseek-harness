/**
 * Argument completion for the `/prompt-preset` command in terminal front doors.
 *
 * Command discovery belongs to `dsh-commands`, which carries a name and an
 * input hint but no argument vocabulary. A terminal front door that completes
 * arguments exposes its own optional registry for them; dsh-TUI's is the
 * `tuiCommandTrees` service. This module describes that contract structurally
 * rather than importing the front door, so the package gains no dependency on
 * one terminal implementation and composes unchanged where none is mounted.
 *
 * @module @deepseek-ai/dsh-prompt-presets/completion
 */

import type { PromptPreset } from './rules.ts'

/** The command name the completion tree is rooted at. */
export const COMMAND_NAME = 'prompt-preset'

/** One description per UI language, the shape terminal front doors localize with. */
export type LocalizedText = Readonly<Partial<Record<'zh' | 'en', string>>>

/** One completion candidate: the token Tab inserts and the row that explains it. */
export interface CompletionNode {
  readonly name: string
  readonly description: string
  readonly descriptions?: LocalizedText
  /** Short bracketed marker shown between name and description. */
  readonly tag?: string
}

/**
 * The service a terminal front door mounts to accept argument completion.
 * Registration returns its own disposer; the front door also releases it when
 * the registering plugin unloads.
 */
export interface TerminalCommandTrees {
  register(provider: {
    root: string
    descriptions?: LocalizedText
    children(canonicalPath: readonly string[]): readonly CompletionNode[]
  }): () => void
}

/** The service name dsh-TUI mounts its completion registry under. */
export const TERMINAL_COMMAND_TREES = 'tuiCommandTrees'

/** The command's `dsh-commands` description, the English root row. */
export const COMMAND_DESCRIPTION = 'Show or switch this session\'s prompt preset'

/** Localized root row. */
export const COMMAND_DESCRIPTIONS: LocalizedText = {
  en: COMMAND_DESCRIPTION,
  zh: '查看或切换本会话的提示词预设',
}

const OFF: CompletionNode = {
  name: 'off',
  description: 'Run this session without a preset',
  descriptions: { en: 'Run this session without a preset', zh: '本会话不使用预设' },
}

const OFF_DEFAULT: CompletionNode = {
  name: 'off',
  description: 'New sessions start without a preset',
  descriptions: { en: 'New sessions start without a preset', zh: '新会话默认不使用预设' },
}

const DEFAULT: CompletionNode = {
  name: 'default',
  description: 'Choose the preset new sessions start with',
  descriptions: { en: 'Choose the preset new sessions start with', zh: '设置新会话的默认预设' },
}

/**
 * The candidates for one position of a `/prompt-preset` line.
 *
 * The roster is read on every call, so a preset added in the Web editor or the
 * profile patch completes without re-registering. Positions the grammar does
 * not accept complete to nothing.
 * @param path - the canonical path, the command name first.
 * @param stored - the live roster and default.
 * @returns the candidates, presets first in id order.
 */
export function completions(
  path: readonly string[],
  stored: { presets: Record<string, PromptPreset>; default: string },
): readonly CompletionNode[] {
  const presets = Object.entries(stored.presets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, preset]): CompletionNode => ({
      name: id,
      description: preset.description ?? preset.name,
      ...id === stored.default ? { tag: 'default' } : {},
    }))
  if (path.length === 1) return [...presets, OFF, DEFAULT]
  if (path.length === 2 && path[1] === 'default') return [...presets, OFF_DEFAULT]
  return []
}
