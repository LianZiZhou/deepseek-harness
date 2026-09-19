import { afterEach, describe, expect, it } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { cleanup, harness } from './harness.ts'
import type { PromptPresetInput } from '@deepseek-ai/dsh-prompt-presets'

afterEach(cleanup)

const SHOUT: PromptPresetInput = {
  name: 'Shout',
  description: 'Adds emphasis.',
  rules: [{ kind: 'append', text: 'BE LOUD.' }],
}

/** The failure a rejected call produced, as a code and its details. */
async function refusal(call: Promise<unknown>): Promise<unknown> {
  return remoteErrorOf(await call.catch((error: unknown) => error))
}

/**
 * The `reason` a rejected write reported, so a test can match part of it.
 * @throws when the call was accepted, or refused with another code.
 */
async function invalidReason(call: Promise<unknown>): Promise<string> {
  const failure = remoteErrorOf(await call.catch((error: unknown) => error))
  if (failure?.code !== 'prompt-preset/invalid') {
    throw new Error(`expected prompt-preset/invalid, got ${String(failure?.code)}`)
  }
  return failure.details.reason
}

describe('the prompt-preset roster', () => {
  it('reports the deployment layer, the user layer, the default, and this deployment\'s bounds', async () => {
    const bench = await harness({
      presets: { shipped: { name: 'Shipped', rules: [] } },
      default: 'shipped',
      maxRules: 4,
      protectedSections: ['tools:ptc-only'],
    })
    await bench.store.create('mine', SHOUT)
    await bench.store.create('another', SHOUT)

    const roster = bench.store.list()
    // Deployment rows first, then the user's own in code-unit id order.
    expect(roster.presets.map(row => [row.promptPreset, row.source, row.isDefault]))
      .toEqual([
        ['shipped', 'deployment', true],
        ['another', 'user', false],
        ['mine', 'user', false],
      ])
    expect(roster.default).toBe('shipped')
    expect(roster.writable).toBe(true)
    expect(roster.limits.maxRules).toBe(4)
    expect(roster.protectedSections).toEqual(['tools:ptc-only'])
    expect(roster.revision).toBeGreaterThan(0)
  })

  it('stores a created preset with its description and rules', async () => {
    const bench = await harness()
    const row = await bench.store.create('mine', SHOUT)

    expect(row).toMatchObject({ promptPreset: 'mine', name: 'Shout', description: 'Adds emphasis.', source: 'user' })
    expect(bench.store.list().presets).toHaveLength(1)
  })

  it('replaces a stored preset wholesale, and drops a description the update omits', async () => {
    const bench = await harness()
    await bench.store.create('mine', SHOUT)
    const row = await bench.store.update('mine', { name: 'Quiet', rules: [] })

    expect(row).toMatchObject({ name: 'Quiet', rules: [] })
    expect(row.description).toBeUndefined()
  })

  it('deletes a user preset and clears a default that named it', async () => {
    const bench = await harness()
    await bench.store.create('mine', SHOUT)
    await bench.store.setDefault('mine')
    expect(bench.store.list().default).toBe('mine')

    await bench.store.deletePreset('mine')
    expect(bench.store.list().presets).toEqual([])
    expect(bench.store.list().default).toBe('')
  })

  it('leaves a default alone when another preset is deleted', async () => {
    const bench = await harness()
    await bench.store.create('kept', SHOUT)
    await bench.store.create('gone', SHOUT)
    await bench.store.setDefault('kept')

    await bench.store.deletePreset('gone')
    expect(bench.store.list().default).toBe('kept')
  })

  it('sets and clears the default', async () => {
    const bench = await harness()
    await bench.store.create('mine', SHOUT)
    await bench.store.setDefault('mine')
    expect(bench.store.list().default).toBe('mine')

    await bench.store.setDefault('')
    expect(bench.store.list().default).toBe('')
  })

  it('refuses an id the storage key grammar rejects', async () => {
    const bench = await harness()
    expect(await refusal(bench.store.create('Not Valid', SHOUT)))
      .toMatchObject({ code: 'prompt-preset/invalid', details: { promptPreset: 'Not Valid', reason: 'invalid id' } })
  })

  it('refuses an id that is already taken, and one that is not stored', async () => {
    const bench = await harness()
    await bench.store.create('mine', SHOUT)

    expect(await refusal(bench.store.create('mine', SHOUT)))
      .toMatchObject({ code: 'prompt-preset/exists', details: { promptPreset: 'mine' } })
    expect(await refusal(bench.store.update('absent', SHOUT)))
      .toMatchObject({ code: 'prompt-preset/not-found', details: { promptPreset: 'absent', available: ['mine'] } })
    expect(await refusal(bench.store.setDefault('absent')))
      .toMatchObject({ code: 'prompt-preset/not-found' })
  })

  it('refuses to delete a preset the deployment composes', async () => {
    const bench = await harness({ presets: { shipped: { name: 'Shipped', rules: [] } } })
    expect(await refusal(bench.store.deletePreset('shipped')))
      .toMatchObject({ code: 'prompt-preset/read-only', details: { promptPreset: 'shipped' } })
  })

  it('refuses a document over this deployment\'s bounds, naming the rule at fault', async () => {
    const bench = await harness({ maxRules: 1, maxTextBytes: 8, maxPatternLength: 4 })

    expect(await invalidReason(bench.store.create('a', { name: 'A', rules: [{ kind: 'append', text: 'x' }, { kind: 'append', text: 'y' }] })))
      .toContain('at most 1 rules')
    expect(await refusal(bench.store.create('b', { name: 'B', rules: [{ kind: 'append', text: 'far too long' }] })))
      .toMatchObject({ code: 'prompt-preset/invalid', details: { rule: 0 } })
    expect(await invalidReason(bench.store.create('b', { name: 'B', rules: [{ kind: 'append', text: 'far too long' }] })))
      .toContain('over the 8-byte limit')
    expect(await invalidReason(bench.store.create('c', { name: 'C', rules: [{ kind: 'substitute', pattern: 'toolong', replacement: '' }] })))
      .toContain('over the 4-character limit')
  })

  it('refuses an unusable rule: a bad pattern, bad flags, an empty removal, or a protected one', async () => {
    const bench = await harness({ protectedSections: ['tools:ptc-only'] })
    const reason = async (rules: PromptPresetInput['rules']): Promise<string> =>
      invalidReason(bench.store.create('x', { name: 'X', rules }))
    const outcome = async (rules: PromptPresetInput['rules']): Promise<unknown> =>
      refusal(bench.store.create('x', { name: 'X', rules }))

    expect(await outcome([{ kind: 'substitute', pattern: '(', replacement: '' }]))
      .toMatchObject({ code: 'prompt-preset/invalid', details: { rule: 0 } })
    expect(await reason([{ kind: 'substitute', pattern: 'a', flags: 'y', replacement: '' }]))
      .toContain('is not one of gimsu')
    expect(await reason([{ kind: 'substitute', pattern: 'a', flags: 'gg', replacement: '' }]))
      .toContain('is repeated')
    expect(await reason([{ kind: 'substitute', pattern: '', replacement: '' }]))
      .toBe('a substitute rule needs a pattern')
    expect(await reason([{ kind: 'remove', sections: [] }]))
      .toBe('a remove rule needs at least one section')
    expect(await reason([{ kind: 'remove', sections: ['tools:ptc-only'] }]))
      .toContain('cannot be removed')
    expect(await outcome([{ kind: 'append', text: '' }, { kind: 'prepend', text: '' }]))
      .toBeUndefined()
  })

  it('refuses a nameless preset', async () => {
    const bench = await harness()
    expect(await invalidReason(bench.store.create('mine', { name: '', rules: [] })))
      .toBe('a preset needs a name')
  })

  it('refuses a write whose revision the roster has moved past', async () => {
    const bench = await harness()
    await bench.store.create('mine', SHOUT)
    const stale = bench.store.list().revision
    await bench.store.update('mine', { name: 'Once', rules: [] })

    expect(await refusal(bench.store.update('mine', { name: 'Twice', rules: [] }, stale)))
      .toMatchObject({ code: 'prompt-preset/conflict', details: { promptPreset: 'mine' } })
    // The accepted write is the one that stands.
    expect(bench.store.list().presets[0]).toMatchObject({ name: 'Once' })
  })

  it('refuses a create once the roster is full', async () => {
    const bench = await harness({ maxPresets: 1 })
    await bench.store.create('one', SHOUT)

    expect(await invalidReason(bench.store.create('two', SHOUT))).toBe('roster is full')
  })

  it('announces a roster change once each write commits', async () => {
    const bench = await harness()
    let changes = 0
    bench.ctx.on('prompt-preset/changed', () => { changes += 1 })

    await bench.store.create('mine', SHOUT)
    await bench.store.setDefault('mine')
    await bench.store.deletePreset('mine')
    expect(changes).toBe(3)
  })
})
