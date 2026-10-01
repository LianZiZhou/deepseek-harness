/**
 * Shared composition for the prompt-preset suites: a real profile, a real
 * Loader, the real settings forms, and a real prompt registry.
 *
 * Stored presets are this package's own volatile Config, so a write is only
 * proven when it goes the whole way — a form write to the profile patch, the
 * Loader reconciling it, and the reference the store reads being committed —
 * which a fake settings service would only restate.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import PromptPresetStore from '@deepseek-ai/dsh-prompt-presets'
import type { PromptPreset } from '@deepseek-ai/dsh-prompt-presets'

/** Temp homes this file created, removed by {@link cleanup}. */
const homes: string[] = []
/** Roots this file booted, disposed by {@link cleanup}. */
const roots: Context[] = []

/** Dispose every root and remove every temp home a suite created. */
export async function cleanup(): Promise<void> {
  for (const root of roots.splice(0)) await root.fiber.dispose()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
}

/**
 * The entry config a bundle row carries — raw input, before the schema turns
 * the live fields into references.
 */
export interface RawConfig {
  presets?: Record<string, PromptPreset>
  default?: string
  protectedSections?: string[]
  maxPresets?: number
  maxRules?: number
  maxPatternLength?: number
  maxTextBytes?: number
}

/** One composed harness plus the handles a test drives it with. */
export interface Harness {
  /** The composed root context. */
  readonly ctx: Context
  /** The store under test. */
  readonly store: PromptPresetStore
  /** The store's own fiber, for disposal tests. */
  readonly fiber: { dispose: () => unknown }
  /** The temp DSH home, where the legacy settings document lives. */
  readonly home: string
  /** The profile patch a form write lands in. */
  readonly patchPath: string
  /** Mint one fake agent over a fresh session. */
  agent: (id?: string) => Agent
  /** Mint one subagent child of `parent`, with the durable lineage a driver writes. */
  child: (parent: Agent, id?: string) => Agent
}

/** The id the shipped bundles give this package, which writes address. */
export const ENTRY = 'prompt-presets'

/**
 * Compose the store inside a real profile.
 * @param config - the bundle layer's config for the store's entry.
 * @param sections - prompt sections the assembly starts from.
 * @param options - `settings: false` composes no settings service, the read-only deployment;
 *   `legacy` seeds the removed `$DSH_HOME/settings.yaml` that the first boot imports;
 *   `commands` composes the slash-command registry the `/prompt-preset` command joins;
 *   `homePatch` seeds `$DSH_HOME/cordis.patch.yml`, the layer that outranks the profile's own.
 * @returns the composed harness.
 */
export async function harness(
  config: RawConfig = {},
  sections: readonly { name: string; order: number; text: string; complete?: boolean }[] = [],
  options: { settings?: boolean; legacy?: string; commands?: boolean; homePatch?: string } = {},
): Promise<Harness> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-prompt-presets-')))
  homes.push(home)
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'session', name: 'cordis:sessions' },
    { id: 'session-projection', name: 'cordis:projections' },
    { id: 'system-prompt', name: 'cordis:prompt', config: { includeHarnessIdentity: true } },
    ...options.settings === false ? [] : [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
    ],
    ...options.commands === true ? [{ id: 'commands', name: 'cordis:commands' }] : [],
    { id: ENTRY, name: 'cordis:presets', config },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  if (options.legacy !== undefined) writeFileSync(join(home, 'settings.yaml'), options.legacy)
  if (options.homePatch !== undefined) writeFileSync(join(home, 'cordis.patch.yml'), options.homePatch)
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }

  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
    root.provide('profileContext', profile)
    root.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(root.loader.builtins, {
      sessions: SessionStore,
      projections: SessionProjectionRegistry,
      prompt: SystemPrompt,
      editor: ConfigEditor,
      settings: Settings,
      presets: PromptPresetStore,
      commands: CommandRuntime,
    })
  })
  roots.push(ctx)
  // The loop's own unit, registered here so blankness reads the way it does in
  // a real composition without dragging the whole agent loop into the suite.
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  for (const section of sections) ctx.systemPrompt.section(section)

  const entry = [...ctx.loader.entries()].find(row => row.options.id === ENTRY)
  /* v8 ignore next 2 -- the bundle above always composes this entry. */
  const fiber = entry?.fiber
  if (fiber === undefined) throw new Error('harness: the prompt-presets entry did not start')

  let minted = 0
  const agent = (id?: string): Agent => {
    const session: Session = ctx.sessions.create(SessionId(id ?? `agent-${String(++minted)}`))
    return { id: session.id, session, options: {} } as Agent
  }
  // The two fields a real driver records through `childSessionMeta`: coarse
  // origin and the delegating parent, which is what lets a child find the
  // preset its parent was running.
  const child = (parent: Agent, id?: string): Agent => {
    const session: Session = ctx.sessions.create(SessionId(id ?? `child-${String(++minted)}`), {
      meta: { origin: 'subagent', parentSession: parent.session.id, delegationDepth: 1 },
    })
    return { id: session.id, session, options: {} } as Agent
  }
  return { ctx, store: ctx.promptPresets, fiber, home, patchPath: profile.patchPath, agent, child }
}

/**
 * Open a turn on a session so it stops counting as blank.
 * @param session - the session to advance.
 */
export function startTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
}
