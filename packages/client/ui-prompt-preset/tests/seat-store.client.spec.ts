import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptPresetRoster } from '@deepseek-ai/dsh-prompt-presets/types'
import { PromptPresetSeatController } from '../src/client/seat-store.ts'

const SESSION = SessionId('task')

const ROSTER: PromptPresetRoster = {
  presets: [{ promptPreset: 'shout', name: 'Shout', rules: [], source: 'user', isDefault: false }],
  default: '',
  revision: 1,
  writable: true,
  limits: { maxPresets: 8, maxRules: 8, maxPatternLength: 64, maxTextBytes: 1024 },
  protectedSections: [],
}

/** The Remote double, with every call recorded. */
function bench(options: { unavailable?: boolean; refuse?: boolean } = {}) {
  const ctx = new Context()
  const calls: string[] = []
  const promptPresets = {
    list: () => {
      calls.push('list')
      return Promise.resolve(options.unavailable === true
        ? { ok: false as const, error: new RemoteError('gateway/invocation-unavailable', 'no store', { endpoint: 'promptPresets.list' }) }
        : { ok: true as const, value: ROSTER })
    },
    select: (_session: unknown, id: string | null) => {
      calls.push(`select:${String(id)}`)
      return Promise.resolve(options.refuse === true
        ? { ok: false as const, error: new RemoteError('gateway/internal', 'offline', {}) }
        : { ok: true as const, value: id })
    },
  }
  const remote = new TestRemote(ctx, {})
  ctx.provide('remote.promptPresets', promptPresets as never)
  Object.assign(remote, { promptPresets })
  return { ctx, calls, promptPresets }
}

describe('the switcher controller', () => {
  it('publishes the stored presets', async () => {
    const { ctx } = bench()
    const seat = new PromptPresetSeatController(ctx, () => SESSION)
    await seat.load()
    expect(seat.store.getSnapshot()).toMatchObject({
      status: 'ready',
      options: [{ id: 'shout', name: 'Shout' }],
    })
  })

  it('renders nothing when the deployment composes no store', async () => {
    const { ctx } = bench({ unavailable: true })
    const seat = new PromptPresetSeatController(ctx, () => SESSION)
    await seat.load()
    expect(seat.store.getSnapshot()).toMatchObject({ status: 'unavailable', options: [] })
  })

  it('drops a roster that arrives after a newer one', async () => {
    const { ctx } = bench()
    const seat = new PromptPresetSeatController(ctx, () => SESSION)
    const first = seat.load()
    const second = seat.load()
    await Promise.all([first, second])
    expect(seat.store.getSnapshot().options).toHaveLength(1)
  })

  it('writes a switch straight through, and clears a selection with the empty id', async () => {
    const { ctx, calls } = bench()
    const seat = new PromptPresetSeatController(ctx, () => SESSION)
    await seat.select('shout')
    await seat.select('')
    expect(calls).toEqual(['select:shout', 'select:null'])
  })

  it('writes nothing without a task', async () => {
    const { ctx, calls } = bench()
    const seat = new PromptPresetSeatController(ctx, () => undefined)
    await seat.select('shout')
    expect(calls).toEqual([])
  })

  it('surfaces a refused switch until it is read', async () => {
    const { ctx } = bench({ refuse: true })
    const seat = new PromptPresetSeatController(ctx, () => SESSION)
    await seat.select('shout')
    expect(seat.store.getSnapshot()).toMatchObject({ switching: false, error: 'offline' })
    seat.clearError()
    expect(seat.store.getSnapshot().error).toBeNull()
  })

  it('refuses a second switch while one is in flight', async () => {
    const { ctx, calls } = bench()
    const seat = new PromptPresetSeatController(ctx, () => SESSION)
    const first = seat.select('shout')
    const second = seat.select('shout')
    await Promise.all([first, second])
    expect(calls).toEqual(['select:shout'])
  })
})
