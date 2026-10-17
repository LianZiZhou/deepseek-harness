/**
 * `session.rewrite`: stops the controller-owned Agent, replaces the stored
 * log with the edited prefix, invalidates derived state, and resumes the
 * Session under the same id. `session.context` reads the derived model
 * history those edits address.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SESSION_FORMAT_VERSION, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionMessageProjection } from '@deepseek-ai/dsh-session/surface'
import { SessionPersistenceRevision, type SessionInspection } from '@deepseek-ai/dsh-session-persistence'
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Test projection replacing the text of one user message.
     * @messageProjection
     */
    'test/retext': { seq: SessionSeq; text: string }
  }
}

import { createSessionTestRemote, installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

interface Stored {
  meta: SessionHeader
  events: SessionEvent[]
}

/** A composed controller whose fake Agent factory resumes from an in-memory stored log. */
async function composed(options: { status?: 'idle' | 'running'; persistence?: false } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  const stored = new Map<SessionId, Stored>()
  let revision = 0
  const write = (id: SessionId, entry: Stored): void => {
    revision += 1
    stored.set(id, entry)
  }
  const failures = { resume: new Set<SessionId>(), replace: new Set<SessionId>() }
  const replace = vi.fn(async (storage: SessionInspection) => {
    if (failures.replace.delete(storage.meta.id)) throw new Error('disk full')
    write(storage.meta.id, { meta: storage.meta, events: [...storage.events] })
  })
  const invalidate = vi.fn(async (_id: SessionId) => {})
  ctx.provide('sessionProjectionCache', {
    invalidate,
    hydratePrepared: (session: Session, events: readonly SessionEvent[]) =>
      ctx.sessionProjections.hydrate(session, {}, events, SessionLogOffset(0)),
    coldSnapshot: (meta: SessionHeader, inherited: SessionLogOffset, events: readonly SessionEvent[]) =>
      ctx.sessionProjections.restore({}, events, SessionLogOffset(0), meta, inherited).snapshot,
  } as never)
  if (options.persistence !== false) ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([...stored.values()].map(entry => entry.meta)),
    stat: (id: SessionId) => {
      const entry = stored.get(id)
      return Promise.resolve(entry === undefined ? undefined : { header: entry.meta, revision: SessionPersistenceRevision(`test:${id}:${revision}`) })
    },
    inspect: (id: SessionId) => {
      const entry = stored.get(id)
      return Promise.resolve(entry === undefined
        ? undefined
        : { meta: entry.meta, inheritedEventCount: SessionLogOffset(0), events: entry.events })
    },
    replace,
  }) as never)
  const resumes: Array<ReturnType<typeof vi.fn>> = []
  const cancels: Array<ReturnType<typeof vi.fn>> = []
  const live = (
    id: SessionId, seed: readonly SessionEvent[], meta: SessionHeader,
  ): Promise<AgentHandle> => new Promise((resolve, reject) => {
    let session: Session | undefined
    const resume = vi.fn()
    resumes.push(resume)
    const cancel = vi.fn()
    cancels.push(cancel)
    void (async () => {
      const fiber = await ctx.plugin({
        inject: ['sessions', 'agents'],
        apply: async (inner: Context) => {
          session = inner.sessions.create(id, { seed: [...seed], meta: { cwd: meta.cwd ?? '/proj' } })
          const agent = {} as Agent
          Object.assign(agent, {
            id, session, status: options.status ?? 'idle', ctx: inner, resume, cancel, whenIdle: () => Promise.resolve(),
          })
          await inner.agents.register(agent)
        },
      })
      const agent = ctx.agents.get(id)
      if (agent === undefined) throw new Error('fake agent was not registered')
      // Like the real write path, the stored log holds every live append once the Agent stops.
      resolve({ agent, dispose: async () => {
        const events = [...agent.session.snapshotEvents()]
        await fiber.dispose()
        write(id, { meta, events })
      } })
    })().catch(reject)
  })
  ctx.agents.setFactory({
    createAgent: () => Promise.reject(new Error('rewrite tests resume stored sessions')),
    resume: (_owner: Context, request: ResumeAgentOptions) => {
      const entry = stored.get(request.resumeSessionId)
      if (entry === undefined || failures.resume.delete(request.resumeSessionId)) return Promise.reject(new Error('not stored'))
      return live(request.resumeSessionId, entry.events, entry.meta)
    },
  })
  return { ctx, stored, replace, invalidate, resumes, cancels, failures }
}

