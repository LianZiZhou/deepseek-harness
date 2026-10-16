/**
 * Registration: one apply mounts the settings section and the task switcher,
 * each deferring until the slot it fills has been declared. A preset edited
 * anywhere, and a reconnect, both move every surface that is already showing.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptPresetInput, PromptPresetRoster } from '@deepseek-ai/dsh-prompt-presets/types'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-prompt-preset/client'
import { PromptPresetSection } from '../src/client/PromptPresetSection.tsx'
import type { PromptPresetSectionInjected } from '../src/client/PromptPresetSection.tsx'
import { PromptPresetSeat } from '../src/client/PromptPresetSeat.tsx'
import type { PromptPresetSeatInjected } from '../src/client/PromptPresetSeat.tsx'
import { apply as hostApply } from '../src/index.ts'

// This lane has no jsdom `window`, so browser-language detection never runs and
// a fresh LocaleRuntime opens on FALLBACK_LOCALE (en); the bench stages zh.

const SHOUT = {
  promptPreset: 'shout',
  name: 'Shout',
  rules: [],
  source: 'user' as const,
  isDefault: false,
}

/** The context, the slot registry, and every Remote call this apply makes. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const calls: string[] = []
  // The host's roster, moved by the writes below so a surface that re-reads
  // after a write sees what it just wrote.
  let rows = [SHOUT]
  const roster = (): PromptPresetRoster => ({
    presets: rows,
    default: '',
    revision: 2,
    writable: true,
    limits: { maxPresets: 8, maxRules: 8, maxPatternLength: 64, maxTextBytes: 1024 },
    protectedSections: [],
  })
  const promptPresets = {
    list: () => { calls.push('list'); return Promise.resolve({ ok: true as const, value: roster() }) },
    create: (id: string, document: PromptPresetInput) => {
      calls.push(`create:${id}`)
      const row = { ...SHOUT, promptPreset: id, name: document.name }
      rows = [...rows, row]
      return Promise.resolve({ ok: true as const, value: row })
    },
    update: (id: string, document: PromptPresetInput) => {
      calls.push(`update:${id}`)
      rows = rows.map(row => row.promptPreset === id ? { ...row, name: document.name } : row)
      return Promise.resolve({ ok: true as const, value: rows[0] })
    },
    deletePreset: (id: string) => {
      calls.push(`delete:${id}`)
      rows = rows.filter(row => row.promptPreset !== id)
      return Promise.resolve({ ok: true as const, value: undefined })
    },
    setDefault: (id: string) => { calls.push(`default:${id}`); return Promise.resolve({ ok: true as const, value: undefined }) },
    select: (_session: unknown, id: string | null) => {
      calls.push(`select:${String(id)}`)
      return Promise.resolve({ ok: true as const, value: id })
    },
    preview: () => {
      calls.push('preview')
      return Promise.resolve({
        ok: true as const,
        value: {
          sections: [], prompt: '', baselineSections: [], baselinePrompt: '', warnings: [],
        },
      })
    },
  }
  const remote = new TestRemote(ctx, {})
  ctx.provide('remote.promptPresets', promptPresets as never)
  Object.assign(remote, { promptPresets })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, calls, remote }
}

/** The root declarations the settings section waits for. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      conversation: { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

/** The conversation's own declarations, which both switchers wait for. */
function declareConversation(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'conversation',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.hero.controls': { kind: 'list', scope: 'session-maybe' },
    },
  } as never, () => null)
}

/** One task's binding, with its own fiber so a spec can unbind it. */
async function bindingOf(parent: Context, id: string) {
  let inner: Context | undefined
  const fiber = parent.plugin({ apply: (scope: Context) => { inner = scope } })
  await fiber.await()
  return { binding: { sessionId: SessionId(id), ctx: inner! }, fiber }
}

