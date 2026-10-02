/**
 * Which Sessions have unfinished work an {@link Agent.resume} would pick up.
 *
 * One policy for every surface that offers resuming — the Session Controller
 * Remote and the `/continue` command — so they refuse the same Sessions with
 * the same reasons. The Agent itself resumes whatever it is asked to; this is
 * the caller's decision the contract leaves open.
 *
 * @module @deepseek-ai/dsh-agent/resume
 */

import type { Agent } from './types.ts'

/**
 * Turn endings that left work unfinished: a failed request, a stop, a crash
 * repaired on resume, the output cap, or a fork cut inside the Turn. A
 * completed or blocked Turn has nothing to pick up.
 */
export const RESUMABLE_TURN_ENDINGS: ReadonlySet<string> = new Set([
  'error', 'aborted', 'interrupted', 'max-tokens', 'forked',
])

/** Whether one Agent may resume now: the bound action, or why not. */
export type ResumeDecision =
  | { readonly kind: 'resumable'; readonly resume: () => void }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Decide whether one Agent's Session has unfinished work to resume now.
 * @param agent - the Agent whose Session would resume.
 * @returns the bound resume action, or a user-facing reason it is unavailable.
 */
export function resumeDecision(agent: Agent): ResumeDecision {
  const unavailable = (reason: string): ResumeDecision => ({ kind: 'unavailable', reason })
  const resume = agent.resume?.bind(agent)
  if (resume === undefined) return unavailable('this agent cannot resume unfinished work')
  if (agent.status !== 'idle') return unavailable('the session is still running')
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const last = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
  if (last === undefined) return unavailable('the session has no turn to resume')
  const ending = last.data.reason.kind
  if (!RESUMABLE_TURN_ENDINGS.has(ending)) {
    return unavailable(`the last turn ended ${ending}; there is nothing unfinished to resume`)
  }
  return { kind: 'resumable', resume }
}
