import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { cleanup, harness, startTurn } from './harness.ts'
import type { Harness } from './harness.ts'

afterEach(cleanup)

const IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'
const PRESETS = {
  shout: { name: 'Shout', rules: [{ kind: 'append' as const, text: 'BE LOUD.' }] },
  takeover: { name: 'Takeover', rules: [{ kind: 'replace' as const, text: 'You are a calculator.' }] },
}

/** Render what one agent's next step would commit. */
async function promptFor(bench: Harness, agent: Agent): Promise<string> {
  return renderPrompt(await bench.ctx.systemPrompt.assemble(assembleContextFor(agent)))
}

describe('the prompt-preset final override', () => {
  it('leaves an assembly alone when the session selected nothing', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    expect(await promptFor(bench, agent)).toBe(IDENTITY)
  })

  it('applies the session\'s preset to every later assembly', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    await bench.store.select(agent, 'shout')

    expect(await promptFor(bench, agent)).toBe(`${IDENTITY}\n\nBE LOUD.`)
  })

  it('applies to the selecting session alone', async () => {
    const bench = await harness({ presets: PRESETS })
    const [one, two] = [bench.agent('one'), bench.agent('two')]
    await bench.store.select(one, 'shout')

    expect(await promptFor(bench, one)).toContain('BE LOUD.')
    expect(await promptFor(bench, two)).toBe(IDENTITY)
  })

  it('takes effect on the next assembly when a running session switches', async () => {
    const bench = await harness({ presets: PRESETS })
    const agent = bench.agent()
    startTurn(agent.session)

    await bench.store.select(agent, 'shout')
    expect(await promptFor(bench, agent)).toContain('BE LOUD.')
    await bench.store.select(agent, 'takeover')
    expect(await promptFor(bench, agent)).toBe('You are a calculator.')
    await bench.store.select(agent, null)
    expect(await promptFor(bench, agent)).toBe(IDENTITY)
  })

  it('overrides a section another contribution declared complete', async () => {
    const bench = await harness(
      { presets: PRESETS },
      [{ name: 'preset:persona', order: 1, text: 'You obey only this.', complete: true }],
    )
    const agent = bench.agent()
    // Without a preset the complete section is the whole prompt.
    expect(await promptFor(bench, agent)).toBe('You obey only this.')

    await bench.store.select(agent, 'takeover')
    expect(await promptFor(bench, agent)).toBe('You are a calculator.')
  })

  it('keeps a protected section through a replace', async () => {
    const bench = await harness(
      { presets: PRESETS, protectedSections: ['tools:ptc-only'] },
      [{ name: 'tools:ptc-only', order: 1, text: 'Only call tools through code.' }],
    )
    const agent = bench.agent()
    await bench.store.select(agent, 'takeover')

    expect(await promptFor(bench, agent))
      .toBe('Only call tools through code.\n\nYou are a calculator.')
  })

  it('discards the whole preset for an assembly it would make unrenderable', async () => {
    const bench = await harness({
      presets: {
        breaker: {
          name: 'Breaker',
          // The substitution injects a reference into a section that DOES
          // interpolate, which is the one way a stored preset can reach
          // `renderPrompt` and throw.
          rules: [{ kind: 'substitute' as const, pattern: 'agent', replacement: '{{nope}}' }],
        },
      },
    })
    const agent = bench.agent()
    const warn = vi.spyOn(bench.ctx.logger, 'warn').mockImplementation(() => {})
    await bench.store.select(agent, 'breaker')

    expect(await promptFor(bench, agent)).toBe(IDENTITY)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('render-failed'))
  })

  it('warns once and changes nothing when the selected preset is gone', async () => {
    const bench = await harness()
    await bench.store.create('mine', { name: 'Mine', rules: [{ kind: 'append', text: 'BE LOUD.' }] })
    const agent = bench.agent()
    await bench.store.select(agent, 'mine')
    expect(await promptFor(bench, agent)).toContain('BE LOUD.')
    const warn = vi.spyOn(bench.ctx.logger, 'warn').mockImplementation(() => {})
    await bench.store.deletePreset('mine')

    expect(await promptFor(bench, agent)).toBe(IDENTITY)
    expect(await promptFor(bench, agent)).toBe(IDENTITY)
    expect(warn.mock.calls.filter(([text]) => String(text).includes('unknown-preset'))).toHaveLength(1)
  })

  it('logs one apply-time warning per session, preset, code, and rule', async () => {
    const bench = await harness({
      presets: { picky: { name: 'Picky', rules: [{ kind: 'remove' as const, sections: ['tool:absent'] }] } },
    })
    const agent = bench.agent()
    const warn = vi.spyOn(bench.ctx.logger, 'warn').mockImplementation(() => {})
    await bench.store.select(agent, 'picky')

    await promptFor(bench, agent)
    await promptFor(bench, agent)
    expect(warn.mock.calls.filter(([text]) => String(text).includes('unknown-section'))).toHaveLength(1)
  })
})

