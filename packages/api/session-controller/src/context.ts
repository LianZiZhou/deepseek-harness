/** Model-context inspection: the history and request state the next model call of one Session reads. */

import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionContextMessage, SessionContextValue } from './types.ts'

/**
 * Read the model context of one live Session. Messages are the derived
 * history in surface order, each paired with the event that produced it; a
 * plugin message projection (an offloaded image, say) appears as projected.
 * The request header is the latest logged one. The `next` preview runs a
 * side-effect-free prompt assembly, showing the system prompt and tools the
 * next step would log when they differ from the logged ones.
 * @param ctx - Host context carrying the optional system-prompt service.
 * @param agent - live Agent whose Session is read.
 * @returns the context snapshot at the Session's current last seq.
 */
export async function readSessionContext(ctx: Context, agent: Agent): Promise<SessionContextValue> {
  const session = agent.session
  // oxlint-disable-next-line typescript/no-deprecated -- Inspection reads the complete live log once.
  const events = session.snapshotEvents()
  const derived = new Map<string, Message>(session.deriveMessages().map(message => [message.id, message]))
  const messages: SessionContextMessage[] = []
  for (const seq of session.surface.nodes) {
    const event = events[seq]
    if (event === undefined) continue
    const original = eventMessage(event)
    if (original === undefined) continue
    const message = derived.get(original.id)
    if (message === undefined) continue
    messages.push(contextMessage(seq, event.type, message, message !== original))
  }
  const header = session.requestHeader()
  const value: SessionContextValue = {
    cursor: events.at(-1)?.seq ?? -1,
    messages,
    ...header === undefined ? {} : { request: json(header) },
  }
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt === undefined) return value
  const assembly = await systemPrompt.assemble({ ...assembleContextFor(agent), preview: true })
  return { ...value, next: { systemPrompt: renderPrompt(assembly), tools: json(assembly.tools) } }
}

function eventMessage(event: SessionEvent): Message | undefined {
  switch (event.type) {
    case 'user/message':
      return event.data
    case 'system/message':
    case 'developer/message':
    case 'assistant/message':
    case 'tool/result':
      return event.data.message
    // Other surface-eligible events are plugin-owned; their projected messages carry no producing message here.
    default:
      return undefined
  }
}

function contextMessage(seq: number, event: string, message: Message, projected: boolean): SessionContextMessage {
  return {
    seq,
    event,
    role: message.role,
    content: json(message.content),
    ...message.role === 'tool'
      ? { toolCallId: message.toolCallId, ...message.isError === undefined ? {} : { isError: message.isError } }
      : {},
    ...projected ? { projected: true } : {},
  }
}

/** Session values are lossless JSON by the Session append contract; this re-types them for the wire. */
function json<T>(value: T): JsonValue {
  return value as JsonValue
}
