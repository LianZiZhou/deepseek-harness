/**
 * `/continue`: resumes the receiving Agent's unfinished last turn without a
 * new message, refuses with the shared resume policy's reason otherwise, and
 * takes no arguments.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import * as commandContinue from '@deepseek-ai/dsh-command-continue'

/** A root with the command registry, this plugin, and one Agent ending its turn as given. */
async function bench(ending: TurnEndReason | undefined, agentShape: { resume?: false; status?: 'running' } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const fiber = await ctx.plugin(commandContinue)
  const session = ctx.sessions.create(SessionId('continue-target'))
  if (ending !== undefined) {
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'go' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: ending })
  }
  const resume = vi.fn()
  const agent = { id: session.id, session, status: agentShape.status ?? 'idle' } as Agent
  if (agentShape.resume !== false) Object.assign(agent, { resume })
  const run = async (line: string) =>
    (await ctx.commands.execute(agent, line, [], new AbortController().signal))?.result
  return { ctx, fiber, agent, resume, run }
}

describe('/continue', () => {
  it('resumes a turn cut short and says so', async () => {
    const { resume, run } = await bench({ kind: 'aborted', reason: { kind: 'user' } })
    expect(await run('/continue')).toEqual({ kind: 'success', text: 'Continuing where the last turn stopped.' })
    expect(resume).toHaveBeenCalledOnce()
  })

  it.each<[string, TurnEndReason | undefined, { status?: 'running'; resume?: false }, string]>([
    ['a completed turn', { kind: 'completed' }, {}, 'the last turn ended completed; there is nothing unfinished to resume'],
    ['no turn', undefined, {}, 'the session has no turn to resume'],
    ['a running session', { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } }, { status: 'running' }, 'the session is still running'],
    ['an Agent without resume', { kind: 'interrupted' }, { resume: false }, 'this agent cannot resume unfinished work'],
  ])('refuses %s with the shared reason', async (_label, ending, shape, reason) => {
    const { resume, run } = await bench(ending, shape)
    expect(await run('/continue')).toEqual({ kind: 'error', text: `Cannot continue: ${reason}.` })
    expect(resume).not.toHaveBeenCalled()
  })

  it('takes no arguments', async () => {
    const { resume, run } = await bench({ kind: 'interrupted' })
    expect(await run('/continue please')).toEqual({ kind: 'error', text: 'Usage: /continue (no arguments)' })
    expect(resume).not.toHaveBeenCalled()
  })

  it('unregisters with its plugin', async () => {
    const { ctx, fiber, agent } = await bench({ kind: 'interrupted' })
    expect(ctx.commands.find(agent, 'continue')).toBeDefined()
    await fiber.dispose()
    expect(ctx.commands.find(agent, 'continue')).toBeUndefined()
  })
})
