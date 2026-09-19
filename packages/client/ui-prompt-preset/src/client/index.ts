/**
 * Prompt-preset surface plugin, browser half — two surfaces over one roster:
 * a settings section that edits rule stacks with a live preview, and a
 * switcher in the task header beside the mode chip.
 *
 * The switcher is a live control rather than a label, which is what separates
 * it from the agent-preset surfaces: a task's composition is fixed once it
 * starts, while its prompt is re-rendered every step, so switching mid-task is
 * an honest offer.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the Session Controller service merge (ctx.sessions).
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import { PromptPresetSection } from './PromptPresetSection.tsx'
import type { PromptPresetSectionInjected } from './PromptPresetSection.tsx'
import { PromptPresetSeat } from './PromptPresetSeat.tsx'
import type { PromptPresetSeatInjected } from './PromptPresetSeat.tsx'
import { PromptPresetSectionController } from './section-store.ts'
import { PromptPresetSeatController } from './seat-store.ts'
import { en, zh, type PromptPresetKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Prompt-preset surface copy. */
    'settings.promptPreset': PromptPresetKey
  }
}

/** The settings namespace whose commits move both surfaces. */
export const PROMPT_PRESET_SETTINGS_NS = 'prompt-presets'

export type { PromptPresetSectionInjected, PromptPresetSectionProps } from './PromptPresetSection.tsx'
export type { PromptPresetSeatInjected, PromptPresetSeatProps } from './PromptPresetSeat.tsx'
export type { PromptPresetSectionState, PreviewState, CreateDraft } from './section-store.ts'
export type { PromptPresetSeatState, PresetOption } from './seat-store.ts'
export type { Blocker, DraftRule, PresetDraft } from './preset-model.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'sessions', 'locale', 'remote', 'remote.promptPresets',
]

/**
 * Mount the prompt-preset surfaces: the settings section and the task switcher.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const seats = new WeakMapWithValues<SessionBinding, PromptPresetSeatController>()
  const section = new PromptPresetSectionController(ctx, () => {
    for (const seat of seats.values) void seat.load()
  })
  ctx.effect(() => () => { section.dispose() }, 'ui-prompt-preset: preview debounce')

  const seatFor = (scope: ClientContext, binding: SessionBinding): PromptPresetSeatController => {
    let seat = seats.get(binding)
    if (seat !== undefined) return seat
    seat = new PromptPresetSeatController(scope, () =>
      scope.sessions.binding(binding.sessionId) === binding ? binding.sessionId : undefined)
    seats.set(binding, seat)
    binding.ctx.effect(() => () => {
      seats.delete(binding)
    }, 'ui-prompt-preset: Provider binding')
    return seat
  }

  ctx.effect(() => ctx.locale.register('settings.promptPreset', { zh, en }),
    'ui-prompt-preset: dictionaries')

  ctx.effect(() => {
    // A preset edited from either surface, and a reconnect, both move the
    // roster every surface reads.
    const refresh = (): void => {
      if (section.store.getSnapshot().status !== 'idle') void section.load()
      for (const seat of seats.values) void seat.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== PROMPT_PRESET_SETTINGS_NS) return
        refresh()
      }),
      ctx.remote.$on('prompt-preset/changed', () => { refresh() }),
      ctx.on('connection/reset', () => { refresh() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-prompt-preset: roster refresh')

  // The session the preview runs against: the one the main view is showing,
  // because which sections exist depends on that task's own composition.
  const previewSession = (scope: ClientContext): SessionId | undefined => {
    const summary = Object.values(scope.sessions.list.getSnapshot().byId)
      .find(session => (session.retainedBy.mainView ?? 0) > 0)
    return summary?.id
  }

  const sectionInjected = (): PromptPresetSectionInjected => ({
    hooks: { promptPresetSection: section.store },
    load: () => section.load(),
    select: (id: string) => { section.select(id) },
    confirmSwitch: () => { section.confirmSwitch() },
    cancelSwitch: () => { section.cancelSwitch() },
    beginCreate: () => { section.beginCreate() },
    cancelCreate: () => { section.cancelCreate() },
    patchCreate: (patch) => { section.patchCreate(patch) },
    confirmCreate: () => section.confirmCreate(),
    createBlocker: () => section.createBlocker(),
    setName: (name) => { section.setName(name) },
    setDescription: (description) => { section.setDescription(description) },
    addRule: (kind) => { section.addRule(kind) },
    removeRule: (key) => { section.removeRule(key) },
    moveRule: (key, direction) => { section.moveRule(key, direction) },
    patchRule: (key, rule) => { section.patchRule(key, rule) },
    setRuleEnabled: (key, enabled) => { section.setRuleEnabled(key, enabled) },
    save: () => section.save(),
    discard: () => { section.discard() },
    setDefault: id => section.setDefault(id),
    confirmDelete: (id) => { section.confirmDelete(id) },
    remove: () => section.remove(),
    refreshPreview: () => { section.refreshPreview() },
    hasSession: () => previewSession(ctx) !== undefined,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'prompt-presets',
    // After Agent presets (20): a preset composes the task, a prompt preset
    // shapes the prompt that composition produces. Before Archived tasks (25).
    order: 22,
    label: () => ctx.locale.bind('settings.promptPreset')('nav'),
    locale: 'settings.promptPreset',
    inject: sectionInjected,
  }, PromptPresetSection))

  ctx.inject(['slots', 'conversation', 'sessions'], (scope: ClientContext) => {
    // The preview follows whichever task the main view shows, so the section
    // answers about the composition the person is looking at.
    scope.effect(() => scope.sessions.list.subscribe(() => {
      section.setPreviewSession(previewSession(scope))
    }), 'ui-prompt-preset: preview target')
    section.setPreviewSession(previewSession(scope))

    // One inert controller behind every unbound render, so a header that has
    // no task yet still has a store to read and allocates nothing per frame.
    const unboundSeat = new PromptPresetSeatController(scope, () => undefined)

    const seatInjected = (sessionId: SessionId | undefined): PromptPresetSeatInjected => {
      const binding = sessionId === undefined ? undefined : scope.sessions.binding(sessionId)
      const seat = binding === undefined ? unboundSeat : seatFor(scope, binding)
      return {
        hooks: { promptPresetSeat: seat.store },
        load: () => seat.load(),
        select: (id: string) => seat.select(id),
        clearError: () => { seat.clearError() },
      }
    }

    // The same control on both surfaces: the Hero, where a task that has not
    // started yet picks what it will run under, and the header, where a
    // running task switches. One is not a staged copy of the other — a blank
    // task is a real task with a real log, so the Hero writes the selection
    // straight through and the first step renders under it.
    const disposers = [
      scope.slots.inject('conversation.hero.controls', () => scope.slots.register({
        name: 'conversation.hero.controls',
        id: 'prompt-preset',
        // After the agent-preset chip: a preset composes the task, a prompt
        // preset shapes the prompt that composition produces.
        order: 10,
        locale: 'settings.promptPreset',
        inject: seatInjected,
      }, PromptPresetSeat)),
      scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'prompt-preset',
        // Right after the static agent-preset label at -10, inside the header's
        // leading band for what a task is running under.
        order: -9,
        locale: 'settings.promptPreset',
        inject: seatInjected,
      }, PromptPresetSeat)),
    ]
    return () => { for (const dispose of disposers) dispose() }
  })
}