/** A sessions double whose list can be moved and whose changes are pushed. */
function sessionsDouble(ctx: Context, state: { byId: Record<string, { id: string; mainView?: boolean }> }) {
  const listeners = new Set<() => void>()
  const bindings = new Map<string, { sessionId: SessionId; ctx: Context }>()
  return {
    /** Replace the object one id binds to, the way a reconnect does. */
    rebind: (id: string, binding: { sessionId: SessionId; ctx: Context }) => { bindings.set(id, binding) },
    list: {
      getSnapshot: () => ({
        byId: Object.fromEntries(Object.entries(state.byId).map(([id, row]) => [
          id,
          { ...row, retainedBy: row.mainView === true ? { mainView: 1 } : {} },
        ])),
      }),
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    binding: (id: string) => {
      if (state.byId[id] === undefined) return undefined
      let binding = bindings.get(id)
      if (binding === undefined) {
        binding = { sessionId: SessionId(id), ctx }
        bindings.set(id, binding)
      }
      return binding
    },
    /** Push a list change the way the runtime's store does. */
    notify: () => { for (const fn of listeners) fn() },
  }
}

/** Mount the plugin with both slot declarations and a sessions double in place. */
async function mounted(options: { byId?: Record<string, { id: string; mainView?: boolean }> } = {}) {
  const stage = await bench()
  const root = declareRoot(stage.slots)
  const conversation = declareConversation(stage.slots)
  const sessions = sessionsDouble(stage.ctx, { byId: options.byId ?? {} })
  stage.ctx.provide('conversation', {} as never)
  stage.ctx.provide('sessions', sessions as never)
  const fiber = stage.ctx.plugin({ inject: [...inject, 'conversation'], apply })
  await fiber.await()
  return { ...stage, fiber, sessions, root, conversation }
}

/** The section's injected face, as the renderer reads it. */
function sectionFace(slots: SlotRegistry): PromptPresetSectionInjected {
  return slots.entries('settings.section')[0]!.inject!() as Record<string, unknown> & PromptPresetSectionInjected
}

/** The switcher's injected face for one session, as the renderer reads it. */
function seatFace(
  slots: SlotRegistry,
  sessionId: string | undefined,
  slot: 'conversation.session.header.actions' | 'conversation.hero.controls' = 'conversation.session.header.actions',
): PromptPresetSeatInjected {
  const entry = slots.entries(slot)[0]!
  return entry.inject!(sessionId as never) as Record<string, unknown> & PromptPresetSeatInjected
}

describe('the plugin halves', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale', 'remote', 'remote.promptPresets'])
  })
})

describe('registration', () => {
  it('mounts the settings section after Agent presets and before archived tasks', async () => {
    const { slots } = await mounted()
    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(PromptPresetSection)
    expect(section.options).toMatchObject({ id: 'prompt-presets', order: 22 })
    expect(resolveSlotLabel(section.options.label)).toBe('提示词预设')
  })

  it('mounts the switcher right after the static mode label', async () => {
    const { slots } = await mounted()
    const seat = slots.entries('conversation.session.header.actions')[0]!
    expect(seat.component).toBe(PromptPresetSeat)
    expect(seat.options).toMatchObject({ id: 'prompt-preset', order: -9 })
  })

  it('mounts the same switcher on the Hero, after the mode chip', async () => {
    const { slots } = await mounted({ byId: { task: { id: 'task' } } })
    const hero = slots.entries('conversation.hero.controls')[0]!
    expect(hero.component).toBe(PromptPresetSeat)
    expect(hero.options).toMatchObject({ id: 'prompt-preset', order: 10 })

    // One controller behind both surfaces, so a task picked on the Hero is
    // what the header shows once the task starts.
    expect(seatFace(slots, 'task', 'conversation.hero.controls').hooks.promptPresetSeat)
      .toBe(seatFace(slots, 'task').hooks.promptPresetSeat)
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    ctx.provide('conversation', {} as never)
    ctx.provide('sessions', sessionsDouble(ctx, { byId: {} }) as never)
    await ctx.plugin({ inject: [...inject, 'conversation'], apply }).await()

    declareRoot(slots)
    declareConversation(slots)

    await vi.waitFor(() => {
      expect(slots.entries('settings.section')).toHaveLength(1)
      expect(slots.entries('conversation.session.header.actions')).toHaveLength(1)
      expect(slots.entries('conversation.hero.controls')).toHaveLength(1)
    })
  })

  it('drops every surface on disposal', async () => {
    const { slots, fiber } = await mounted()
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(slots.entries('conversation.hero.controls')).toHaveLength(0)
  })
})

describe('the section face', () => {
  it('routes every editor action to one controller', async () => {
    const { slots, calls } = await mounted()
    const section = sectionFace(slots)

    await section.load()
    section.beginCreate()
    section.patchCreate({ id: 'terse', name: 'Terse' })
    expect(section.createBlocker()).toBeUndefined()
    await section.confirmCreate()
    section.setName('Terser')
    section.setDescription('short')
    section.addRule('append')
    const key = section.hooks.promptPresetSection.getSnapshot().draft?.rules[0]?.key ?? ''
    section.patchRule(key, { kind: 'append', text: 'BE BRIEF.' })
    section.setRuleEnabled(key, false)
    section.moveRule(key, 1)
    section.removeRule(key)
    await section.save()
    section.discard()
    await section.setDefault('shout')
    section.confirmDelete('shout')
    await section.remove()

    expect(calls).toContain('create:terse')
    expect(calls).toContain('update:terse')
    expect(calls).toContain('default:shout')
    expect(calls).toContain('delete:shout')
  })

  it('routes the switch guard and the create dialog cancellations', async () => {
    const { slots } = await mounted()
    const section = sectionFace(slots)
    await section.load()

    section.beginCreate()
    section.cancelCreate()
    expect(section.hooks.promptPresetSection.getSnapshot().create).toBeNull()

    section.select('shout')
    section.setName('Louder')
    section.select('shout')
    section.cancelSwitch()
    section.confirmSwitch()
    expect(section.hooks.promptPresetSection.getSnapshot().selectedId).toBe('shout')
  })

  it('reports whether a task is open for the preview to run against', async () => {
    const blank = await mounted()
    expect(sectionFace(blank.slots).hasSession()).toBe(false)

    const open = await mounted({ byId: { task: { id: 'task', mainView: true } } })
    const section = sectionFace(open.slots)
    expect(section.hasSession()).toBe(true)
    await section.load()
    section.select('shout')
    section.refreshPreview()
    await vi.waitFor(() => { expect(open.calls).toContain('preview') })
  })

  it('follows whichever task the main view shows', async () => {
    const state: Record<string, { id: string; mainView?: boolean }> = {}
    const { slots, sessions, calls } = await mounted({ byId: state })
    const section = sectionFace(slots)
    await section.load()
    section.select('shout')
    section.refreshPreview()
    await Promise.resolve()
    // No retained task yet, so the preview has nothing to assemble against.
    expect(calls).not.toContain('preview')

    state['task'] = { id: 'task', mainView: true }
    sessions.notify()
    section.refreshPreview()
    await vi.waitFor(() => { expect(calls).toContain('preview') })
  })
})

