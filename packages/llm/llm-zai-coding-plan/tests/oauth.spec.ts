import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationNotice, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { parseAuthorizationAnswer, runZaiSignIn } from '../src/oauth.ts'
import { mintReplies, routed, TOKEN } from './fake-zai.ts'
import type { Replies } from './fake-zai.ts'

const blockers: Server[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(blockers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

/** The replies of a sign-in that ends in `existing-key.secret`. */
function signInReplies(extra: Replies = {}): Replies {
  return mintReplies({
    [`POST ${TOKEN}`]: { code: 0, data: { zai: { access_token: 'oauth-token' } } },
    ...extra,
  })
}

/** One search parameter of the authorize page the flow sent the human to. */
function authorizeParam(notices: readonly AuthorizationNotice[], name: string): string {
  const page = notices.find(notice => notice.url !== undefined)?.url
  return new URL(page as string).searchParams.get(name) as string
}

/** A session whose prompt answers from `answer`, or waits to be withdrawn. */
function surfaceOf(answer?: (notices: AuthorizationNotice[]) => Promise<string>): AuthorizationSession & {
  notices: AuthorizationNotice[]
  prompts: AuthorizationPrompt[]
} {
  const notices: AuthorizationNotice[] = []
  const prompts: AuthorizationPrompt[] = []
  return {
    notices,
    prompts,
    method: 'oauth',
    signal: new AbortController().signal,
    notify(notice) { notices.push(notice) },
    prompt(prompt) {
      prompts.push(prompt)
      if (answer !== undefined) return answer(notices)
      return new Promise<string>((_resolve, reject) => {
        prompt.signal?.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
      })
    },
  }
}

describe('reading an authorization answer', () => {
  it('reads the whole redirect address', () => {
    expect(parseAuthorizationAnswer(' http://localhost:54548/callback?code=a&state=b '))
      .toEqual({ code: 'a', state: 'b' })
    expect(parseAuthorizationAnswer('http://localhost:54548/callback')).toEqual({})
  })

  it('reads the code-and-state pair Z.AI shows for a manual copy', () => {
    expect(parseAuthorizationAnswer('a#b')).toEqual({ code: 'a', state: 'b' })
  })

  it('reads a bare query string', () => {
    expect(parseAuthorizationAnswer('code=a&state=b')).toEqual({ code: 'a', state: 'b' })
    expect(parseAuthorizationAnswer('code=a')).toEqual({ code: 'a' })
  })

  it('takes anything else as the code itself', () => {
    expect(parseAuthorizationAnswer('bare-code')).toEqual({ code: 'bare-code' })
    expect(parseAuthorizationAnswer('   ')).toEqual({})
  })
})

describe('the GLM Coding Plan sign-in', () => {
  it('completes from the browser redirect without troubling the human', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf()
    const delivered = runZaiSignIn({
      ...session,
      notify(notice) {
        session.notify(notice)
        if (notice.url === undefined) return
        const redirect = new URL(authorizeParam(session.notices, 'redirect_uri'))
        redirect.searchParams.set('code', 'code-1')
        redirect.searchParams.set('state', authorizeParam(session.notices, 'state'))
        void fetch(redirect).catch(() => {})
      },
    }, { fetch: context.fetch, port: 0 })
    await expect(delivered).resolves.toEqual({ apiKey: 'existing-key.secret' })
    expect(session.notices[0]?.message).toContain('listening for the redirect')
    const exchange = vi.mocked(context.fetch).mock.calls.find(([url]) => url === TOKEN) as [string, RequestInit]
    expect(JSON.parse(exchange[1].body as string)).toMatchObject({ provider: 'zai', code: 'code-1' })
  })

  it('withdraws the paste question once the redirect arrives', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf()
    await runZaiSignIn({
      ...session,
      notify(notice) {
        session.notify(notice)
        if (notice.url === undefined) return
        const redirect = new URL(authorizeParam(session.notices, 'redirect_uri'))
        redirect.searchParams.set('code', 'code-1')
        void fetch(redirect).catch(() => {})
      },
    }, { fetch: context.fetch, port: 0 })
    expect(session.prompts[0]?.signal?.aborted).toBe(true)
  })

  it('completes from a pasted redirect address', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(notices => Promise.resolve(
      `http://localhost:9/callback?code=code-2&state=${authorizeParam(notices, 'state')}`))
    await expect(runZaiSignIn(session, { fetch: context.fetch, port: 0 }))
      .resolves.toEqual({ apiKey: 'existing-key.secret' })
  })

  it('completes from a pasted code with no state to check', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.resolve('code-3'))
    await expect(runZaiSignIn(session, { fetch: context.fetch, port: 0 }))
      .resolves.toEqual({ apiKey: 'existing-key.secret' })
  })

  it('asks for a paste when the loopback port is already taken', async () => {
    const blocker = createServer()
    blockers.push(blocker)
    await new Promise<void>((resolve) => { blocker.listen(0, '127.0.0.1', () => { resolve() }) })
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.resolve('code-4'))
    await expect(runZaiSignIn(session, { fetch: context.fetch, port: (blocker.address() as AddressInfo).port }))
      .resolves.toEqual({ apiKey: 'existing-key.secret' })
    expect(session.notices[0]?.message).toContain('paste the address')
  })

  it('runs on the ambient fetch and the registered port when neither is supplied', async () => {
    const context = routed(signInReplies())
    vi.stubGlobal('fetch', context.fetch)
    const session = surfaceOf(notices => Promise.resolve(
      `http://localhost:9/callback?code=code-5&state=${authorizeParam(notices, 'state')}`))
    await expect(runZaiSignIn(session)).resolves.toEqual({ apiKey: 'existing-key.secret' })
    expect(authorizeParam(session.notices, 'redirect_uri')).toBe('http://localhost:54548/callback')
  })

  it('refuses an answer that carries no code', async () => {
    const context = routed(signInReplies())
    for (const pasted of ['', 'http://localhost:9/callback?code=']) {
      const session = surfaceOf(() => Promise.resolve(pasted))
      await expect(runZaiSignIn(session, { fetch: context.fetch, port: 0 })).rejects.toThrow(
        expect.objectContaining({ code: 'ZAI_NO_CODE' }),
      )
    }
  })

  it('refuses an answer minted for a different attempt', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.resolve('code-6#someone-elses-state'))
    await expect(runZaiSignIn(session, { fetch: context.fetch, port: 0 })).rejects.toThrow(
      expect.objectContaining({ code: 'ZAI_STATE_MISMATCH' }),
    )
  })

  it('refuses a token exchange that returned no access token', async () => {
    const context = routed(signInReplies({ [`POST ${TOKEN}`]: { code: 0, data: { user: { id: 1 } } } }))
    const session = surfaceOf(() => Promise.resolve('code-7'))
    await expect(runZaiSignIn(session, { fetch: context.fetch, port: 0 })).rejects.toThrow(
      expect.objectContaining({ code: 'ZAI_NO_ACCESS_TOKEN' }),
    )
  })

  it('carries a declined paste out to the caller', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.reject(new Error('declined')))
    await expect(runZaiSignIn(session, { fetch: context.fetch, port: 0 })).rejects.toThrow('declined')
  })
})
