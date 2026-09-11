import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import SettingsController from '@deepseek-ai/dsh-api-settings-controller'
import type { AuthorizationInteraction, AuthorizationNotice } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import { recordKeyFor } from '@deepseek-ai/dsh-llm-pi-ai'
import * as zai from '../src/index.ts'
import { mintReplies, routed, TOKEN } from './fake-zai.ts'

const ZAI = recordKeyFor('zai')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot a composition from a real `cordis.yml` through the Loader. */
async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-zai-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-authorization', AuthorizationService],
    ['@deepseek-ai/dsh-api-settings-controller', SettingsController],
    ['@deepseek-ai/dsh-llm-pi-ai', piAi],
    ['@deepseek-ai/dsh-llm-zai-coding-plan', zai],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** The shipping composition: the credential plane, the seam, the adapter, this plugin. */
async function composed(config: readonly string[] = []): Promise<Context> {
  const loaded = await loadYaml([
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root ?? tmpdir(), 'credentials.yaml'))}`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-authorization'",
    "- name: '@deepseek-ai/dsh-api-settings-controller'",
    "- name: '@deepseek-ai/dsh-llm-pi-ai'",
    "- name: '@deepseek-ai/dsh-llm-zai-coding-plan'",
    ...config,
  ])
  const unloaded = [...loaded.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return loaded
}

/** An interaction that pastes one authorization code and records what it was told. */
function pasting(code: string): AuthorizationInteraction & { notices: AuthorizationNotice[] } {
  const notices: AuthorizationNotice[] = []
  return {
    notices,
    notify(notice) { notices.push(notice) },
    prompt: () => Promise.resolve(code),
  }
}

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; first resolution after the host/client program split is slow enough
  // to trip the default 5s budget on cold caches.
  it('offers the sign-in on the shipped zai flow and stores the key it mints', { timeout: 60_000 }, async () => {
    const loaded = await composed()
    const flow = loaded.authorization.describe(ZAI)
    expect(flow?.label).toBe('Z.AI')
    expect(flow?.methods.map(method => method.id)).toEqual(['oauth', 'api-key'])
    expect(flow?.methods[0]?.label).toBe('Sign in with Z.AI (GLM Coding Plan)')

    const context = routed(mintReplies({ [`POST ${TOKEN}`]: { code: 0, data: { zai: { access_token: 'oauth-token' } } } }))
    vi.stubGlobal('fetch', context.fetch)
    const interaction = pasting('pasted-code')
    await expect(loaded.authorization.begin({ key: ZAI, method: 'oauth', interaction }))
      .resolves.toEqual({ status: 'authorized' })

    expect(interaction.notices[0]?.url).toContain('https://chat.z.ai/api/oauth/authorize?')
    await expect(loaded.credentials.readRecord(ZAI))
      .resolves.toEqual({ kind: 'api-key', key: 'existing-key.secret' })
  })

  it('reports the sign-in through the Remote namespace a configuration page reads', { timeout: 60_000 }, async () => {
    const loaded = await composed()
    // Every installed provider that ships a login registers a flow, so the
    // namespace answers many; this one is the row a page renders the sign-in on.
    expect(loaded.authorizationController.list()).toContainEqual({
      key: 'llm-pi-ai/zai',
      label: 'Z.AI',
      methods: [
        { id: 'oauth', label: 'Sign in with Z.AI (GLM Coding Plan)' },
        { id: 'api-key', label: 'Z.AI API key' },
      ],
      inFlight: false,
    })
  })

  it('asks for the redirect a deployment corrected when the allowlist moved again', { timeout: 60_000 }, async () => {
    const loaded = await composed(['  config:', '    redirectUri: zcode://corrected/cb'])
    const context = routed(mintReplies({ [`POST ${TOKEN}`]: { code: 0, data: { zai: { access_token: 'oauth-token' } } } }))
    vi.stubGlobal('fetch', context.fetch)
    const interaction = pasting('pasted-code')
    await expect(loaded.authorization.begin({ key: ZAI, method: 'oauth', interaction }))
      .resolves.toEqual({ status: 'authorized' })
    const page = interaction.notices.find(notice => notice.url !== undefined)?.url
    expect(new URL(page as string).searchParams.get('redirect_uri')).toBe('zcode://corrected/cb')
  })

  it('takes the sign-in back off the flow when the plugin unloads', { timeout: 60_000 }, async () => {
    const loaded = await composed()
    const entry = [...loaded.loader.entries()]
      .find(candidate => candidate.options.name === '@deepseek-ai/dsh-llm-zai-coding-plan')
    await entry?.fiber?.dispose()
    expect(loaded.authorization.describe(ZAI)?.methods.map(method => method.id)).toEqual(['api-key'])
  })
})