describe('the switcher face', () => {
  it('hands one controller per bound task, and an inert one without a task', async () => {
    const { slots, calls } = await mounted({ byId: { task: { id: 'task' } } })

    const seat = seatFace(slots, 'task')
    await seat.load()
    await seat.select('shout')
    seat.clearError()
    expect(calls).toContain('select:shout')
    // The same binding gets the same controller, so its roster is read once.
    expect(seatFace(slots, 'task').hooks.promptPresetSeat).toBe(seat.hooks.promptPresetSeat)

    // One shared inert controller answers every render that has no task, and
    // writes nothing because there is nothing to write to.
    const unbound = seatFace(slots, undefined)
    const missing = seatFace(slots, 'gone')
    expect(missing.hooks.promptPresetSeat).toBe(unbound.hooks.promptPresetSeat)
    calls.length = 0
    await unbound.load()
    await unbound.select('shout')
    unbound.clearError()
    expect(calls).toEqual(['list'])
  })

  it('stops writing for a stale binding and forgets it when the task goes', async () => {
    const stage = await bench()
    declareRoot(stage.slots)
    declareConversation(stage.slots)
    const sessions = sessionsDouble(stage.ctx, { byId: { task: { id: 'task' } } })
    stage.ctx.provide('conversation', {} as never)
    stage.ctx.provide('sessions', sessions as never)
    await stage.ctx.plugin({ inject: [...inject, 'conversation'], apply }).await()

    const first = await bindingOf(stage.ctx, 'task')
    sessions.rebind('task', first.binding)
    const seat = seatFace(stage.slots, 'task')
    await seat.select('shout')
    expect(stage.calls).toContain('select:shout')

    // A reconnect hands the same task a new binding; the controller the old
    // one owns must not keep writing on its behalf.
    const second = await bindingOf(stage.ctx, 'task')
    sessions.rebind('task', second.binding)
    stage.calls.length = 0
    await seat.select('terse')
    expect(stage.calls).toEqual([])

    // And the fiber that owned it releases it, so nothing refreshes it later.
    await first.fiber.dispose()
    stage.calls.length = 0
    stage.remote.emit('prompt-preset/changed', [])
    await Promise.resolve()
    await Promise.resolve()
    expect(stage.calls).toEqual([])
    await second.fiber.dispose()
  })
})

describe('roster refresh', () => {
  it('re-reads a showing section on its own namespace and ignores others', async () => {
    const { slots, calls, remote } = await mounted()
    const section = sectionFace(slots)
    await section.load()
    const before = calls.length

    remote.emit('settings/document-updated', ['prompt-presets', 1])
    await vi.waitFor(() => { expect(calls.length).toBe(before + 1) })
    const settled = calls.length

    remote.emit('settings/document-updated', ['llm-deepseek', 1])
    await Promise.resolve()
    expect(calls.length).toBe(settled)
  })

  it('leaves a section nobody opened alone', async () => {
    const { calls, remote } = await mounted()
    calls.length = 0

    remote.emit('prompt-preset/changed', [])
    await Promise.resolve()
    await Promise.resolve()

    // Nothing is showing: no section read, and no seat bound to read for.
    expect(calls).toEqual([])
  })

  it('re-reads every showing surface on a preset edit and on a reconnect', async () => {
    const { ctx, slots, calls, remote } = await mounted({ byId: { task: { id: 'task' } } })
    const section = sectionFace(slots)
    await section.load()
    await seatFace(slots, 'task').load()
    const before = calls.length

    remote.emit('prompt-preset/changed', [])
    await vi.waitFor(() => { expect(calls.length).toBe(before + 2) })
    const edited = calls.length

    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(calls.length).toBe(edited + 2) })
  })

  it('re-reads a bound switcher after the section writes the roster', async () => {
    const { slots, calls } = await mounted({ byId: { task: { id: 'task' } } })
    const section = sectionFace(slots)
    await section.load()
    await seatFace(slots, 'task').load()
    calls.length = 0

    await section.setDefault('shout')

    // The switcher shows what the section just stored, without waiting for the
    // Host to push anything back.
    expect(calls).toEqual(['default:shout', 'list', 'list'])
  })
})
