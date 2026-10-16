/**
 * REAL-composition proof: the shipped YAML rows boot through the vendored
 * Loader, and the durable `system/message` a step commits carries the selected
 * preset's transform — including over an agent preset that declared its own
 * persona complete.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import PromptPresetStore from '@deepseek-ai/dsh-prompt-presets'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-session', SessionStore],
  ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-prompt-presets', PromptPresetStore],
])

/** Boot one composition whose rows mirror the shipped base bundle. */
async function boot(composition: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-prompt-presets-loader-'))
  await writeFile(join(root, 'cordis.yml'), [...composition, ''].join('\n'))
  const ctx = new Context()
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!MODULES.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return MODULES.get(specifier)
    },
  } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  context = ctx
  return ctx
}

/** The prompt text one step would commit for this agent. */
async function committedPrompt(ctx: Context, agent: Agent): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)))
}

// No settings service: presets are this entry's own Config now, so reading
// and applying them needs none, and these cases never write.
const ROWS = [
  "- name: '@deepseek-ai/dsh-session'",
  "- name: '@deepseek-ai/dsh-session-projection'",
]

describe('real Loader composition', () => {
  it('loads the shipped rows and transforms the prompt the selected preset names', async () => {
    const ctx = await boot([
      ...ROWS,
      "- name: '@deepseek-ai/dsh-system-prompt'",
      '  config:',
      "    personaPrefix: ''",
      "- name: '@deepseek-ai/dsh-prompt-presets'",
      '  config:',
      "    default: ''",
      '    presets:',
      '      terse:',
      '        name: Terse',
      '        rules:',
      '          - kind: append',
      '            text: Answer in at most three sentences.',
    ])
    const session = ctx.sessions.create(SessionId('loader'))
    const agent = { id: session.id, session, options: {} } as Agent

    expect(await committedPrompt(ctx, agent))
      .toBe('You are an AI agent powered by DeepSeek Harness.')

    await ctx.promptPresets.select(agent, 'terse')
    expect(await committedPrompt(ctx, agent)).toBe(
      'You are an AI agent powered by DeepSeek Harness.\n\nAnswer in at most three sentences.',
    )

    await ctx.promptPresets.select(agent, null)
    expect(await committedPrompt(ctx, agent))
      .toBe('You are an AI agent powered by DeepSeek Harness.')
  })

  it('outranks a composition that declared its own persona the complete prompt', async () => {
    const ctx = await boot([
      ...ROWS,
      "- name: '@deepseek-ai/dsh-system-prompt'",
      '  config:',
      '    includeHarnessIdentity: false',
      "    personaPrefix: 'You are the deployment assistant.'",
      "- name: '@deepseek-ai/dsh-prompt-presets'",
      '  config:',
      "    default: 'takeover'",
      '    presets:',
      '      takeover:',
      '        name: Takeover',
      '        rules:',
      '          - kind: replace',
      '            text: You are a calculator.',
    ])
    const session = ctx.sessions.create(SessionId('loader-complete'))
    const agent = { id: session.id, session, options: {} } as Agent
    // The deployment persona is the whole prompt until a preset says otherwise.
    expect(await committedPrompt(ctx, agent)).toBe('You are the deployment assistant.')

    await ctx.parallel('agent/created', { agent, source: 'startup' })
    expect(ctx.sessionProjections.stateOf(session, 'promptPreset')).toBe('takeover')
    expect(await committedPrompt(ctx, agent)).toBe('You are a calculator.')
  })
})
