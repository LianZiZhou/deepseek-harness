/**
 * The `/prompt-preset` command: the front-door-neutral control a terminal
 * front door reaches through the command registry. Bare, it reports; a preset
 * id or `off` switches the receiving session through the same queued
 * selection as the Remote API; `default` writes the deployment default through
 * the settings forms. The command exists only while a registry is composed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { TerminalCommandTrees } from '../src/completion.ts'
import { cleanup, harness, type Harness, type RawConfig } from './harness.ts'

afterEach(cleanup)

const ROSTER: RawConfig = {
  presets: {
    'grok-break': { name: 'Grok break', rules: [{ kind: 'append', text: 'GROK.' }] },
    terse: { name: 'Terse', rules: [{ kind: 'append', text: 'BE BRIEF.' }] },
  },
}

/** Run one command line against one agent and return its settled result. */
async function run(bench: Harness, agent: Agent, line: string) {
  const execution = await bench.ctx.commands.execute(agent, line, [], new AbortController().signal)
  return execution?.result
}

/** The preset one agent's session currently records. */
function selected(bench: Harness, agent: Agent): string | null | undefined {
  return bench.ctx.sessionProjections.stateOf(agent.session, 'promptPreset')
}

describe('/prompt-preset', () => {
  it('registers under its own name, clear of the agent-preset command', async () => {
    const bench = await harness(ROSTER, [], { commands: true })
    const agent = bench.agent()
    // No outer brackets: front doors wrap the hint themselves.
    expect(bench.ctx.commands.list(agent).find(command => command.name === 'prompt-preset')?.input)
      .toEqual({ hint: '<preset> | off | default <preset|off>' })
    expect(bench.ctx.commands.find(agent, 'preset')).toBeUndefined()
  })

  it('reports the session, the default, and the roster when bare', async () => {
    const bench = await harness({ ...ROSTER, default: 'terse' }, [], { commands: true })
    const agent = bench.agent()
    await bench.ctx.parallel('agent/created', { agent, source: 'startup' })
    expect(await run(bench, agent, '/prompt-preset')).toEqual({
      kind: 'success',
      text: 'current terse, default terse (available: grok-break, terse)',
    })
  })

  it('reports off and an empty roster', async () => {
    const bench = await harness({}, [], { commands: true })
    const agent = bench.agent()
    expect(await run(bench, agent, '/prompt-preset   ')).toEqual({
      kind: 'success',
      text: 'current off, default off (none stored)',
    })
  })

  it('switches the receiving session and clears it with off', async () => {
    const bench = await harness(ROSTER, [], { commands: true })
    const agent = bench.agent()
    const other = bench.agent()
    expect(await run(bench, agent, '/prompt-preset grok-break'))
      .toEqual({ kind: 'success', text: 'grok-break, from the next step' })
    expect(selected(bench, agent)).toBe('grok-break')
    expect(selected(bench, other)).toBeNull()
    // The rendered prompt follows the recorded selection.
    expect(renderPrompt(await bench.ctx.systemPrompt.assemble(assembleContextFor(agent)))).toContain('GROK.')

    expect(await run(bench, agent, '/prompt-preset off'))
      .toEqual({ kind: 'success', text: 'off, from the next step' })
    expect(selected(bench, agent)).toBeNull()
    const logged = agent.session.snapshotEvents().find(event => event.type === 'command/run')
    expect(logged?.data).toMatchObject({ name: 'prompt-preset', args: ' grok-break' })
  })

  it('refuses an unknown preset and a malformed line without touching the session', async () => {
    const bench = await harness(ROSTER, [], { commands: true })
    const agent = bench.agent()
    expect(await run(bench, agent, '/prompt-preset nope')).toEqual({
      kind: 'error',
      text: 'unknown preset "nope" (available: grok-break, terse)',
    })
    const usage = { kind: 'error', text: 'usage: [<preset> | off | default <preset|off>]' }
    expect(await run(bench, agent, '/prompt-preset terse extra')).toEqual(usage)
    expect(await run(bench, agent, '/prompt-preset default')).toEqual(usage)
    expect(await run(bench, agent, '/prompt-preset default terse extra')).toEqual(usage)
    expect(selected(bench, agent)).toBeNull()
  })

  it('writes the deployment default for new sessions', async () => {
    const bench = await harness(ROSTER, [], { commands: true })
    const agent = bench.agent()
    expect(await run(bench, agent, '/prompt-preset default terse'))
      .toEqual({ kind: 'success', text: 'default terse, for new sessions' })
    expect(bench.store.list().default).toBe('terse')
    // The receiving session is not switched by a default change.
    expect(selected(bench, agent)).toBeNull()
    const fresh = bench.agent()
    await bench.ctx.parallel('agent/created', { agent: fresh, source: 'startup' })
    expect(selected(bench, fresh)).toBe('terse')

    expect(await run(bench, agent, '/prompt-preset default off'))
      .toEqual({ kind: 'success', text: 'default off, for new sessions' })
    expect(bench.store.list().default).toBe('')
    expect(await run(bench, agent, '/prompt-preset default nope')).toEqual({
      kind: 'error',
      text: 'unknown preset "nope" (available: grok-break, terse)',
    })
  })

  it('reports a read-only deployment as a refusal rather than a failed handler', async () => {
    const bench = await harness(ROSTER, [], { commands: true, settings: false })
    const agent = bench.agent()
    const result = await run(bench, agent, '/prompt-preset default terse')
    expect(result?.kind).toBe('error')
    expect(result?.kind === 'error' ? result.text : '').toContain('cannot be edited here')
    // Switching a session needs no settings service.
    expect(await run(bench, agent, '/prompt-preset terse'))
      .toEqual({ kind: 'success', text: 'terse, from the next step' })
  })

  it('lets an unexpected write failure fail the handler', async () => {
    const bench = await harness(ROSTER, [], { commands: true })
    const agent = bench.agent()
    vi.spyOn(bench.ctx.settings, 'mutate').mockRejectedValueOnce(new Error('disk full'))
    await expect(run(bench, agent, '/prompt-preset default terse')).rejects.toThrow('disk full')
    const done = agent.session.snapshotEvents().find(event => event.type === 'command/done')
    expect(done?.data).toMatchObject({ kind: 'error', text: 'disk full' })
  })

  it('is absent without a command registry', async () => {
    const bench = await harness(ROSTER)
    expect(bench.ctx.get('commands')).toBeUndefined()
    expect(bench.store.list().presets).toHaveLength(2)
  })
})

