import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService, { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationFlow, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { RemoteError, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
import type { AuthorizationNoticeEvent, AuthorizationPromptEvent } from '../src/types.ts'

const KEY = 'llm-pi-ai/zai'

/**
 * A refusal that is not an `Error` at runtime, as a foreign client library can
 * raise. Typed as one so the rejection reads as intentional rather than as the
 * mistake the lint rule is looking for.
 */
const NOT_AN_ERROR: Error = Object.assign(Object.create(null) as Error, { toString: () => 'nope' })
const dirs: string[] = []

/** A context carrying the credential store, the seam, and this controller. */
async function harness(): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-auth-controller-'))
  dirs.push(dir)
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  return ctx
}

/** Register one flow whose `run` this test drives. */
function register(
  ctx: Context,
  run: AuthorizationFlow['run'],
  methods: AuthorizationFlow['methods'] = [{ id: 'oauth', label: 'Sign in' }],
): void {
  ctx.authorization.registerFlow({ key: credentialKey('llm-pi-ai', 'zai'), label: 'Z.AI', methods, run })
}

/** Register a second flow on its own key, for the two-attempts-at-once cases. */
function registerSecond(ctx: Context, run: AuthorizationFlow['run']): void {
  ctx.authorization.registerFlow({
    key: credentialKey('llm-pi-ai', 'anthropic'),
    label: 'Anthropic',
    methods: [{ id: 'oauth', label: 'Sign in' }],
    run,
  })
}

/** Commit the record a flow is contracted to write. */
async function commit(ctx: Context, key = 'id.secret'): Promise<void> {
  await ctx.credentials.modifyRecord(credentialKey('llm-pi-ai', 'zai'), () =>
    Promise.resolve({ kind: 'api-key', key }))
}

/** Collect every notice and question this controller emits. */
function watch(ctx: Context): { notices: AuthorizationNoticeEvent[]; prompts: AuthorizationPromptEvent[] } {
  const notices: AuthorizationNoticeEvent[] = []
  const prompts: AuthorizationPromptEvent[] = []
  ctx.on('api-authorization/notice', (notice) => { notices.push(notice) })
  ctx.on('api-authorization/prompt', (prompt) => { prompts.push(prompt) })
  return { notices, prompts }
}

/** Wait until the flow has raised its question, which the page answers next. */
async function firstPrompt(prompts: AuthorizationPromptEvent[]): Promise<AuthorizationPromptEvent> {
  for (let attempt = 0; attempt < 200 && prompts.length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  const prompt = prompts[0]
  if (prompt === undefined) throw new Error('the flow raised no question')
  return prompt
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('the authorization Remote namespace', () => {
  it('exposes exactly the sign-in conversation', async () => {
    const ctx = await harness()
    expect(remoteMethods(ctx.authorizationController)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'begin', invocation: { kind: 'direct' } },
      { method: 'answer', invocation: { kind: 'direct' } },
      { method: 'decline', invocation: { kind: 'direct' } },
      { method: 'cancel', invocation: { kind: 'direct' } },
    ])
  })

  it('lists every registered flow with the methods it offers', async () => {
    const ctx = await harness()
    expect(ctx.authorizationController.list()).toEqual([])
    register(ctx, () => Promise.resolve(), [
      { id: 'oauth', label: 'Sign in' },
      { id: 'api-key', label: 'Z.AI API key' },
    ])
    expect(ctx.authorizationController.list()).toEqual([{
      key: KEY,
      label: 'Z.AI',
      methods: [{ id: 'oauth', label: 'Sign in' }, { id: 'api-key', label: 'Z.AI API key' }],
      inFlight: false,
    }])
  })

  it('answers with an empty list while no authorization seam is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AuthorizationController)
    expect(ctx.authorizationController.list()).toEqual([])
  })

  it('reports the actionable configuration error while no seam is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AuthorizationController)
    const calls: Array<() => Promise<unknown>> = [
      () => ctx.authorizationController.begin(KEY, undefined, new AbortController().signal),
      () => Promise.resolve().then(() => { ctx.authorizationController.cancel(KEY) }),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toThrow(RemoteError)
    }
  })

  it('runs a flow to its committed record and settles authorized', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    register(ctx, async (session) => {
      session.notify({ message: 'Open this page', url: 'https://chat.z.ai/authorize' })
      await commit(ctx)
    })
    await expect(ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal))
      .resolves.toEqual({ status: 'authorized' })
    expect(seen.notices).toEqual([expect.objectContaining({
      key: KEY,
      message: 'Open this page',
      url: 'https://chat.z.ai/authorize',
    })])
    expect(seen.notices[0]?.attempt).toEqual(expect.any(String))
  })

  it('carries a flow question to the page and its answer back', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    const answered = vi.fn()
    register(ctx, async (session) => {
      answered(await session.prompt({ kind: 'text', message: 'Paste the code', placeholder: 'code…' }))
      await commit(ctx)
    })
    const running = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    const prompt = await firstPrompt(seen.prompts)
    expect(prompt).toMatchObject({ key: KEY, kind: 'text', message: 'Paste the code', placeholder: 'code…' })
    ctx.authorizationController.answer(prompt.attempt, prompt.prompt, 'pasted-code')
    await expect(running).resolves.toEqual({ status: 'authorized' })
    expect(answered).toHaveBeenCalledWith('pasted-code')
  })

  it('carries a select question with its choices', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    register(ctx, async (session) => {
      await session.prompt({
        kind: 'select',
        message: 'Pick an account',
        options: [{ id: 'a', label: 'Work', description: 'the work tenant' }, { id: 'b', label: 'Personal' }],
      })
      await commit(ctx)
    })
    const running = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    const prompt = await firstPrompt(seen.prompts)
    expect(prompt.options).toEqual([
      { id: 'a', label: 'Work', description: 'the work tenant' },
      { id: 'b', label: 'Personal' },
    ])
    ctx.authorizationController.answer(prompt.attempt, prompt.prompt, 'a')
    await expect(running).resolves.toEqual({ status: 'authorized' })
  })

  it('settles cancelled when the human declines a question', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    register(ctx, async (session) => {
      await session.prompt({ kind: 'secret', message: 'Enter the key' })
      await commit(ctx)
    })
    const running = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    const prompt = await firstPrompt(seen.prompts)
    ctx.authorizationController.decline(prompt.attempt, prompt.prompt)
    await expect(running).resolves.toEqual({ status: 'cancelled' })
  })

  it('tells the page when a flow withdraws its own question', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    const closed: { attempt: string; prompt: string }[] = []
    ctx.on('api-authorization/prompt-closed', (event) => { closed.push(event) })
    const withdraw = new AbortController()
    register(ctx, async (session) => {
      const asked = session.prompt({ kind: 'text', message: 'Paste the code', signal: withdraw.signal })
      asked.catch(() => {})
      withdraw.abort()
      await commit(ctx)
    })
    const running = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    const prompt = await firstPrompt(seen.prompts)
    await expect(running).resolves.toEqual({ status: 'authorized' })
    expect(closed).toEqual([{ attempt: prompt.attempt, prompt: prompt.prompt }])
  })

  it('refuses an answer to a question that is not open', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    register(ctx, async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
      await commit(ctx)
    })
    const running = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    const prompt = await firstPrompt(seen.prompts)
    expect(() => { ctx.authorizationController.answer(prompt.attempt, 'not-a-prompt', 'x') })
      .toThrow(RemoteError)
    expect(() => { ctx.authorizationController.answer('not-an-attempt', prompt.prompt, 'x') })
      .toThrow(RemoteError)
    expect(() => { ctx.authorizationController.decline(prompt.attempt, 'not-a-prompt') })
      .toThrow(RemoteError)
    ctx.authorizationController.answer(prompt.attempt, prompt.prompt, 'code')
    await expect(running).resolves.toEqual({ status: 'authorized' })
    expect(() => { ctx.authorizationController.answer(prompt.attempt, prompt.prompt, 'again') })
      .toThrow(RemoteError)
  })

  it('fails the questions an ending sign-in leaves open', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    let orphan: Promise<string> | undefined
    register(ctx, async (session) => {
      orphan = session.prompt({ kind: 'text', message: 'Paste the code' })
      orphan.catch(() => {})
      await commit(ctx)
    })
    await expect(ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal))
      .resolves.toEqual({ status: 'authorized' })
    await firstPrompt(seen.prompts)
    await expect(orphan).rejects.toThrow(/ended while this question was open/)
  })

  it('withdraws a running attempt from a second call', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    register(ctx, async (session) => {
      session.notify({ message: 'waiting' })
      await new Promise<void>((resolve) => {
        session.signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    })
    const running = ctx.authorizationController.begin(KEY, undefined, new AbortController().signal)
    for (let attempt = 0; attempt < 200 && seen.notices.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    ctx.authorizationController.cancel(KEY)
    await expect(running).resolves.toEqual({ status: 'cancelled' })
  })

  it('reports a broken flow with the flow\'s own message', async () => {
    const ctx = await harness()
    register(ctx, () => Promise.reject(new Error('Z.AI token exchange failed')))
    await expect(ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal))
      .rejects.toThrow(RemoteError)
    await expect(ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal))
      .rejects.toMatchObject({ code: 'authorization/rejected', message: 'Z.AI token exchange failed', details: { key: KEY } })
  })

  it('reports a flow that refused with a bare string', async () => {
    const ctx = await harness()
    register(ctx, () => Promise.reject(NOT_AN_ERROR))
    await expect(ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal))
      .rejects.toMatchObject({ code: 'authorization/rejected', message: 'nope' })
  })

  it('settles cancelled when a declined prompt reaches the seam as a decline', async () => {
    const ctx = await harness()
    register(ctx, (session: AuthorizationSession) =>
      session.prompt({ kind: 'text', message: 'Paste the code' })
        .then(() => undefined, () => { throw new AuthorizationDeclinedError() }))
    const seen = watch(ctx)
    const running = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    const prompt = await firstPrompt(seen.prompts)
    ctx.authorizationController.decline(prompt.attempt, prompt.prompt)
    await expect(running).resolves.toEqual({ status: 'cancelled' })
  })

  it('refuses a key outside the credential-record grammar', async () => {
    const ctx = await harness()
    for (const key of ['llm-pi-ai', 'LLM/zai', 'llm-pi-ai/zai/extra', '']) {
      await expect(ctx.authorizationController.begin(key, undefined, new AbortController().signal))
        .rejects.toMatchObject({ code: 'gateway/bad-request' })
      expect(() => { ctx.authorizationController.cancel(key) }).toThrow(RemoteError)
    }
  })

  it('carries the verification code a device-code grant shows beside its page', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    register(ctx, async (session) => {
      session.notify({ message: 'Enter this code', url: 'https://z.ai/device', code: 'WXYZ-1234' })
      await commit(ctx)
    })
    await expect(ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal))
      .resolves.toEqual({ status: 'authorized' })
    expect(seen.notices[0]).toMatchObject({ url: 'https://z.ai/device', code: 'WXYZ-1234' })
  })

  it('says nothing more when a flow withdraws a question the page already answered', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    const closed: unknown[] = []
    ctx.on('api-authorization/prompt-closed', (event) => { closed.push(event) })
    const withdraw = new AbortController()
    register(ctx, async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code', signal: withdraw.signal })
      withdraw.abort()
      await commit(ctx)
    })
    const running = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    const prompt = await firstPrompt(seen.prompts)
    ctx.authorizationController.answer(prompt.attempt, prompt.prompt, 'code')
    await expect(running).resolves.toEqual({ status: 'authorized' })
    expect(closed).toEqual([])
  })

  it('leaves another attempt open question alone when one sign-in ends', async () => {
    const ctx = await harness()
    const seen = watch(ctx)
    let held: Promise<string> | undefined
    register(ctx, async (session) => {
      held = session.prompt({ kind: 'text', message: 'Z.AI code' })
      held.catch(() => {})
      await new Promise<void>((resolve) => {
        session.signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    })
    registerSecond(ctx, async (session) => {
      await session.prompt({ kind: 'text', message: 'Anthropic code' })
      await ctx.credentials.modifyRecord(credentialKey('llm-pi-ai', 'anthropic'), () =>
        Promise.resolve({ kind: 'api-key', key: 'other' }))
    })
    const first = ctx.authorizationController.begin(KEY, 'oauth', new AbortController().signal)
    await firstPrompt(seen.prompts)
    const second = ctx.authorizationController.begin(
      'llm-pi-ai/anthropic', 'oauth', new AbortController().signal)
    for (let attempt = 0; attempt < 200 && seen.prompts.length < 2; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    const other = seen.prompts[1] as AuthorizationPromptEvent
    ctx.authorizationController.answer(other.attempt, other.prompt, 'anthropic-code')
    await expect(second).resolves.toEqual({ status: 'authorized' })
    // The first attempt question survived the second attempt ending.
    const mine = seen.prompts[0] as AuthorizationPromptEvent
    ctx.authorizationController.answer(mine.attempt, mine.prompt, 'zai-code')
    await expect(held).resolves.toBe('zai-code')
    ctx.authorizationController.cancel(KEY)
    await expect(first).resolves.toEqual({ status: 'cancelled' })
  })

  it('refuses an empty method name rather than running the flow\'s first', async () => {
    const ctx = await harness()
    register(ctx, () => Promise.resolve())
    await expect(ctx.authorizationController.begin(KEY, '', new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })
})