describe('the blank-session default', () => {
  it('records the deployment default as an ordinary selection', async () => {
    const bench = await harness({ presets: PRESETS, default: 'shout' })
    const agent = bench.agent()
    await bench.ctx.parallel('agent/created', { agent, source: 'startup' })

    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBe('shout')
    expect(await promptFor(bench, agent)).toContain('BE LOUD.')
  })

  it('leaves a session that has already produced something alone', async () => {
    const bench = await harness({ presets: PRESETS, default: 'shout' })
    const agent = bench.agent()
    startTurn(agent.session)
    await bench.ctx.parallel('agent/created', { agent, source: 'startup' })

    expect(bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBeNull()
  })

  it('leaves a session that already chose alone, and stamps nothing without a default', async () => {
    const chosen = await harness({ presets: PRESETS, default: 'shout' })
    const agent = chosen.agent()
    await chosen.store.select(agent, 'takeover')
    await chosen.ctx.parallel('agent/created', { agent, source: 'startup' })
    expect(chosen.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')).toBe('takeover')

    const none = await harness({ presets: PRESETS })
    const other = none.agent()
    await none.ctx.parallel('agent/created', { agent: other, source: 'startup' })
    expect(none.ctx.sessionProjections.stateOf(other.session, 'promptPreset')).toBeNull()
  })

  it('starts the session rather than failing it when stamping cannot finish', async () => {
    const bench = await harness({ presets: PRESETS, default: 'shout' })
    const agent = bench.agent()
    vi.spyOn(agent.session, 'append').mockImplementation(() => { throw new Error('log is sealed') })
    const warn = vi.spyOn(bench.ctx.logger, 'warn').mockImplementation(() => {})

    await expect(bench.ctx.parallel('agent/created', { agent, source: 'startup' })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not stamp the initial preset'))
  })
})

describe('a delegated child', () => {
  it('adopts the preset its parent was running', async () => {
    const bench = await harness({ presets: PRESETS })
    const parent = bench.agent()
    await bench.store.select(parent, 'shout')

    const child = bench.child(parent)
    await bench.ctx.parallel('agent/created', { agent: child, source: 'startup' })

    // Recorded, not resolved on the fly: the child's own log is what a cold
    // read replays, so its history stays reconstructable.
    expect(bench.ctx.sessionProjections.stateOf(child.session, 'promptPreset')).toBe('shout')
    expect(await promptFor(bench, child)).toContain('BE LOUD.')
  })

  it('keeps what its parent ran even after the parent switches away', async () => {
    const bench = await harness({ presets: PRESETS })
    const parent = bench.agent()
    await bench.store.select(parent, 'shout')
    const child = bench.child(parent)
    await bench.ctx.parallel('agent/created', { agent: child, source: 'startup' })

    await bench.store.select(parent, 'takeover')

    // The child adopted a value, not a live link; a parent steering itself
    // mid-task must not rewrite what a running child is already producing.
    expect(await promptFor(bench, child)).toContain('BE LOUD.')
  })

  it('falls back to the deployment default when its parent selected nothing', async () => {
    const bench = await harness({ presets: PRESETS, default: 'takeover' })
    const parent = bench.agent()
    const child = bench.child(parent)
    await bench.ctx.parallel('agent/created', { agent: child, source: 'startup' })

    expect(bench.ctx.sessionProjections.stateOf(child.session, 'promptPreset')).toBe('takeover')
  })

  it('stamps nothing when neither the parent nor the deployment names one', async () => {
    const bench = await harness({ presets: PRESETS })
    const parent = bench.agent()
    const child = bench.child(parent)
    await bench.ctx.parallel('agent/created', { agent: child, source: 'startup' })

    expect(bench.ctx.sessionProjections.stateOf(child.session, 'promptPreset')).toBeNull()
  })

  it('ignores a parent the runtime no longer holds', async () => {
    const bench = await harness({ presets: PRESETS, default: 'shout' })
    const orphan = bench.ctx.sessions.create(SessionId('orphan'), {
      meta: { origin: 'subagent', parentSession: SessionId('gone'), delegationDepth: 1 },
    })
    const child = { id: orphan.id, session: orphan, options: {} } as Agent

    await bench.ctx.parallel('agent/created', { agent: child, source: 'startup' })

    // The deployment default still applies; a parent this process cannot read
    // is not a reason to leave the child with no override at all.
    expect(bench.ctx.sessionProjections.stateOf(orphan, 'promptPreset')).toBe('shout')
  })
})
