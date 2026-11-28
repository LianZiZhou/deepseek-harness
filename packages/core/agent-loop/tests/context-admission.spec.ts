/** `agent/admit-messages` and `agent/admit-context`: the loop's last word over injected context before commit. */
import * as NativeToolRegistry from '@deepseek-ai/dsh-tool-registry-native'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, RequestMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'admission-notice': { kind: 'admission-notice' } & ContextFormed
  }
}

async function harness(adapter: MockAdapter) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function notice(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'admission-notice' } })
}

function textOf(message: RequestMessage): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function loggedUsers(agent: Agent): UserMessage[] {
  return agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' ? [event.data] : [])
}

describe('agent/admit-messages', () => {
  it('sees what every pre-step listener appended, however late it registered', async () => {
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('admit-messages-order'), { provider: 'mock', model: 'mock' })
    const seen: string[][] = []
    ctx.on('agent/admit-messages', async ({ messages }, next) => {
      seen.push(messages.map(message => message.source.kind))
      const kept = await next()
      return kept.flatMap(message => message.source.kind !== 'admission-notice'
        ? [message]
        : textOf(message) === 'drop' ? [] : [{ ...message, content: [{ type: 'text' as const, text: `rewritten ${textOf(message)}` }] }])
    })
    // Registered after the admission listener and prepended, so it is the
    // outermost pre-step listener: the case a pre-step filter cannot cover.
    agent.ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      return decision.kind === 'reject' ? decision : { ...decision, messages: [...decision.messages, notice('drop'), notice('keep')] }
    }, { prepend: true })

    await send(agent, 'hello')

    expect(seen).toEqual([['user', 'admission-notice', 'admission-notice']])
    const users = adapter.requests[0]?.messages.filter(message => message.role === 'user') ?? []
    expect(users.map(textOf)).toEqual(['hello', 'rewritten keep'])
    expect(loggedUsers(agent).map(textOf)).toEqual(['hello', 'rewritten keep'])
  })

  it('closes a first step it empties without a model call', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('admit-messages-empty'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/admit-messages', () => Promise.resolve([]))

    await send(agent, 'ignored')

    expect(adapter.requests).toHaveLength(0)
    expect(loggedUsers(agent)).toEqual([])
    expect(agent.session.snapshotEvents().flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : [])).toEqual(['completed'])
  })
})

describe('agent/admit-context', () => {
  it('rewrites and drops sections at preparation and before every attempt', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    let hidden = 'hidden-one'
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    ctx.systemPrompt.context({ name: 'hidden', order: 1, text: () => hidden })
    const agent = await ctx.agentLoop.create(SessionId('admit-context'), { provider: 'mock', model: 'mock' })
    const calls: { turn: number; step: number; names: string[] }[] = []
    ctx.on('agent/admit-context', async ({ sections, turn, step }, next) => {
      calls.push({ turn, step, names: sections.map(section => section.name) })
      const kept = await next()
      return kept.flatMap(section => section.name === 'hidden' ? [] : [{ ...section, text: `[${section.text}]` }])
    })

    await send(agent, 'first')
    // Only the dropped section changed, so nothing new is stated.
    hidden = 'hidden-two'
    await send(agent, 'second')

    expect(calls).toEqual([
      { turn: 1, step: 1, names: ['policy', 'hidden'] },
      { turn: 1, step: 1, names: ['policy', 'hidden'] },
      { turn: 2, step: 1, names: ['policy', 'hidden'] },
      { turn: 2, step: 1, names: ['policy', 'hidden'] },
    ])
    const snapshots = loggedUsers(agent).filter(message => message.source.kind === 'runtime-context')
    expect(snapshots).toHaveLength(1)
    expect(textOf(snapshots[0]!)).toBe('<system-reminder>\nThe following information describes your current session:\n\n[Mode: read-only.]\n</system-reminder>')
    expect(snapshots[0]?.source).toMatchObject({ form: 'snapshot', sections: [{ name: 'policy', text: '[Mode: read-only.]' }] })
    expect(JSON.stringify(adapter.requests)).not.toContain('hidden-')
  })
})
