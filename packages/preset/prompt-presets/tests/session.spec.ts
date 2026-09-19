import { afterEach, describe, expect, it } from 'vitest'
import { promptPresetProjectionDefinition } from '@deepseek-ai/dsh-prompt-presets'
import { cleanup, harness } from './harness.ts'
import type { Harness } from './harness.ts'

afterEach(cleanup)

const PRESETS = {
  a: { name: 'A', rules: [] },
  b: { name: 'B', rules: [] },
}

const definition = promptPresetProjectionDefinition

/** Collect every selection this composition commits, in log order. */
function recordSelections(bench: Harness): (string | null)[] {
  const recorded: (string | null)[] = []
  bench.ctx.on('session/event', (_session, event) => {
    if (event.type === 'prompt-preset/selected') recorded.push(event.data.promptPreset)
  })
  return recorded
}

describe('the promptPreset projection', () => {
  it('starts empty and advances only on a selection', () => {
    expect(definition.init()).toBeNull()
    expect(definition.apply('a', { type: 'prompt-preset/selected', data: { promptPreset: 'b' } } as never))
      .toBe('b')
    expect(definition.apply('a', { type: 'prompt-preset/selected', data: { promptPreset: null } } as never))
      .toBeNull()
  })

  it('returns the identical state for an unrelated event', () => {
    const state = 'a'
    expect(definition.apply(state, { type: 'turn/start', data: { turn: 1 } } as never)).toBe(state)
  })

  it('publishes the state as its own wire view', () => {
    expect(definition.wire.view('a')).toBe('a')
    expect(definition.wire.view(null)).toBeNull()
  })

  it('folds the live log, so the last selection is what a session runs', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()

    await bench.store.select(agent, 'a')
    await bench.store.select(agent, 'b')
    await bench.store.select(agent, null)
    await bench.store.select(agent, 'a')
    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBe('a')
  })
})

describe('selecting a preset', () => {
  it('records one event per change and none for a repeat', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    const recorded = recordSelections(bench)

    await bench.store.select(agent, 'a')
    await bench.store.select(agent, 'a')
    expect(recorded).toEqual(['a'])
  })

  it('serializes concurrent selections, so the log order matches the call order', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    const recorded = recordSelections(bench)

    await Promise.all([
      bench.store.select(agent, 'a'),
      bench.store.select(agent, 'b'),
      bench.store.select(agent, null),
    ])
    expect(recorded).toEqual(['a', 'b', null])
    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBeNull()
  })

  it('leaves the next caller unaffected when one selection is refused', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()

    const refused = bench.store.select(agent, 'absent')
    const accepted = bench.store.select(agent, 'a')
    await expect(refused).rejects.toMatchObject({ code: 'prompt-preset/not-found' })
    await expect(accepted).resolves.toBe('a')
  })

  it('republishes each committed selection as a process-local event', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    const seen: (string | null)[] = []
    bench.ctx.on('prompt-preset/selected', (_sessionId, promptPreset) => { seen.push(promptPreset) })

    await bench.store.select(agent, 'a')
    await bench.store.select(agent, null)
    expect(seen).toEqual(['a', null])
  })
})
