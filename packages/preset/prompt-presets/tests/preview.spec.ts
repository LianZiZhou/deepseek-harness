import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, harness } from './harness.ts'
import type { PromptPresetInput } from '@deepseek-ai/dsh-prompt-presets'

afterEach(cleanup)

const IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'
const SIGNAL = new AbortController().signal
const PRESETS = {
  shout: { name: 'Shout', rules: [{ kind: 'append' as const, text: 'BE LOUD.' }] },
  takeover: { name: 'Takeover', rules: [{ kind: 'replace' as const, text: 'You are a calculator.' }] },
  picky: { name: 'Picky', rules: [{ kind: 'remove' as const, sections: ['tool:absent'] }] },
  silent: { name: 'Silent', rules: [{ kind: 'replace' as const, text: '' }] },
} satisfies Record<string, PromptPresetInput>

describe('previewing a preset', () => {
  it('shows the candidate beside the untransformed baseline', async () => {
    const bench = await harness({ presets: PRESETS })
    const preview = await bench.store.preview(bench.agent(), PRESETS.shout, SIGNAL)

    expect(preview.baselinePrompt).toBe(IDENTITY)
    expect(preview.prompt).toBe(`${IDENTITY}\n\nBE LOUD.`)
    expect(preview.warnings).toEqual([])
  })

  it('renders each section on its own, attributing the ones a rule created', async () => {
    const bench = await harness({ presets: PRESETS })
    const preview = await bench.store.preview(bench.agent(), PRESETS.shout, SIGNAL)

    expect(preview.sections.map(section => [section.name, section.text, section.fromRule]))
      .toContainEqual(['prompt-preset:append-0', 'BE LOUD.', 0])
    expect(preview.sections.find(section => section.name === 'harness:identity'))
      .toEqual({ name: 'harness:identity', text: IDENTITY })
  })

  it('marks a protected section the deployment keeps through a replace', async () => {
    const bench = await harness(
      { presets: PRESETS, protectedSections: ['tools:ptc-only'] },
      [{ name: 'tools:ptc-only', order: 1, text: 'Only call tools through code.' }],
    )
    const preview = await bench.store.preview(bench.agent(), PRESETS.takeover, SIGNAL)

    expect(preview.sections[0]).toMatchObject({ name: 'tools:ptc-only', protectedSection: true })
    expect(preview.warnings).toContainEqual({ code: 'protected-section-kept', rule: 0, section: 'tools:ptc-only' })
  })

  it('reports what a rule could not do as written', async () => {
    const bench = await harness({ presets: PRESETS })
    const preview = await bench.store.preview(bench.agent(), PRESETS.picky, SIGNAL)

    expect(preview.warnings).toEqual([{ code: 'unknown-section', rule: 0, section: 'tool:absent' }])
  })

  it('reports that the candidate replaced a section another contribution declared complete', async () => {
    const bench = await harness(
      { presets: PRESETS },
      [{ name: 'preset:persona', order: 1, text: 'You obey only this.', complete: true }],
    )
    const preview = await bench.store.preview(bench.agent(), PRESETS.shout, SIGNAL)

    expect(preview.baselinePrompt).toBe('You obey only this.')
    expect(preview.warnings)
      .toContainEqual({ code: 'complete-section-overridden', section: 'preset:persona' })
  })

  it('reports a candidate that would leave the model no prompt at all', async () => {
    const bench = await harness()
    const preview = await bench.store.preview(bench.agent(), PRESETS.silent, SIGNAL)

    expect(preview.prompt).toBe('')
    expect(preview.warnings).toContainEqual({ code: 'empty-prompt' })
  })

  it('previews the untransformed prompt for a null candidate', async () => {
    const bench = await harness({ presets: PRESETS })
    const preview = await bench.store.preview(bench.agent(), null, SIGNAL)

    expect(preview.prompt).toBe(preview.baselinePrompt)
    expect(preview.warnings).toEqual([])
  })

  it('previews a candidate the session has not selected, and selects nothing', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    await bench.store.preview(agent, PRESETS.takeover, SIGNAL)

    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBeNull()
  })

  it('previews against the session\'s own selection when asked for it', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    await bench.store.select(agent, 'takeover')
    const preview = await bench.store.preview(agent, PRESETS.shout, SIGNAL)

    // The baseline is the assembly with NO preset, not the session's current one.
    expect(preview.baselinePrompt).toBe(IDENTITY)
    expect(preview.prompt).toBe(`${IDENTITY}\n\nBE LOUD.`)
  })

  it('previews a draft nothing has stored yet', async () => {
    const bench = await harness()
    const preview = await bench.store.preview(
      bench.agent(),
      { name: 'Draft', rules: [{ kind: 'prepend', text: 'UNSAVED' }] },
      SIGNAL,
    )

    expect(preview.prompt).toBe(`UNSAVED

${IDENTITY}`)
    expect(preview.baselinePrompt).toBe(IDENTITY)
  })

  it('reports the baseline section by section, for a difference view', async () => {
    const bench = await harness({ presets: PRESETS })
    const preview = await bench.store.preview(bench.agent(), PRESETS.takeover, SIGNAL)

    expect(preview.baselineSections.map(section => section.name)).toContain('harness:identity')
    expect(preview.sections.map(section => section.name)).toEqual(['prompt-preset:replace-0'])
  })

  it('stops between its two assemblies when the caller cancels', async () => {
    const bench = await harness({ presets: PRESETS })
    const controller = new AbortController()
    controller.abort()

    await expect(bench.store.preview(bench.agent(), PRESETS.shout, controller.signal)).rejects.toThrow()
  })
})