/** A stand-in for a terminal front door's completion registry. */
function fakeTrees() {
  const providers: Parameters<TerminalCommandTrees['register']>[0][] = []
  const dispose = vi.fn()
  const trees: TerminalCommandTrees = {
    register(provider) {
      providers.push(provider)
      return dispose
    },
  }
  return { trees, providers, dispose }
}

describe('/prompt-preset argument completion', () => {
  it('offers presets, off, and default, then presets and off after default', async () => {
    const bench = await harness({
      ...ROSTER,
      presets: { ...ROSTER.presets, described: { name: 'Described', description: 'Says why.', rules: [] } },
      default: 'terse',
    })
    const { trees, providers } = fakeTrees()
    bench.ctx.provide('tuiCommandTrees', trees)
    await vi.waitFor(() => { expect(providers).toHaveLength(1) })
    const [provider] = providers
    expect(provider?.root).toBe('prompt-preset')
    expect(provider?.descriptions).toEqual({
      en: 'Show or switch this session\'s prompt preset',
      zh: '查看或切换本会话的提示词预设',
    })
    const top = provider?.children(['prompt-preset']) ?? []
    expect(top.map(node => [node.name, node.description, node.tag])).toEqual([
      ['described', 'Says why.', undefined],
      ['grok-break', 'Grok break', undefined],
      ['terse', 'Terse', 'default'],
      ['off', 'Run this session without a preset', undefined],
      ['default', 'Choose the preset new sessions start with', undefined],
    ])
    expect(top.at(-1)?.descriptions?.zh).toBe('设置新会话的默认预设')
    expect(provider?.children(['prompt-preset', 'default']).map(node => node.name))
      .toEqual(['described', 'grok-break', 'terse', 'off'])
    expect(provider?.children(['prompt-preset', 'default']).at(-1)?.description)
      .toBe('New sessions start without a preset')
    expect(provider?.children(['prompt-preset', 'terse'])).toEqual([])
    expect(provider?.children(['prompt-preset', 'default', 'terse'])).toEqual([])
  })

  it('reads the live roster and unregisters when the store unloads', async () => {
    const bench = await harness(ROSTER)
    const { trees, providers, dispose } = fakeTrees()
    bench.ctx.provide('tuiCommandTrees', trees)
    await vi.waitFor(() => { expect(providers).toHaveLength(1) })
    await bench.store.create('added', { name: 'Added', rules: [] })
    expect(providers[0]?.children(['prompt-preset']).map(node => node.name)).toContain('added')
    await bench.fiber.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
