/**
 * The session-log record of which prompt preset a session runs under.
 *
 * Unlike an agent preset, this one may change at any point in a session: the
 * system prompt is a replaceable surface node, so a switch costs the next
 * step's rendering and nothing else. Recording it is what lets a resumed or
 * forked session rebuild under the preset it actually ran, and the projection
 * is the only source the override reads.
 *
 * It is an ordinary required event. The envelope's `ignorable` marker exists
 * for event types a build does not know — downstream, out-of-repo ones — and
 * `Session.append` has no way to set it; an in-repo type earns its
 * compatibility by joining `KNOWN_SESSION_EVENT_TYPES` instead.
 *
 * @module @deepseek-ai/dsh-prompt-presets/session
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's prompt preset changed, or was cleared with `null`. Log-only
     * and accepted at any point: the next assembled step renders under it.
     */
    'prompt-preset/selected': { promptPreset: string | null }
  }
}

const promptPresetSchema = z.union([z.string(), z.null()])

/** Current Session prompt preset, advanced by selection events alone. */
export const promptPresetProjectionDefinition = {
  key: 'promptPreset',
  stateSchema: promptPresetSchema,
  // No header field: which preset a session runs is never a creation fact,
  // because a blank session's default is stamped as an ordinary selection.
  init: () => null,
  apply: (state, event) => event.type === 'prompt-preset/selected'
    ? event.data.promptPreset
    : state,
  wire: { viewSchema: promptPresetSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'promptPreset', string | null>
