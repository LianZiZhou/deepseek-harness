import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { authContextFrom, credentialStoreFrom, recordKeyFor } from '../src/auth.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { contributePiAiLogin } from '../src/external-login.ts'
import type { PiAiContributedKey } from '../src/external-login.ts'
import { registerPiAiFlows } from '../src/login.ts'

const ZAI = recordKeyFor('zai')
const CODEX = recordKeyFor('openai-codex')
const dirs: string[] = []

/** The section shape this package registers, narrowed to what a route declaration touches. */
const Section = z.object({ providers: z.dict(z.object({}).default({})).default({}) })

/** A context with the record store and the seam, ready for flows. */
async function harness(options: { settings?: Record<string, unknown>; writable?: boolean } = {}): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-contrib-'))
  dirs.push(dir)
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  if (options.settings !== undefined) {
    await ctx.plugin(MemorySettings, { doc: options.settings, writable: options.writable ?? true })
    installSettingsSection(ctx, settingsNamespace('llm-pi-ai'), Section, { providers: {} }, {
      setSource: () => {},
      onChange: () => {},
    })
  }
  return ctx
}

/** Mount the adapter's flows on a context. */
function mountFlows(ctx: Context): void {
  registerPiAiFlows(ctx, { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) })
}

/** An interaction that answers nothing, because a contributed run needs no human here. */
function surface(): AuthorizationInteraction {
  return { notify: () => {}, prompt: () => Promise.reject(new Error('unexpected prompt')) }
}

