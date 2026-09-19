import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptPresetInput, PromptPresetRoster } from '@deepseek-ai/dsh-prompt-presets/types'
import { PromptPresetSectionController } from '../src/client/section-store.ts'

const SESSION = SessionId('task')

/** One roster the double answers `list` with. */
function roster(presets: PromptPresetRoster['presets']): PromptPresetRoster {
  return {
    presets,
    default: '',
    revision: 3,
    writable: true,
    limits: { maxPresets: 8, maxRules: 8, maxPatternLength: 64, maxTextBytes: 1024 },
    protectedSections: [],
  }
}

const SHOUT = {
  promptPreset: 'shout',
  name: 'Shout',
  rules: [{ kind: 'append' as const, text: 'BE LOUD.' }],
  source: 'user' as const,
  isDefault: false,
}

/** The Remote double, with every call recorded. */
function bench(options: { failList?: 'unavailable' | 'error' } = {}) {
  const ctx = new Context()
  const calls: string[] = []
  let rows: PromptPresetRoster['presets'] = [SHOUT]
  const promptPresets = {
    list: () => {
      calls.push('list')
      if (options.failList === 'unavailable') {
        return Promise.resolve({
          ok: false as const,
          error: new RemoteError('gateway/invocation-unavailable', 'no store', { endpoint: 'promptPresets.list' }),
        })
      }
      if (options.failList === 'error') {
        return Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', 'boom', {}) })
      }
      return Promise.resolve({ ok: true as const, value: roster(rows) })
    },
    create: (id: string, document: PromptPresetInput) => {
      calls.push(`create:${id}`)
      rows = [...rows, { ...SHOUT, promptPreset: id, name: document.name, rules: [] }]
      return Promise.resolve({ ok: true as const, value: { ...SHOUT, promptPreset: id, name: document.name } })
    },
    update: (id: string, document: PromptPresetInput) => {
      calls.push(`update:${id}:${String(document.rules.length)}`)
      rows = rows.map(row => row.promptPreset === id
        ? { ...row, name: document.name, rules: [...document.rules] }
        : row)
      return Promise.resolve({ ok: true as const, value: rows[0] })
    },
    deletePreset: (id: string) => {
      calls.push(`delete:${id}`)
      rows = rows.filter(row => row.promptPreset !== id)
      return Promise.resolve({ ok: true as const, value: undefined })
    },
    setDefault: (id: string) => {
      calls.push(`default:${id}`)
      return Promise.resolve({ ok: true as const, value: undefined })
    },
    select: () => Promise.resolve({ ok: true as const, value: null }),
    preview: (_session: unknown, document: PromptPresetInput | null) => {
      calls.push(`preview:${String(document?.rules.length ?? 'null')}`)
      return Promise.resolve({
        ok: true as const,
        value: {
          sections: [{ name: 'harness:identity', text: 'identity' }],
          prompt: 'identity',
          baselineSections: [{ name: 'harness:identity', text: 'identity' }],
          baselinePrompt: 'identity',
          warnings: [],
        },
      })
    },
  }
  const remote = new TestRemote(ctx, {})
  ctx.provide('remote.promptPresets', promptPresets as never)
  Object.assign(remote, { promptPresets })
  return { ctx, calls, controller: new PromptPresetSectionController(ctx) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('reading the roster', () => {
  it('publishes the stored presets', async () => {
    const { controller } = bench()
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', writable: true })
    expect(controller.store.getSnapshot().rows).toHaveLength(1)
  })

  it('renders nothing when the deployment composes no store, and reports any other failure', async () => {
    const missing = bench({ failList: 'unavailable' })
    await missing.controller.load()
    expect(missing.controller.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: null })

    const broken = bench({ failList: 'error' })
    await broken.controller.load()
    expect(broken.controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('coalesces concurrent reads and re-runs once for the ones that arrived meanwhile', async () => {
    const { controller, calls } = bench()
    await Promise.all([controller.load(), controller.load(), controller.load()])
    expect(calls.filter(call => call === 'list')).toHaveLength(2)
  })
})

describe('editing one preset', () => {
  it('stages every edit and writes nothing until save', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.select('shout')
    controller.setName('Louder')
    controller.patchRule(
      controller.store.getSnapshot().draft?.rules[0]?.key ?? '',
      { kind: 'append', text: 'LOUDER.' },
    )
    expect(controller.store.getSnapshot().draft).toMatchObject({ name: 'Louder', dirty: true })
    expect(calls.filter(call => call.startsWith('update'))).toEqual([])

    await controller.save()
    expect(calls).toContain('update:shout:1')
    expect(controller.store.getSnapshot().draft?.dirty).toBe(false)
  })

  it('refuses to save while a rule is unusable', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.select('shout')
    controller.addRule('remove')
    await controller.save()
    expect(calls.filter(call => call.startsWith('update'))).toEqual([])
  })

  it('asks before abandoning a dirty draft, and honours either answer', async () => {
    const { controller } = bench()
    await controller.load()
    controller.beginCreate()
    controller.patchCreate({ id: 'other', name: 'Other' })
    await controller.confirmCreate()
    controller.select('shout')
    controller.setName('Louder')

    controller.select('other')
    expect(controller.store.getSnapshot()).toMatchObject({ pendingSwitch: 'other', selectedId: 'shout' })
    controller.cancelSwitch()
    expect(controller.store.getSnapshot().selectedId).toBe('shout')

    controller.select('other')
    controller.confirmSwitch()
    expect(controller.store.getSnapshot()).toMatchObject({ selectedId: 'other', pendingSwitch: null })
  })

  it('moves a rule without remounting it, and stops at the ends', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('shout')
    controller.addRule('prepend')
    const [first, second] = controller.store.getSnapshot().draft?.rules ?? []
    controller.moveRule(second!.key, -1)
    expect(controller.store.getSnapshot().draft?.rules.map(rule => rule.key))
      .toEqual([second!.key, first!.key])
    controller.moveRule(second!.key, -1)
    expect(controller.store.getSnapshot().draft?.rules.map(rule => rule.key))
      .toEqual([second!.key, first!.key])
  })

  it('turns one rule off and removes another', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('shout')
    const key = controller.store.getSnapshot().draft?.rules[0]?.key ?? ''
    controller.setRuleEnabled(key, false)
    expect(controller.store.getSnapshot().draft?.rules[0]?.rule.enabled).toBe(false)
    controller.removeRule(key)
    expect(controller.store.getSnapshot().draft?.rules).toEqual([])
  })
})

