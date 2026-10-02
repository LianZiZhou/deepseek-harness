/**
 * Human-facing `/continue` command: resume the work an interrupted turn left
 * unfinished without sending the model a new message.
 * @module @deepseek-ai/dsh-command-continue
 */

import type { Context } from '@deepseek-ai/cordis'
import { resumeDecision } from '@deepseek-ai/dsh-agent'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-continue'
export const inject = ['commands']

const USAGE = 'Usage: /continue (no arguments)'

/**
 * Resume the invoking Agent's unfinished last turn, or say why not.
 * @param invocation - the dispatched command line and its receiving Agent.
 * @returns the settled outcome; the resumed turn runs after it.
 */
function executeContinue(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: USAGE }
  const decision = resumeDecision(invocation.agent)
  if (decision.kind === 'unavailable') return { kind: 'error', text: `Cannot continue: ${decision.reason}.` }
  decision.resume()
  return { kind: 'success', text: 'Continuing where the last turn stopped.' }
}

/**
 * Register `/continue` for every composed human-command adapter.
 * @param ctx - context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-continue'),
    name: 'continue',
    description: 'Resume an interrupted turn without sending a new message',
    handler: executeContinue,
  }), 'command-continue lifecycle')
}
