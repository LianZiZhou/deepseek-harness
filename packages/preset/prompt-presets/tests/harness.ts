/** Shared composition for the prompt-preset suites: a real settings file, a real prompt registry. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import type { Agent } from '@deepseek-ai/dsh-agent'
import PromptPresetStore from '@deepseek-ai/dsh-prompt-presets'
import type { Config } from '@deepseek-ai/dsh-prompt-presets'

/** Temp homes this file created, removed by {@link cleanup}. */
const homes: string[] = []

/** Remove every temp home a suite created. */
export async function cleanup(): Promise<void> {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
}

/** One composed harness plus the handles a test drives it with. */
export interface Harness {
  /** The composed root context. */
  readonly ctx: Context
  /** The store under test. */
  readonly store: PromptPresetStore
  /** The plugin fiber, for disposal tests. */
  readonly fiber: { dispose: () => unknown }
  /** Mint one fake agent over a fresh session. */
  agent: (id?: string) => Agent
  /** Mint one subagent child of `parent`, with the durable lineage a driver writes. */
  child: (parent: Agent, id?: string) => Agent
}

/**
 * Compose the store over a real file-backed settings provider.
 * @param config - the store's deployment configuration.
 * @param sections - prompt sections the assembly starts from.
 * @returns the composed harness.
 */
export async function harness(
  config: Partial<Config> = {},
  sections: readonly { name: string; order: number; text: string; complete?: boolean }[] = [],
): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-prompt-presets-'))
  homes.push(home)
  const settingsFile = join(home, 'settings.yaml')
  await writeFile(settingsFile, '{}\n')

  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  // The loop's own unit, registered here so blankness reads the way it does in
  // a real composition without dragging the whole agent loop into the suite.
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: true })
  await ctx.plugin(FileSettingsProvider, { path: settingsFile, watch: false })
  for (const section of sections) ctx.systemPrompt.section(section)
  const fiber = ctx.plugin(PromptPresetStore, config as Config)
  await fiber

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
  return { ctx, store: ctx.promptPresets, fiber, agent, child }
}

/**
 * Open a turn on a session so it stops counting as blank.
 * @param session - the session to advance.
 */
export function startTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
}
