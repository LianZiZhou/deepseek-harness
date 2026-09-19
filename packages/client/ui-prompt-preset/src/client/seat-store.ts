/**
 * The per-session switcher's model.
 *
 * Unlike the agent-preset seat there is nothing to stage: a prompt preset may
 * change at any point in a task, so the control writes straight through and the
 * session's own projection reports the result.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One option the switcher offers. */
export interface PresetOption {
  /** The preset id, or `''` for "no preset". */
  id: string
  /** What the menu shows. */
  name: string
}

/** Everything the switcher renders. */
export interface PromptPresetSeatState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** Every stored preset, plus nothing-selected as the leading option. */
  options: readonly PresetOption[]
  /** Whether a switch is in flight. */
  switching: boolean
  /** The last refused switch, cleared by the next one. */
  error: string | null
}

const INITIAL: PromptPresetSeatState = {
  status: 'idle',
  options: [],
  switching: false,
  error: null,
}

/** Roster and switching for one session's prompt-preset control. */
export class PromptPresetSeatController {
  /** What the control renders, bound by the renderer as `usePromptPresetSeat`. */
  readonly store: SnapshotStore<PromptPresetSeatState> = createSnapshotStore(INITIAL)

  /** Monotonic read generation, so a late roster cannot overwrite a newer one. */
  private generation = 0

  constructor(
    private readonly ctx: ClientContext,
    /** The session this seat switches, when one is bound. */
    private readonly sessionId: () => SessionId | undefined,
  ) {}

  /** Merge one patch into the rendered state. */
  private set(patch: Partial<PromptPresetSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the roster the menu offers.
   * @returns when the newest read has been applied.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.store.getSnapshot().status === 'idle') this.set({ status: 'loading' })
    const result = await this.ctx.remote.promptPresets.list()
    if (generation !== this.generation) return
    if (!result.ok) {
      // A deployment that composes no store renders no control at all.
      this.set({ status: 'unavailable', options: [] })
      return
    }
    this.set({
      status: 'ready',
      options: result.value.presets.map(row => ({ id: row.promptPreset, name: row.name })),
    })
  }

  /**
   * Switch this session's preset.
   * @param id - the preset to run, or `''` to run none.
   * @returns when the write has settled.
   */
  async select(id: string): Promise<void> {
    const sessionId = this.sessionId()
    if (sessionId === undefined || this.store.getSnapshot().switching) return
    this.set({ switching: true, error: null })
    const result = await this.ctx.remote.promptPresets.select(sessionId, id === '' ? null : id)
    this.set({ switching: false, ...result.ok ? {} : { error: result.error.message } })
  }

  /** Clear the last refusal, once the person has seen it. */
  clearError(): void {
    this.set({ error: null })
  }
}