/** The ids of the methods one flow currently offers. */
function methodIds(ctx: Context, key = ZAI): string[] {
  return (ctx.authorization.describe(key)?.methods ?? []).map(method => method.id)
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('contributed pi-ai logins', () => {
  it('offers a contributed sign-in ahead of the key pi-ai would prompt for', async () => {
    const ctx = await harness()
    mountFlows(ctx)
    expect(methodIds(ctx)).toEqual(['api-key'])
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in with Z.AI' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })
    expect(methodIds(ctx)).toEqual(['oauth', 'api-key'])
    expect(ctx.authorization.describe(ZAI)?.methods[0]?.label).toBe('Sign in with Z.AI')
  })

  it('keeps a provider\'s own sign-in preferred over a contributed one', async () => {
    const ctx = await harness()
    mountFlows(ctx)
    contributePiAiLogin(ctx, {
      provider: 'openai-codex',
      method: { id: 'device-code', label: 'Enter a code instead' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })
    expect(methodIds(ctx, CODEX)).toEqual(['oauth', 'device-code'])
  })

  it('is offered on a flow mounted after the contribution arrived', async () => {
    const ctx = await harness()
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in with Z.AI' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })
    mountFlows(ctx)
    expect(methodIds(ctx)).toEqual(['oauth', 'api-key'])
  })

  it('stores the key a contributed run produced as the route\'s credential', async () => {
    const ctx = await harness()
    mountFlows(ctx)
    const run = vi.fn((session: AuthorizationSession): Promise<PiAiContributedKey> => {
      expect(session.method).toBe('oauth')
      return Promise.resolve({ apiKey: 'id.secret' })
    })
    contributePiAiLogin(ctx, { provider: 'zai', method: { id: 'oauth', label: 'Sign in' }, run })
    await expect(ctx.authorization.begin({ key: ZAI, method: 'oauth', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    expect(run).toHaveBeenCalledOnce()
    await expect(ctx.credentials.readRecord(ZAI)).resolves.toEqual({ kind: 'api-key', key: 'id.secret' })
  })

  it('declares the route it signed into, so the signed-in models are usable', async () => {
    const ctx = await harness({ settings: {} })
    mountFlows(ctx)
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'id.secret' }),
    })
    await expect(ctx.authorization.begin({ key: ZAI, method: 'oauth', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    const section = ctx.settings.describe().find(d => String(d.ns) === 'llm-pi-ai')?.value
    expect(section).toEqual({ providers: { zai: {} } })
  })

  it('leaves a route someone already configured exactly as it is', async () => {
    const configured = { 'llm-pi-ai': { providers: { zai: { baseURL: 'https://proxy.example/v1' } } } }
    const ctx = await harness({ settings: configured })
    mountFlows(ctx)
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'id.secret' }),
    })
    await expect(ctx.authorization.begin({ key: ZAI, method: 'oauth', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    const section = ctx.settings.describe().find(d => String(d.ns) === 'llm-pi-ai')?.value
    expect(section).toEqual({ providers: { zai: { baseURL: 'https://proxy.example/v1' } } })
  })
  it('keeps the credential when the settings document refuses the route', async () => {
    const ctx = await harness({ settings: {}, writable: false })
    mountFlows(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'id.secret' }),
    })
    await expect(ctx.authorization.begin({ key: ZAI, method: 'oauth', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    await expect(ctx.credentials.readRecord(ZAI)).resolves.toEqual({ kind: 'api-key', key: 'id.secret' })
    expect(warn).toHaveBeenCalled()
  })


  it('keeps the credential when no settings provider can take the route', async () => {
    const ctx = await harness()
    mountFlows(ctx)
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'id.secret' }),
    })
    await expect(ctx.authorization.begin({ key: ZAI, method: 'oauth', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    await expect(ctx.credentials.readRecord(ZAI)).resolves.toEqual({ kind: 'api-key', key: 'id.secret' })
  })

  it('refuses a contributed run that produced no usable key', async () => {
    const ctx = await harness()
    mountFlows(ctx)
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: '' }),
    })
    await expect(ctx.authorization.begin({ key: ZAI, method: 'oauth', interaction: surface() }))
      .rejects.toThrow(expect.objectContaining({ code: 'EMPTY_CONTRIBUTED_KEY' }))
    await expect(ctx.credentials.describeRecord(ZAI)).resolves.toMatchObject({ configured: false })
  })

  it('refuses a contribution for a route pi-ai does not ship', async () => {
    const ctx = await harness()
    expect(() => contributePiAiLogin(ctx, {
      provider: 'acme-gateway',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })).toThrow(expect.objectContaining({ code: 'UNKNOWN_PI_AI_ROUTE' }))
  })

  it('refuses a method id the route already offers', async () => {
    const ctx = await harness()
    expect(() => contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'api-key', label: 'Another key prompt' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })).toThrow(expect.objectContaining({ code: 'DUPLICATE_LOGIN_METHOD' }))

    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })
    expect(() => contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in again' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })).toThrow(expect.objectContaining({ code: 'DUPLICATE_LOGIN_METHOD' }))
  })

  it('withdraws one contributed method without disturbing the route\'s others', async () => {
    const ctx = await harness()
    mountFlows(ctx)
    const dispose = contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'first' }),
    })
    contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'device-code', label: 'Enter a code' },
      run: () => Promise.resolve({ apiKey: 'second' }),
    })
    expect(methodIds(ctx)).toEqual(['oauth', 'device-code', 'api-key'])
    dispose()
    expect(methodIds(ctx)).toEqual(['device-code', 'api-key'])
    await expect(ctx.authorization.begin({ key: ZAI, method: 'device-code', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    await expect(ctx.credentials.readRecord(ZAI)).resolves.toEqual({ kind: 'api-key', key: 'second' })
  })

  it('leaves the route as pi-ai ships it once every contribution is gone', async () => {
    const ctx = await harness()
    mountFlows(ctx)
    const dispose = contributePiAiLogin(ctx, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })
    dispose()
    dispose()
    expect(methodIds(ctx)).toEqual(['api-key'])
    await expect(ctx.authorization.begin({ key: ZAI, method: 'oauth', interaction: surface() }))
      .rejects.toThrow(expect.objectContaining({ code: 'UNKNOWN_METHOD' }))
  })

  it('keeps one composition\'s contributions out of another\'s', async () => {
    const first = await harness()
    const second = await harness()
    mountFlows(first)
    mountFlows(second)
    contributePiAiLogin(first, {
      provider: 'zai',
      method: { id: 'oauth', label: 'Sign in' },
      run: () => Promise.resolve({ apiKey: 'minted' }),
    })
    expect(methodIds(first)).toEqual(['oauth', 'api-key'])
    expect(methodIds(second)).toEqual(['api-key'])
  })
})