describe('the preview', () => {
  it('collapses a burst of edits into one call, and only the newest answer lands', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.setPreviewSession(SESSION)
    controller.select('shout')
    await vi.runOnlyPendingTimersAsync()
    const before = calls.filter(call => call.startsWith('preview')).length

    controller.setName('a')
    controller.addRule('append')
    controller.addRule('append')
    await vi.advanceTimersByTimeAsync(400)
    expect(calls.filter(call => call.startsWith('preview')).length).toBe(before + 1)
    expect(controller.store.getSnapshot().preview).toMatchObject({ status: 'ready', prompt: 'identity' })
  })

  it('draws nothing while no task is open', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.select('shout')
    await vi.runOnlyPendingTimersAsync()
    expect(calls.filter(call => call.startsWith('preview'))).toEqual([])
    expect(controller.store.getSnapshot().preview.status).toBe('ready')
  })

  it('fires nothing after teardown', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.setPreviewSession(SESSION)
    controller.select('shout')
    const before = calls.filter(call => call.startsWith('preview')).length
    // A rule edit is what schedules the debounced redraw; a rename redraws
    // nothing, so it would leave no timer for disposal to clear.
    controller.addRule('append')
    controller.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.filter(call => call.startsWith('preview')).length).toBe(before)
  })
})

describe('roster writes', () => {
  it('creates a preset and opens it', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.beginCreate()
    controller.patchCreate({ id: 'terse', name: 'Terse' })
    expect(controller.createBlocker()).toBeUndefined()
    await controller.confirmCreate()
    expect(calls).toContain('create:terse')
    expect(controller.store.getSnapshot()).toMatchObject({ selectedId: 'terse', create: null })
  })

  it('refuses a malformed or taken id before calling the Host', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.beginCreate()
    controller.patchCreate({ id: 'Not Valid' })
    expect(controller.createBlocker()).toEqual({ key: 'idInvalid' })
    await controller.confirmCreate()
    controller.patchCreate({ id: 'shout' })
    expect(controller.createBlocker()).toEqual({ key: 'idTaken' })
    expect(calls.filter(call => call.startsWith('create'))).toEqual([])
  })

  it('deletes after a confirmation and closes the editor when it was open', async () => {
    const { controller, calls } = bench()
    await controller.load()
    controller.select('shout')
    controller.confirmDelete('shout')
    await controller.remove()
    expect(calls).toContain('delete:shout')
    expect(controller.store.getSnapshot()).toMatchObject({ draft: null, selectedId: null })
  })

  it('makes one preset the default', async () => {
    const { controller, calls } = bench()
    await controller.load()
    await controller.setDefault('shout')
    expect(calls).toContain('default:shout')
  })
})
