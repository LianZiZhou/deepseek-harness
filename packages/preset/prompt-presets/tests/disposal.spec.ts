import { afterEach, describe, expect, it } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { cleanup, harness } from './harness.ts'

afterEach(cleanup)

const IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'
const PRESETS = { shout: { name: 'Shout', rules: [{ kind: 'append' as const, text: 'BE LOUD.' }] } }

describe('disposing the store', () => {
  it('removes the override, the settings namespace, the projection unit, and the mirror', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    await bench.store.select(agent, 'shout')

    // Live: every registration answers.
    expect(renderPrompt(await bench.ctx.systemPrompt.assemble(assembleContextFor(agent))))
      .toContain('BE LOUD.')
    expect(bench.ctx.settings.describe().some(entry => entry.ns === 'prompt-presets')).toBe(true)
    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBe('shout')
    expect(bench.ctx.get('promptPresets')).toBeDefined()

    await bench.fiber.dispose()

    // Gone: the prompt is untransformed and nothing this package owned remains.
    expect(renderPrompt(await bench.ctx.systemPrompt.assemble(assembleContextFor(agent))))
      .toBe(IDENTITY)
    expect(bench.ctx.settings.describe().some(entry => entry.ns === 'prompt-presets')).toBe(false)
    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBeUndefined()
    expect(bench.ctx.get('promptPresets')).toBeUndefined()
  })

  it('frees the single override slot, so a replacement can take it', async () => {
    const bench = await harness({ presets: PRESETS })
    // The store holds the one global slot while it is live.
    expect(() => bench.ctx.systemPrompt.finalize(assembly => assembly)).toThrow(/already registered/)

    await bench.fiber.dispose()
    expect(() => bench.ctx.systemPrompt.finalize(assembly => assembly)).not.toThrow()
  })

  it('stops announcing roster changes and stops mirroring selections', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    let changes = 0
    let selections = 0
    bench.ctx.on('prompt-preset/changed', () => { changes += 1 })
    bench.ctx.on('prompt-preset/selected', () => { selections += 1 })
    await bench.store.select(agent, 'shout')
    expect(selections).toBe(1)

    await bench.fiber.dispose()
    agent.session.append('prompt-preset/selected', { promptPreset: null })
    expect(selections).toBe(1)
    expect(changes).toBe(0)
  })
})
