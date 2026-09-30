/**
 * The upgrade path. Before settings moved into the profile, presets lived in a
 * `prompt-presets` section of `$DSH_HOME/settings.yaml`; the first boot after
 * the move imports each section into the entry of the same id and renames the
 * document so the import never repeats.
 *
 * A section this entry's Config rejects stays only in the renamed file, which
 * would make every preset a person had written vanish from the editor on the
 * day they upgrade. These cases pin that it does not.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { cleanup, ENTRY, harness } from './harness.ts'

afterEach(cleanup)

/** A section shaped exactly like the one the removed settings document held. */
const LEGACY = [
  'prompt-presets:',
  '  default: terse',
  '  presets:',
  '    terse:',
  '      name: Terse',
  '      description: Short answers.',
  '      rules:',
  '        - kind: append',
  '          text: Answer in at most three sentences.',
  '    anchored:',
  '      name: Anchored',
  '      rules:',
  '        - kind: insert',
  '          after: harness:identity',
  '          text: Placed right after the identity.',
  '          interpolate: true',
  '',
].join('\n')

describe('importing the removed settings document', () => {
  it('lands every stored preset and the default in the profile, once', async () => {
    const bench = await harness({}, [], { legacy: LEGACY })

    await vi.waitFor(() => { expect(bench.store.list().presets).toHaveLength(2) }, { timeout: 5_000 })

    const roster = bench.store.list()
    expect(roster.default).toBe('terse')
    expect(roster.presets.map(row => row.promptPreset).sort()).toEqual(['anchored', 'terse'])
    expect(roster.presets.find(row => row.promptPreset === 'terse')).toMatchObject({
      name: 'Terse', description: 'Short answers.', source: 'user', isDefault: true,
    })
    // The newest rule kind survives the trip too: it is the one most likely
    // to be missing from a schema that lagged behind the editor.
    expect(roster.presets.find(row => row.promptPreset === 'anchored')?.rules).toEqual([
      { kind: 'insert', after: 'harness:identity', text: 'Placed right after the identity.', interpolate: true },
    ])

    // Where it went, and that it cannot happen twice.
    const patch = parse(readFileSync(bench.patchPath, 'utf8')) as { id: string; config?: { default?: string } }[]
    expect(patch.find(row => row.id === ENTRY)?.config?.default).toBe('terse')
    expect(existsSync(join(bench.home, 'settings.yaml'))).toBe(false)
    expect(existsSync(join(bench.home, 'settings.yaml.imported'))).toBe(true)
  })

  it('stamps the imported default into a blank session', async () => {
    const bench = await harness({}, [], { legacy: LEGACY })
    await vi.waitFor(() => { expect(bench.store.list().default).toBe('terse') }, { timeout: 5_000 })

    const agent = bench.agent()
    await bench.ctx.parallel('agent/created', { agent, source: 'startup' })

    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBe('terse')
  })
})
