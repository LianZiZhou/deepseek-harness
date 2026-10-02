/**
 * `session.resume`: re-runs the work the last turn left unfinished without a
 * new message. Only an ending short of a reply resumes; anything else, a
 * running session, or an Agent without a turn driver is refused.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import { createSessionTestRemote, installSessionReadTestServices } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

async function composed(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  return ctx
}

/** One live Agent whose single turn ended as given; `resume` is a spy unless `false`. */
async function agentEndingWith(
  ctx: Context,
  id: string,
  ending: TurnEndReason | undefined,
  options: { status?: 'idle' | 'running'; resume?: false | (() => void) } = {},
) {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  if (ending !== undefined) {
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'go' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: ending })
  }
  const resume = options.resume === false ? undefined : vi.fn(options.resume ?? (() => {}))
  const agent = { id: session.id, session, status: options.status ?? 'idle', ctx } as Agent
  if (resume !== undefined) Object.assign(agent, { resume })
  await ctx.agents.register(agent)
  return { session, resume }
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, {
  defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
  cwd: '/tmp',
})

describe('session.resume', () => {
  it.each<TurnEndReason>([
    { kind: 'error', error: { message: 'provider down', code: 'UNKNOWN' } },
    { kind: 'aborted', reason: { kind: 'user' } },
    { kind: 'interrupted' },
    { kind: 'max-tokens' },
    { kind: 'forked' },
  ])('resumes a turn that ended $kind', async (ending) => {
    const ctx = await composed()
    const { session, resume } = await agentEndingWith(ctx, `resume-${ending.kind}`, ending)
    await expect(remote(ctx).resume({ sessionId: session.id })).resolves.toEqual({ ok: true, value: { accepted: true } })
    expect(resume).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it.each<[string, TurnEndReason | undefined, { status?: 'running'; resume?: false }, RegExp]>([
    ['a completed turn', { kind: 'completed' }, {}, /ended completed/],
    ['a blocked turn', { kind: 'blocked' }, {}, /ended blocked/],
    ['no turn at all', undefined, {}, /no turn to resume/],
    ['a running session', { kind: 'interrupted' }, { status: 'running' }, /still running/],
    ['an Agent without resume', { kind: 'interrupted' }, { resume: false }, /cannot resume/],
  ])('refuses %s', async (_label, ending, options, message) => {
    const ctx = await composed()
    const { session, resume } = await agentEndingWith(ctx, 'resume-refused', ending, options)
    const response = await remote(ctx).resume({ sessionId: session.id })
    expect(response).toMatchObject({ ok: false, error: { code: 'session/resume-unavailable', details: { sessionId: session.id } } })
    if (!response.ok) expect(response.error.message).toMatch(message)
    expect(resume ?? vi.fn()).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reports an Agent that refuses at the last moment as busy', async () => {
    const ctx = await composed()
    const { session } = await agentEndingWith(ctx, 'resume-raced', { kind: 'interrupted' }, {
      resume: () => { throw new Error('already has active work') },
    })
    const response = await remote(ctx).resume({ sessionId: session.id })
    expect(response).toMatchObject({ ok: false, error: { code: 'session/agent-busy' } })
    await ctx.fiber.dispose()
  })
})
