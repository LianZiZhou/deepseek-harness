import { memo } from 'react'
import { Button, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, PerformanceUsageInjected, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>
  & InjectFace<PerformanceUsageInjected>

function lastContent(snapshot: ChatSnapshot, turn: number): ChatNode | undefined {
  const keys = snapshot.locations.getTurn(turn)
  for (let index = keys.length - 1; index >= 0; index--) {
    const node = snapshot.nodes.get(keys[index] as string) as ChatNode | undefined
    if (node === undefined || node.kind === 'turn-tail' || node.kind === 'turn-process') continue
    return node
  }
  return undefined
}

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, resume, renderSlot, t, useChat, usePerformanceUsage,
}: TurnTailNodeViewProps) {
  const detailed = usePerformanceUsage(mode => mode) === 'detailed'
  const data = node.data
  // Only the latest Turn resumes; a resumed Turn opens after it, which retires the action.
  const isLatest = useChat(snapshot => snapshot.timeline.turnOrder.at(-1) === data.turn)
  const endsWithResponse = useChat((snapshot) => {
    if (snapshot.timeline.turnOrder.at(-1) !== data.turn) return false
    const last = lastContent(snapshot, data.turn)
    const block = last?.kind === 'assistant-step' ? last.data.blocks.findLast(candidate =>
      (candidate.kind !== 'text' && candidate.kind !== 'reasoning') || candidate.text.trim() !== '') : undefined
    return block !== undefined && hasAssistantReplyContent([block])
  })
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  const tail = renderSlot('conversation.chat.turnTail', owner)
  const resumeAction = data.resumable && isLatest
    ? (
      <Button
        className={css.resume}
        size="sm"
        variant="outline"
        icon={<IconPlayOutlineRegular size={14} />}
        title={t('turn.resumeHint')}
        onClick={resume}
      >
        {t('turn.resume')}
      </Button>
    )
    : null
  if (closing === null) {
    return tail === null && resumeAction === null
      ? null
      : <div className={css.root} data-turn-tail={data.turn}>{tail}{resumeAction}</div>
  }
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  return (
    <div
      className={css.root}
      data-turn-tail={data.turn}
      data-actions-reveal={endsWithResponse ? 'always' : 'hover'}
    >
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        clock="end"
        // The branch action owns boundary resolution: it sends the real
        // turn/end seq it already has, and the Host cuts exactly there.
        onBranch={() => { forkAt(data.seq) }}
        branchUnavailable={data.branchUnavailable}
        className={css.actions}
        extraActions={assistantActions}
        usageAction={detailed && data.tokenUsage !== undefined
          ? <TurnUsagePanel usage={data.tokenUsage} t={t} />
          : null}
        t={t}
      />
      {resumeAction}
    </div>
  )
})
