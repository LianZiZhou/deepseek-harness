import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationNotice, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { parseAuthorizationAnswer, REDIRECT_URI, runZaiSignIn } from '../src/oauth.ts'
import { mintReplies, routed, TOKEN } from './fake-zai.ts'
import type { Replies } from './fake-zai.ts'

afterEach(() => { vi.unstubAllGlobals() })

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

/** A session whose prompt answers from `answer`. */
function surfaceOf(answer: (notices: AuthorizationNotice[]) => Promise<string>): AuthorizationSession & {
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
      return answer(notices)
    },
  }
}

describe('reading an authorization answer', () => {
  it('reads the whole redirect address', () => {
    expect(parseAuthorizationAnswer(' zcode://zai-auth/callback?code=a&state=b '))
      .toEqual({ code: 'a', state: 'b' })
    expect(parseAuthorizationAnswer('zcode://zai-auth/callback')).toEqual({})
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
  it('asks Z.AI for the one redirect their allowlist still accepts', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(notices => Promise.resolve(
      `${REDIRECT_URI}?code=code-1&state=${authorizeParam(notices, 'state')}`))
    await expect(runZaiSignIn(session, { fetch: context.fetch }))
      .resolves.toEqual({ apiKey: 'existing-key.secret' })

    expect(REDIRECT_URI).toBe('zcode://zai-auth/callback')
    expect(authorizeParam(session.notices, 'redirect_uri')).toBe(REDIRECT_URI)
    expect(authorizeParam(session.notices, 'client_id')).toBe('client_P8X5CMWmlaRO9gyO-KSqtg')
    expect(authorizeParam(session.notices, 'response_type')).toBe('code')
    expect(session.notices[0]?.url).toContain('https://chat.z.ai/api/oauth/authorize?')
  })

  it('sends the token exchange the same redirect the authorize page was given', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.resolve('code-2'))
    await runZaiSignIn(session, { fetch: context.fetch })
    const exchange = vi.mocked(context.fetch).mock.calls.find(([url]) => url === TOKEN) as [string, RequestInit]
    expect(JSON.parse(exchange[1].body as string)).toMatchObject({
      provider: 'zai',
      code: 'code-2',
      redirect_uri: REDIRECT_URI,
    })
  })

  it('asks for a redirect a deployment corrected when the allowlist moved again', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.resolve('code-3'))
    await runZaiSignIn(session, { fetch: context.fetch, redirectUri: 'zcode://elsewhere/cb' })
    expect(authorizeParam(session.notices, 'redirect_uri')).toBe('zcode://elsewhere/cb')
    const asked = session.prompts[0] as Extract<AuthorizationPrompt, { kind: 'text' }>
    expect(asked.placeholder).toBe('zcode://elsewhere/cb?code=…')
  })

  it('tells the human the address their browser cannot open is the thing to copy', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.resolve('code-4'))
    await runZaiSignIn(session, { fetch: context.fetch })
    expect(session.notices[0]?.message).toContain('cannot open')
    expect(session.notices.map(notice => notice.message)).toContain('Provisioning your Z.AI API key…')
  })

  it('runs on the ambient fetch when none is supplied', async () => {
    const context = routed(signInReplies())
    vi.stubGlobal('fetch', context.fetch)
    const session = surfaceOf(() => Promise.resolve('code-5'))
    await expect(runZaiSignIn(session)).resolves.toEqual({ apiKey: 'existing-key.secret' })
  })

  it('refuses an answer that carries no code', async () => {
    const context = routed(signInReplies())
    for (const pasted of ['', `${REDIRECT_URI}?code=`]) {
      const session = surfaceOf(() => Promise.resolve(pasted))
      await expect(runZaiSignIn(session, { fetch: context.fetch })).rejects.toMatchObject({ code: 'ZAI_NO_CODE' })
    }
  })

  it('refuses an answer minted for a different attempt', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.resolve('code-6#someone-elses-state'))
    await expect(runZaiSignIn(session, { fetch: context.fetch }))
      .rejects.toMatchObject({ code: 'ZAI_STATE_MISMATCH' })
  })

  it('refuses a token exchange that returned no access token', async () => {
    const context = routed(signInReplies({ [`POST ${TOKEN}`]: { code: 0, data: { user: { id: 1 } } } }))
    const session = surfaceOf(() => Promise.resolve('code-7'))
    await expect(runZaiSignIn(session, { fetch: context.fetch }))
      .rejects.toMatchObject({ code: 'ZAI_NO_ACCESS_TOKEN' })
  })

  it('carries a declined paste out to the caller', async () => {
    const context = routed(signInReplies())
    const session = surfaceOf(() => Promise.reject(new Error('declined')))
    await expect(runZaiSignIn(session, { fetch: context.fetch })).rejects.toThrow('declined')
  })
})
