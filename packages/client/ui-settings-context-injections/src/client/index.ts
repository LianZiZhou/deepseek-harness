/**
 * The context injections settings page, browser half: switches and
 * replacement text for every row of the `context-injections` namespace. The
 * page registers into the Settings navigation while the Host serves that
 * namespace, so a deployment without the plugin shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge and the settings shell's
// SlotMap merge (the 'settings.section' entry). Cross-plugin collaboration
// goes through the service and slots, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ContextInjectionsSection } from './ContextInjectionsSection.tsx'
import { ContextInjectionsController, type ContextInjectionsSettings } from './controller.ts'
import { de, en, es, fr, ja, pt, ru, zh, type ContextInjectionsLocaleKey } from './locales.ts'
import { CONTEXT_INJECTIONS_NS } from './rows.ts'

export type { ContextInjectionsSectionProps } from './ContextInjectionsSection.tsx'
export type {
  ContextInjectionsFace, ContextInjectionsRowState, ContextInjectionsSettings, ContextInjectionsState,
} from './controller.ts'
export type { ContextInjectionsLocaleKey } from './locales.ts'
export type { ContextInjectionsPageRow, ContextInjectionsRowId } from './rows.ts'
export { CONTEXT_INJECTIONS_NS, PAGE_ROWS } from './rows.ts'

declare module '@deepseek-ai/dsh-client-ui-slots/client' {
  interface LocaleNamespaceMap {
    /** Context injections settings page copy. */
    'settings.contextInjections': ContextInjectionsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.contextInjections'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the context injections page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-context-injections: dictionaries')
  const t = ctx.locale.bind(NS)
  const page = new ContextInjectionsController(ctx.configForms.get<ContextInjectionsSettings>(CONTEXT_INJECTIONS_NS))
  ctx.effect(() => () => { page.dispose() }, 'ui-settings-context-injections: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([CONTEXT_INJECTIONS_NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'context-injections',
    // After Prompt presets (22): both shape what the model receives. Before
    // Archived tasks (25).
    order: 23,
    label: () => t('nav'),
    locale: NS,
    inject: () => page.inject(),
  }, ContextInjectionsSection))), 'ui-settings-context-injections: page')
}
