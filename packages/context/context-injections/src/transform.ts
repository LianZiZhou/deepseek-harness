/** Pure rewrites the admission listeners apply to injected messages and runtime-context sections. */

import type { ContextSnapshotSection, UserMessage } from '@deepseek-ai/dsh-llm'
import { ORIGINAL_TEXT_PLACEHOLDER } from './rows.ts'

/** What one row decides about the injections it matches. */
export interface InjectionSetting {
  /** False drops every matched injection. */
  readonly enabled: boolean
  /** Replacement text; empty keeps the original. */
  readonly text: string
}

/**
 * Render a replacement over the original injected text. Every
 * {@link ORIGINAL_TEXT_PLACEHOLDER} becomes the original; nothing else in the
 * replacement is interpreted, so braces a person types reach the model as typed.
 * @param replacement - the row's replacement text; empty keeps the original.
 * @param original - the text the producer injected.
 * @returns the text the model receives.
 */
export function rewriteText(replacement: string, original: string): string {
  return replacement === '' ? original : replacement.split(ORIGINAL_TEXT_PLACEHOLDER).join(original)
}

/**
 * Rewrite one admitted message's text blocks. A snapshot section whose text is
 * one of the rewritten blocks is rewritten with it, so the presented sections
 * keep describing what the model received.
 */
function rewriteMessage(message: UserMessage, replacement: string): UserMessage {
  const originals = new Set<string>()
  const content = message.content.map((block) => {
    if (block.type !== 'text') return block
    originals.add(block.text)
    return { ...block, text: rewriteText(replacement, block.text) }
  })
  const source = message.source
  if (!('form' in source) || source.form !== 'snapshot') return { ...message, content }
  return {
    ...message,
    content,
    source: {
      ...source,
      sections: source.sections.map(section => originals.has(section.text)
        ? { ...section, text: rewriteText(replacement, section.text) }
        : section),
    },
  }
}

/**
 * Drop or rewrite injected messages by their source kind. A message whose kind
 * no row names, including a person's own prompt, passes through unchanged.
 * @param messages - the batch a step is about to admit.
 * @param settings - each named source kind's setting.
 * @returns the batch the step admits.
 */
export function admitMessages(
  messages: readonly UserMessage[],
  settings: ReadonlyMap<string, InjectionSetting>,
): UserMessage[] {
  return messages.flatMap((message) => {
    const setting = settings.get(message.source.kind)
    if (setting === undefined) return [message]
    if (!setting.enabled) return []
    return [setting.text === '' ? message : rewriteMessage(message, setting.text)]
  })
}

/**
 * Drop or rewrite runtime-context sections by name. A section no row names
 * passes through unchanged.
 * @param sections - the rendered sections in assembly order.
 * @param settings - each named section's setting.
 * @returns the sections the snapshot states.
 */
export function admitSections(
  sections: readonly ContextSnapshotSection[],
  settings: ReadonlyMap<string, InjectionSetting>,
): ContextSnapshotSection[] {
  return sections.flatMap((section) => {
    const setting = settings.get(section.name)
    if (setting === undefined) return [section]
    if (!setting.enabled) return []
    return [{ ...section, text: rewriteText(setting.text, section.text) }]
  })
}
