/**
 * A roster managed in the home patch: `$DSH_HOME/cordis.patch.yml` outranks
 * the profile's own patch, which is the only file the settings editor writes.
 * Presets set there apply in every profile, and an edit through the store is
 * refused as read-only with the file to edit instead of a raw editor error.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { cleanup, harness, ENTRY } from './harness.ts'

afterEach(cleanup)

const HOME_PATCH = JSON.stringify([{
  id: ENTRY,
  config: {
    presets: { shared: { name: 'Shared', rules: [{ kind: 'append', text: 'FROM HOME.' }] } },
    default: 'shared',
  },
}])

describe('a roster in the home patch', () => {
  it('applies the home layer over the bundle layer', async () => {
    const bench = await harness({ presets: { bundled: { name: 'Bundled', rules: [] } } }, [], { homePatch: HOME_PATCH })
    const roster = bench.store.list()
    expect(roster.presets.map(row => row.promptPreset)).toEqual(['shared'])
    expect(roster.default).toBe('shared')
  })

  it('refuses an edit as read-only and names the file to edit', async () => {
    const bench = await harness({}, [], { homePatch: HOME_PATCH, commands: true })
    const failure = remoteErrorOf(await bench.store.setDefault('').catch((error: unknown) => error))
    expect(failure?.code).toBe('prompt-preset/read-only')
    expect(failure?.message).toContain('$DSH_HOME/cordis.patch.yml')
    expect(bench.store.list().default).toBe('shared')

    const execution = await bench.ctx.commands.execute(bench.agent(), '/prompt-preset default off', [], new AbortController().signal)
    expect(execution?.result).toMatchObject({ kind: 'error' })
    expect(execution?.result.text).toContain('home patch')
  })
})