/** Store one closed two-turn conversation for `id`. */
function storeConversation(stored: Map<SessionId, Stored>, id: SessionId): SessionEvent[] {
  const session = Session.create(id)
  for (const turn of [1, 2]) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${turn}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  const events = [...session.snapshotEvents()]
  stored.set(id, { meta: { version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/proj', isSeeded: false, delegationDepth: 0 }, events })
  return events
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, {
  defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
  cwd: '/tmp',
})

describe('session.rewrite', () => {
  it('replaces the stored log, announces the rewrite before resuming, and restarts on request', async () => {
    const { ctx, stored, replace, invalidate, resumes } = await composed()
    const id = sid('rewrite-me')
    storeConversation(stored, id)
    const order: string[] = []
    ctx.on('api-session/rewritten', () => { order.push(`rewritten:${String(ctx.agents.get(id) === undefined)}`) })
    const response = await remote(ctx).rewrite({
      sessionId: id,
      expectedCursor: 5,
      throughSeq: 1,
      edits: [{ kind: 'replace-content', seq: 1, content: [{ type: 'text', text: 'edited prompt' }] }],
      resume: true,
    })

    expect(response).toEqual({ ok: true, value: { sessionId: id, cursor: 2 } })
    expect(replace).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledWith(id)
    expect(order).toEqual(['rewritten:true'])
    const rewritten = stored.get(id)?.events ?? []
    expect(rewritten.map(event => event.type)).toEqual(['turn/start', 'user/message', 'turn/end'])
    expect(rewritten[1]).toMatchObject({ data: { content: [{ type: 'text', text: 'edited prompt' }] } })
    expect(ctx.agents.get(id)).toBeDefined()
    expect(resumes.at(-1)).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('stops a controller-owned live Agent before replacing its log', async () => {
    const { ctx, stored, replace } = await composed()
    const id = sid('live-owned')
    storeConversation(stored, id)
    const first = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 5, throughSeq: 5, edits: [] })
    expect(first.ok).toBe(true)
    const before = ctx.agents.get(id)
    const second = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 6, throughSeq: 2, edits: [] })
    if (!second.ok) throw second.error
    expect(second).toMatchObject({ ok: true, value: { cursor: 2 } })
    expect(replace).toHaveBeenCalledTimes(2)
    expect(ctx.agents.get(id)).not.toBe(before)
    await ctx.fiber.dispose()
  })

  it('rejects a stale cursor and leaves the stored log unchanged', async () => {
    const { ctx, stored, replace } = await composed()
    const id = sid('stale')
    const events = storeConversation(stored, id)
    const response = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 2, throughSeq: 1, edits: [] })
    expect(response).toMatchObject({ ok: false, error: { code: 'session/rewrite-conflict', details: { cursor: 5 } } })
    expect(replace).not.toHaveBeenCalled()
    expect(stored.get(id)?.events).toEqual(events)
    expect(ctx.agents.get(id)).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('maps an invalid edit to session/rewrite-invalid', async () => {
    const { ctx, stored } = await composed()
    const id = sid('invalid')
    storeConversation(stored, id)
    const response = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 5, throughSeq: 5, edits: [{ kind: 'delete', seq: 0 }] })
    expect(response).toMatchObject({ ok: false, error: { code: 'session/rewrite-invalid', details: { code: 'NOT_A_MESSAGE', seq: 0 } } })
    await ctx.fiber.dispose()
  })

  it('refuses a running Session unless asked to interrupt it', async () => {
    const { ctx, stored, cancels } = await composed({ status: 'running' })
    const id = sid('running')
    storeConversation(stored, id)
    await remote(ctx).resume({ sessionId: id })
    const refused = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 6, throughSeq: 1, edits: [] })
    expect(refused).toMatchObject({ ok: false, error: { code: 'session/agent-busy' } })
    const cancel = cancels.at(-1)
    const accepted = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 6, throughSeq: 1, edits: [], interrupt: true })
    if (!accepted.ok) throw accepted.error
    expect(accepted.ok).toBe(true)
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    await ctx.fiber.dispose()
  })

  it('refuses an invalid cut, a subagent-owned Session, and a composition without persistence', async () => {
    const { ctx, stored } = await composed()
    const id = sid('refusals')
    storeConversation(stored, id)
    expect(await remote(ctx).rewrite({ sessionId: id, expectedCursor: 5, throughSeq: -1, edits: [] }))
      .toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
    const child = sid('subagent-child')
    const session = ctx.sessions.create(child, { meta: { cwd: '/proj', origin: 'subagent' } })
    await ctx.agents.register({ id: child, session, status: 'idle', ctx } as Agent)
    expect(await remote(ctx).rewrite({ sessionId: child, expectedCursor: 0, throughSeq: 0, edits: [] }))
      .toMatchObject({ ok: false, error: { code: 'session/agent-busy' } })
    await ctx.fiber.dispose()
    const bare = await composed({ persistence: false })
    expect(await remote(bare.ctx).rewrite({ sessionId: id, expectedCursor: 5, throughSeq: 1, edits: [] }))
      .toMatchObject({ ok: false, error: { code: 'session/rewrite-unavailable', details: { reason: 'no-persistence' } } })
    await bare.ctx.fiber.dispose()
  })

  it('proceeds after a concurrent resume fails and reports a failed replacement even when the restore fails', async () => {
    const { ctx, stored, failures, replace } = await composed()
    const id = sid('failures')
    storeConversation(stored, id)
    failures.resume.add(id)
    const failedOpen = remote(ctx).context({ sessionId: id })
    const rewritten = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 5, throughSeq: 2, edits: [] })
    expect(await failedOpen).toMatchObject({ ok: false })
    expect(rewritten).toMatchObject({ ok: true, value: { cursor: 2 } })

    const other = sid('replace-fails')
    storeConversation(stored, other)
    failures.replace.add(other)
    failures.resume.add(other)
    const response = await remote(ctx).rewrite({ sessionId: other, expectedCursor: 5, throughSeq: 2, edits: [] })
    expect(response).toMatchObject({ ok: false, error: { code: 'gateway/internal' } })
    if (!response.ok) expect(response.error.message).toMatch(/disk full/)
    expect(replace).toHaveBeenCalledTimes(2)
    expect(stored.get(other)?.events).toHaveLength(6)
    await ctx.fiber.dispose()
  })

  it('ends follow streams of the rewritten Session', async () => {
    const { ctx, stored } = await composed()
    const id = sid('followed')
    storeConversation(stored, id)
    const bystander = sid('bystander')
    storeConversation(stored, bystander)
    const frames = remote(ctx).follow({ address: { kind: 'session', sessionId: id } })[Symbol.asyncIterator]()
    expect((await frames.next()).value).toMatchObject({ type: 'snapshot' })
    const controller = new AbortController()
    const other = remote(ctx).follow({ address: { kind: 'session', sessionId: bystander } }, controller.signal)[Symbol.asyncIterator]()
    expect((await other.next()).value).toMatchObject({ type: 'snapshot' })
    const response = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 5, throughSeq: 2, edits: [] })
    if (!response.ok) throw response.error
    await expect(frames.next()).resolves.toMatchObject({ done: true })
    const pending = other.next()
    controller.abort()
    await expect(pending).resolves.toMatchObject({ done: true })
    await ctx.fiber.dispose()
  })

  it('refuses a live Agent the controller did not start', async () => {
    const { ctx, stored } = await composed()
    const id = sid('foreign')
    storeConversation(stored, id)
    const session = ctx.sessions.create(id, { meta: { cwd: '/proj' } })
    await ctx.agents.register({ id, session, status: 'idle', ctx } as Agent)
    const response = await remote(ctx).rewrite({ sessionId: id, expectedCursor: 5, throughSeq: 1, edits: [] })
    expect(response).toMatchObject({ ok: false, error: { code: 'session/rewrite-unavailable', details: { reason: 'foreign-owner' } } })
    await ctx.fiber.dispose()
  })
})

