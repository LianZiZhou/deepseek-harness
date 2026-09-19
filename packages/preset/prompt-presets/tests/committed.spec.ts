/**
 * The end-to-end reading of the override's guarantee: the prompt a session
 * commits is the prompt the override returned. The committed text arrives
 * through the surface projection and the session log, so agreeing with it is
 * an observation this package did not make itself.
 *
 * It warns and never interrupts. The step has already run by the time the
 * message is committed, and failing a turn over a reporting mismatch would be
 * a worse outcome than the mismatch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { cleanup, harness } from './harness.ts'

afterEach(cleanup)

const SHOUT = {
  presets: { shout: { name: 'Shout', rules: [{ kind: 'replace' as const, text: 'BE LOUD.' }] } },
  default: 'shout',
}

/** Commit one system message the way the loop does. */
function commit(session: Session, text: string): void {
  session.append('system/message', {
    turn: 1,
    step: 1,
    message: {
      role: 'system',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
      id: 'msg-1',
    },
  } as never, { surfaceOp: 'append' })
}

/** Assemble one agent's prompt through the override and return the rendered text. */
async function assembled(agent: Agent, ctx: { systemPrompt: { assemble: (context: never) => Promise<never> } }) {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent) as never)
  return renderPrompt(assembly)
}

describe('checking the committed prompt', () => {
  it('says nothing when the commit is what the override returned', async () => {
    const { ctx, store, agent } = await harness(SHOUT)
    const one = agent()
    await store.select(one, 'shout')
    const warn = vi.spyOn(ctx.logger, 'warn')
    const text = await assembled(one, ctx as never)
    expect(text).toBe('BE LOUD.')

    commit(one.session, text)

    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once when something rewrote the prompt afterwards', async () => {
    const { ctx, store, agent } = await harness(SHOUT)
    const one = agent()
    await store.select(one, 'shout')
    await assembled(one, ctx as never)
    const warn = vi.spyOn(ctx.logger, 'warn')

    commit(one.session, 'SOMETHING ELSE ENTIRELY')
    commit(one.session, 'AND AGAIN')

    // One report per session: a rewrite is a standing condition, not a stream
    // of incidents, and repeating it every step would bury everything else.
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('differs from the one this override returned')
  })

  it('says nothing about a session this override never transformed', async () => {
    const { ctx, agent } = await harness({ presets: SHOUT.presets, default: '' })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const one = agent()
    await assembled(one, ctx as never)

    commit(one.session, 'whatever the registry produced')

    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts any prompt produced since the last commit', async () => {
    const { ctx, store, agent } = await harness(SHOUT)
    const one = agent()
    await store.select(one, 'shout')
    const first = await assembled(one, ctx as never)
    await store.select(one, null)
    const second = await assembled(one, ctx as never)
    expect(second).not.toBe(first)
    const warn = vi.spyOn(ctx.logger, 'warn')

    // Two assemblies, one commit: a session running several agents commits one
    // step's prompt while another is still assembling, and only a text matching
    // none of them is a divergence.
    commit(one.session, first)

    expect(warn).not.toHaveBeenCalled()
  })

  it('forgets what it produced once a commit has been checked', async () => {
    const { ctx, store, agent } = await harness(SHOUT)
    const one = agent()
    await store.select(one, 'shout')
    const text = await assembled(one, ctx as never)
    commit(one.session, text)
    const warn = vi.spyOn(ctx.logger, 'warn')

    // Nothing assembled since, so the second commit has nothing to check
    // against and stays quiet rather than reporting a stale expectation.
    commit(one.session, 'a later step, assembled by nobody here')

    expect(warn).not.toHaveBeenCalled()
  })

  it('records nothing for a preview', async () => {
    const { ctx, store, agent } = await harness(SHOUT)
    const one = agent()
    await store.select(one, 'shout')
    await store.preview(one, { name: 'Terse', rules: [{ kind: 'append', text: 'BRIEF.' }] }, AbortSignal.timeout(1000))
    const warn = vi.spyOn(ctx.logger, 'warn')

    commit(one.session, 'the step that actually ran')

    expect(warn).not.toHaveBeenCalled()
  })
})
