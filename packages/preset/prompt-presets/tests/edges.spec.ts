import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { cleanup, harness } from './harness.ts'

afterEach(cleanup)

const IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'
const SIGNAL = new AbortController().signal
const STACK = {
  name: 'Stack',
  rules: [{ kind: 'prepend' as const, text: 'AHEAD' }, { kind: 'append' as const, text: 'BEHIND' }],
}
const WHOLE = { name: 'Whole', rules: [{ kind: 'replace' as const, text: 'ONLY' }] }
const PRESETS = {
  shout: { name: 'Shout', rules: [{ kind: 'append' as const, text: 'BE LOUD.' }] },
  picky: { name: 'Picky', rules: [{ kind: 'remove' as const, sections: ['tool:absent'] }] },
}

describe('assemblies that belong to no session', () => {
  it('overrides nothing, even while a session has a preset selected', async () => {
    const bench = await harness({ presets: PRESETS })
    await bench.store.select(bench.agent(), 'shout')

    expect(renderPrompt(await bench.ctx.systemPrompt.assemble())).toBe(IDENTITY)
  })

  it('still applies an explicit candidate, and reports its warnings without a session', async () => {
    const bench = await harness({ presets: PRESETS })
    const warn = vi.spyOn(bench.ctx.logger, 'warn').mockImplementation(() => {})

    const assembly = await bench.ctx.systemPrompt.assemble({
      promptPresetOverride: { preset: PRESETS.picky },
    })
    expect(renderPrompt(assembly)).toBe(IDENTITY)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown-section'))
  })

  it('applies a candidate that changes the prompt', async () => {
    const bench = await harness({ presets: PRESETS })
    const assembly = await bench.ctx.systemPrompt.assemble({
      promptPresetOverride: { preset: PRESETS.shout },
    })
    expect(renderPrompt(assembly)).toBe(`${IDENTITY}\n\nBE LOUD.`)
  })
})

describe('a selection that cannot be recorded', () => {
  it('rejects that caller alone and lets the one queued behind it through', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    const append = vi.spyOn(agent.session, 'append')
      .mockImplementationOnce(() => { throw new Error('log is sealed') })

    const first = bench.store.select(agent, 'shout')
    const second = bench.store.select(agent, 'picky')
    await expect(first).rejects.toThrow('log is sealed')
    await expect(second).resolves.toBe('picky')
    expect(append).toHaveBeenCalledTimes(2)
  })

  it('reports a thrown value that carries no message', async () => {
    const bench = await harness({ presets: PRESETS, default: 'shout' })
    const agent = bench.agent()
    vi.spyOn(agent.session, 'append').mockImplementation(() => { throw 'sealed' })
    const warn = vi.spyOn(bench.ctx.logger, 'warn').mockImplementation(() => {})

    await bench.ctx.parallel('agent/created', { agent, source: 'startup' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sealed'))
  })
})

describe('a write the settings provider refuses', () => {
  it('passes through a failure that is not a stale revision', async () => {
    const bench = await harness()
    vi.spyOn(bench.ctx.settings, 'mutate').mockRejectedValue(new Error('disk is full'))

    await expect(bench.store.create('mine', { name: 'Mine', rules: [] }))
      .rejects.toThrow('disk is full')
  })
})

describe('preview attribution', () => {
  it('names the rule behind every section a rule created', async () => {
    const bench = await harness()
    const agent = bench.agent()

    const stacked = await bench.store.preview(agent, STACK, SIGNAL)
    expect(stacked.sections.map(section => [section.name, section.fromRule])).toEqual([
      ['prompt-preset:prepend-0', 0],
      ['harness:identity', undefined],
      ['deployment:persona-prefix', undefined],
      ['deployment:persona-suffix', undefined],
      ['prompt-preset:append-1', 1],
    ])

    const whole = await bench.store.preview(agent, WHOLE, SIGNAL)
    expect(whole.sections).toEqual([{ name: 'prompt-preset:replace-0', text: 'ONLY', fromRule: 0 }])
  })

  it('attributes nothing to a registered section that merely looks rule-created', async () => {
    const bench = await harness(
      { presets: { shout: { name: 'Shout', rules: [{ kind: 'append', text: 'BE LOUD.' }] } } },
      [{ name: 'prompt-preset:append-later', order: 1, text: 'not ours' }],
    )
    const preview = await bench.store.preview(bench.agent(), PRESETS.shout, SIGNAL)

    expect(preview.sections.find(section => section.name === 'prompt-preset:append-later'))
      .toEqual({ name: 'prompt-preset:append-later', text: 'not ours' })
  })
})
