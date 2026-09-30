/**
 * Presets as the entry's own Config: what the store does when it can and
 * cannot write, and when the stored document was edited past the editor.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import PromptPresetStore, { SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-prompt-presets'
import { cleanup, ENTRY, harness } from './harness.ts'

afterEach(cleanup)

const SHOUT = { shout: { name: 'Shout', rules: [{ kind: 'append' as const, text: 'BE LOUD.' }] } }

describe('a deployment that composes no settings service', () => {
  it('still reads and applies presets, and says it cannot write them', async () => {
    const bench = await harness({ presets: SHOUT }, [], { settings: false })
    const agent = bench.agent()
    await bench.store.select(agent, 'shout')

    expect(bench.store.list()).toMatchObject({ writable: false, revision: 0 })
    // Nothing tells the bundle layer from the profile without the forms, so
    // every row reads as the user's; with no write path it makes no difference.
    expect(bench.store.list().presets[0]?.source).toBe('user')
  })

  it('refuses a write rather than dropping it', async () => {
    const bench = await harness({ presets: SHOUT }, [], { settings: false })

    await expect(bench.store.create('terse', { name: 'Terse', rules: [] }))
      .rejects.toMatchObject({ code: 'prompt-preset/read-only' })
  })
})

describe('a stored document edited past the editor', () => {
  it('warns on a document the write path would have refused, and keeps working', async () => {
    const bench = await harness({ presets: SHOUT })
    const warn = vi.spyOn(bench.ctx.logger, 'warn')

    // Straight into the entry, as a hand edit or another client would land it,
    // skipping every check the store's own methods make.
    await bench.ctx.settings.mutate(ENTRY, [{ op: 'set', path: ['default'], value: 'nowhere' }])

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the stored presets fail validation'))
    expect(bench.store.list().default).toBe('nowhere')
  })
})

describe('mounted without a Loader', () => {
  it('addresses the entry the shipped bundles use', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(PromptPresetStore, { presets: SHOUT })

    // There is no entry to read an id from, so a write would name the default
    // row; with no settings service here either, it is refused before that.
    expect(SETTINGS_NAMESPACE).toBe(ENTRY)
    await expect(ctx.promptPresets.setDefault('shout')).rejects.toMatchObject({ code: 'prompt-preset/read-only' })
    await ctx.fiber.dispose()
  })
})