describe('session.context', () => {
  it('pairs each derived message with its producing event seq at the current cursor', async () => {
    const { ctx, stored } = await composed()
    const id = sid('context')
    storeConversation(stored, id)
    const response = await remote(ctx).context({ sessionId: id })
    if (!response.ok) throw response.error
    expect(response.value.cursor).toBe(6)
    expect(response.value.messages).toEqual([
      { seq: 1, event: 'user/message', role: 'user', content: [{ type: 'text', text: 'prompt 1' }] },
      { seq: 4, event: 'user/message', role: 'user', content: [{ type: 'text', text: 'prompt 2' }] },
    ])
    expect(response.value.request).toBeUndefined()
    expect(response.value.next).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('reports system, assistant, tool, and projected messages with the request header and next-step preview', async () => {
    const { ctx, stored } = await composed()
    const retext: SessionMessageProjection<'test/retext'> = {
      type: 'test/retext',
      project: (event, context) => {
        const source = context.events[event.data.seq - context.baseSeq]
        if (source?.type !== 'user/message') throw new Error('test/retext targets a user message')
        const message: Message = { ...source.data, content: [{ type: 'text', text: event.data.text }] }
        return new Map([[event.data.seq, message]])
      },
    }
    ctx.sessions.registerMessageProjection(retext)
    ctx.provide('systemPrompt', {
      assemble: () => Promise.resolve({
        sections: [{ name: 'persona', text: 'next prompt' }], contexts: [], variables: {},
        tools: [{ name: 'bash', description: 'Run', parameters: {} }],
      }),
    } as never)
    const id = sid('rich-context')
    const session = Session.create(id, undefined, undefined, undefined, [retext])
    const call = ToolCallId('call-1')
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('system/message', {
      turn: 1, step: 1, message: createMessage({ role: 'system', content: [{ type: 'text', text: 'be brief' }], source: { kind: 'system-prompt' } }),
    }, { surfaceOp: 'append' })
    const user = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'ls' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('request/header', { reason: 'initial', header: { config: { provider: 'mock', model: 'mock' } } })
    session.append('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: createMessage({
        role: 'assistant', content: [{ type: 'tool-call', id: call, name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createMessage({ role: 'tool', toolCallId: call, source: { kind: 'tool', callId: call }, content: [{ type: 'text', text: 'a.txt' }], isError: false }),
    }, { surfaceOp: 'append' })
    session.append('test/retext', { seq: user.seq, text: 'list files' })
    session.append('step/end', { turn: 1, step: 1 })
    // An empty assistant message (a step that only reached its token cap) sends nothing.
    session.append('step/start', { turn: 1, step: 2 })
    session.append('assistant/message', {
      turn: 1, step: 2, stream: [],
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 2 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    stored.set(id, {
      meta: { version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/proj', isSeeded: false, delegationDepth: 0 },
      events: [...session.snapshotEvents()],
    })

    const response = await remote(ctx).context({ sessionId: id })
    if (!response.ok) throw response.error
    expect(response.value.messages).toEqual([
      { seq: 2, event: 'system/message', role: 'system', content: [{ type: 'text', text: 'be brief' }] },
      { seq: 3, event: 'user/message', role: 'user', content: [{ type: 'text', text: 'list files' }], projected: true },
      { seq: 5, event: 'assistant/message', role: 'assistant', content: [{ type: 'tool-call', id: call, name: 'bash', arguments: '{}' }] },
      { seq: 6, event: 'tool/result', role: 'tool', toolCallId: call, isError: false, content: [{ type: 'text', text: 'a.txt' }] },
    ])
    expect(response.value.request).toEqual({ config: { provider: 'mock', model: 'mock' } })
    expect(response.value.next).toEqual({ systemPrompt: 'next prompt', tools: [{ name: 'bash', description: 'Run', parameters: {} }] })
    await ctx.fiber.dispose()
  })

  it('reports a missing Session', async () => {
    const { ctx } = await composed()
    const response = await remote(ctx).context({ sessionId: sid('missing') })
    expect(response).toMatchObject({ ok: false, error: { code: 'session/not-found' } })
    await ctx.fiber.dispose()
  })
})
