/** Pure rewrites the admission listeners apply to injected messages and runtime-context sections. */

import type { ContextSnapshotSection, UserMessage } from '@deepseek-ai/dsh-llm'
import { renderTemplate, type CompiledTemplate } from './template.ts'

/** One shape of a row's text and the person's template for it. */
export interface InjectionVariantSetting {
  /** The shipped template the producer builds this shape from. */
  readonly template: CompiledTemplate
  /** The person's template; empty or equal to the shipped template keeps the original. */
  readonly text: string
}

/** What one row decides about the injections it matches. */
export interface InjectionSetting {
  /** False drops every matched injection. */
  readonly enabled: boolean
  /** The row's shapes, tried in order. */
  readonly variants: readonly InjectionVariantSetting[]
}

function keepsOriginal(variant: InjectionVariantSetting): boolean {
  return variant.text === '' || variant.text === variant.template.source
}

/**
 * Rewrite one injected text. The first shape whose shipped template matches
 * supplies the variables and the person's template; a text no shape matches,
 * such as one a newer producer worded differently, is sent unchanged.
 * @param original - the text the producer injected.
 * @param variants - the row's shapes.
 * @returns the text the model receives.
 */
export function rewriteText(original: string, variants: readonly InjectionVariantSetting[]): string {
  for (const variant of variants) {
    const values = variant.template.match(original)
    if (values === undefined) continue
    return keepsOriginal(variant) ? original : renderTemplate(variant.text, values)
  }
  return original
}

/**
 * Rewrite one admitted message's text blocks. A snapshot section whose text is
 * one of the rewritten blocks is rewritten with it, so the presented sections
 * keep describing what the model received.
 */
function rewriteMessage(message: UserMessage, variants: readonly InjectionVariantSetting[]): UserMessage {
  const rewritten = new Map<string, string>()
  const content = message.content.map((block) => {
    if (block.type !== 'text') return block
    const text = rewriteText(block.text, variants)
    rewritten.set(block.text, text)
    return text === block.text ? block : { ...block, text }
  })
  const source = message.source
  if (!('form' in source) || source.form !== 'snapshot') return { ...message, content }
  return {
    ...message,
    content,
    source: {
      ...source,
      sections: source.sections.map((section) => {
        const text = rewritten.get(section.text)
        return text === undefined || text === section.text ? section : { ...section, text }
      }),
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
    return [setting.variants.every(keepsOriginal) ? message : rewriteMessage(message, setting.variants)]
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
    const text = rewriteText(section.text, setting.variants)
    return [text === section.text ? section : { ...section, text }]
  })
}
