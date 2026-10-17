/** Session commands whose activation policy is explicit at each Remote method. */

import { modelAvailable } from './catalog.ts'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { resumeDecision } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentAdmissionPart, FileAttachmentRef, ImageAttachmentRef,
} from '@deepseek-ai/dsh-attachment'
import type { FileUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/types'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import {
  ReasoningEffortId, assistantStreamChunks, createUserMessage, freezeMessage,
} from '@deepseek-ai/dsh-llm'
import { ToolCallId, type ContentBlock, type MessageSource } from '@deepseek-ai/dsh-llm'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { buildRewriteLog, SessionRewriteError, type SessionEditOp } from '@deepseek-ai/dsh-session/rewrite'
import { Session, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  ApiSessionForeignOwner,
  ApiSessionNotFound,
  ApiSessionPresetConflict,
  ApiSessionSubagentOwnership,
  apiSessionSubagentOwnershipError,
  hasApiSessionSubagentOwner,
  inspectApiSession,
  type ApiSessionCreated,
} from './agent.ts'
import type {
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionResumeRequest,
  SessionResumeValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionForkRequest,
  SessionForkValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionEdit,
  SessionEditBlock,
  SessionRewriteRequest,
  SessionRewriteValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  SessionRequestId,
} from './types.ts'

interface SessionReadState {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
}

type PromptContentCandidate =
  | SessionPromptRequest['content'][number]
  | Extract<SessionUpdateQueueRequest['action'], { readonly kind: 'edit' }>['content'][number]

/**
 * Whether prompt content carries non-whitespace text or an attachment.
 * @param content - submitted or edited prompt parts.
 * @returns false for content the Agent must not receive.
 */
export function hasPromptContent(content: readonly PromptContentCandidate[]): boolean {
  return content.some(part => part.type !== 'text' || part.text.trim().length > 0)
}

/**
 * Resolve the omitted-`atSeq` default to the latest completed-turn prefix,
 * including standalone events before the next turn begins.
 */
function latestCompletedPrefixBoundary(events: readonly SessionEvent[]): SessionSeq | undefined {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break
    boundary = next.seq
  }
  return boundary
}

/**
 * Resolve the omitted-`atSeq` default: the latest completed-turn prefix while
 * no later Turn has opened, otherwise the live tail of the open Turn — a
 * running or never-finished Turn forks as it stands, and the child receives
 * the same synthetic closers a crash would. Trailing splices that only queue
 * input are left behind, so input still waiting to be claimed is not
 * delivered twice; a trailing removal stays, so nothing claimed reappears.
 */
function defaultForkBoundary(events: readonly SessionEvent[]): SessionSeq | undefined {
  const completed = latestCompletedPrefixBoundary(events)
  const opened = events.findLast(event => event.type === 'turn/start')
  if (opened === undefined || (completed !== undefined && opened.seq < completed)) return completed
  return events.findLast(event => !isQueuedInput(event))?.seq
}

/** A splice that only queues input nobody has claimed yet. */
function isQueuedInput(event: SessionEvent): boolean {
  return event.type === 'agent/inbox/spliced' && event.data.removedCount === undefined
}

/** Implements Session business commands delegated by the Session Controller Remote service. */
export class SessionCommandController {
  /**
   * @param ctx - Host context carrying Agent, model, attachment, title, and Workspace services.
   * @param agents - sole owner of create, resume, and Session-local model selection.
   * @param defaultCwd - project directory used when create names neither a Workspace nor a cwd.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly defaultCwd: string,
  ) {}

  /**
   * Create one ordinary Session for a new conversation, reusing the named
   * blank Session while it is an unarchived member of the requested Workspace.
   * @param request - optional blank Session to reuse, location, and Agent preset.
   * @returns the created or reused Session identity and its preset when configured.
   */
  async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      throw new RemoteError('gateway/bad-request', 'session.create accepts workspaceId or cwd, not both', {})
    }
    let workspace: Workspace | undefined
    if (request.workspaceId !== undefined) {
      workspace = this.ctx.workspaceRegistry.get(request.workspaceId)
      if (workspace === undefined) {
        throw new RemoteError('workspace/not-found', `workspace "${request.workspaceId}" not found`, {
          workspaceId: request.workspaceId,
        })
      }
    }
    const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd
    let created: ApiSessionCreated
    try {
      created = await this.agents.createSession({
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        cwd,
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
        reusable: sessionId => !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)
          && (workspace === undefined || workspace.sessionIds.includes(sessionId)),
      })
    } catch (error) {
      this.rejectCreation(error)
    }
    const sessionId = created.agent.id
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId, ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }) }
  }

  /**
   * Validate and install one Session-local model selection; save the default in the background.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session, without waiting for default persistence.
   */
  async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    const agent = await this.resolveAgent(request.sessionId)
    return this.agents.serializeImageAdmission(agent, async () => {
      try {
        await this.requireModel(request)
        const resolved = await this.ctx.llm.resolveCallConfig({
          provider: request.provider,
          model: request.model,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
        })
        const selected: AgentModelSelection = {
          provider: resolved.provider,
          model: resolved.model,
          ...(resolved.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: resolved.reasoningEffort }),
        }
        this.agents.selectForNextRequest(agent, selected)
        void this.ctx.agentDefaultModel.saveSelection(selected).catch((error: unknown) => {
          this.ctx.logger.warn(
            `session-controller: model selection changed for the Session but the default was not saved: ${String(error)}`,
          )
        })
        return { selected: { ...selected } }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'session/model-unavailable',
          error instanceof Error ? error.message : String(error),
          { provider: request.provider, model: request.model },
        )
      }
    })
  }

  /**
   * Normalize and append a user-owned Session title.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  async rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    const agent = await this.resolveAgent(request.sessionId)
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) {
      throw new RemoteError('gateway/internal', 'renaming is unavailable: this deployment mounts no session-title service', {})
    }
    try {
      const accepted = titles.rename(agent.session, request.title)
      return { title: accepted.title, seq: accepted.eventSeq }
    } catch (error) {
      if (error instanceof SessionTitleInvalidError) {
        throw new RemoteError('session/title-invalid', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `failed to rename session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
  }

  /**
   * Create a new ordinary Session from an exact event prefix. An explicit
   * `atSeq` is the inclusive cut; an omitted value selects the latest
   * completed-turn prefix, or the live tail of a Turn opened after it. An
   * open cut receives synthetic fork closers.
   * @param request - source Session and optional exact event boundary.
   * @returns the new Session identity.
   */
  async fork(request: SessionForkRequest): Promise<SessionForkValue> {
    let atSeq: ReturnType<typeof SessionSeq> | undefined
    try {
      atSeq = request.atSeq === undefined ? undefined : SessionSeq(request.atSeq)
    } catch {
      throw new RemoteError('gateway/bad-request', 'atSeq must be a non-negative safe integer', {})
    }
    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(request.sessionId)
    } catch (error) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      throw new RemoteError(
        'gateway/internal',
        `fork source unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    using source = observed
    const boundary = atSeq ?? defaultForkBoundary(source.events)
    if (boundary === undefined || source.events[boundary]?.seq !== boundary) {
      throw new RemoteError(
        'session/fork-unavailable',
        request.atSeq === undefined
          ? `session "${request.sessionId}" has no turn to fork from`
          : `event ${String(request.atSeq)} does not exist in session "${request.sessionId}" (last seq: ${String(source.events.at(-1)?.seq ?? 'none')})`,
        { sessionId: request.sessionId },
      )
    }
    const seed = buildForkSeed(source.events, boundary)
    let workspace: Workspace | undefined
    try {
      workspace = await this.forkWorkspace(source.header)
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to resolve fork workspace for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const childId = brandString<SessionId>(`session-${randomUUID()}`)
    const composition = await this.agents.composeAgent(this.agents.presetForObservation(source))
    try {
      const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
      this.agents.adopt(await this.ctx.agents.create({
        sessionId: childId,
        seed,
        inheritedEventCount: SessionLogOffset(boundary + 1),
        meta: {
          ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
          parentSession: source.header.id,
          isSeeded: true,
          ...(composition.agentPreset === undefined
            ? {}
            : { agentPreset: composition.agentPreset }),
        },
        agentOptions: { provider, model },
        setup: composition.setup,
      }))
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to fork session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(childId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId: childId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId: childId }
  }

  /**
   * Destructively rewrite one Session log under its own id: stop the live
   * Agent, discard events after `throughSeq`, apply `edits` to the kept
   * prefix, close an open tail turn as `interrupted`, replace the stored log,
   * and resume the Session. The previous stored log is kept by the
   * persistence backend only as a recovery copy; clients must reload.
   * @param request - Session, the client's cursor, cut point, edits, and interrupt/resume choices.
   * @returns the Session identity and the last seq of the rewritten log.
   */
  async rewrite(request: SessionRewriteRequest): Promise<SessionRewriteValue> {
    const { sessionId } = request
    let throughSeq: SessionSeq
    try {
      throughSeq = SessionSeq(request.throughSeq)
    } catch {
      throw new RemoteError('gateway/bad-request', 'throughSeq must be a non-negative safe integer', {})
    }
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      if (hasApiSessionSubagentOwner(this.ctx, live.session, live)) throw apiSessionSubagentOwnershipError(sessionId)
      if (live.status !== 'idle') {
        if (request.interrupt !== true) {
          throw new RemoteError('session/agent-busy', 'the session is running; interrupt it to rewrite', { reason: 'running' })
        }
        live.cancel({ kind: 'user' }, { keepInbox: true })
        await live.whenIdle()
      }
    }
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new RemoteError('session/rewrite-unavailable', 'no session persistence is composed', { sessionId, reason: 'no-persistence' })
    }
    let cursor = -1
    let agent: Agent
    try {
      agent = await this.agents.replaceStopped(sessionId, async () => {
        const stored = await inspectApiSession(this.ctx, sessionId)
        const last = stored.events.at(-1)?.seq ?? -1
        if (last !== request.expectedCursor) {
          throw new RemoteError('session/rewrite-conflict', `session "${sessionId}" changed since it was read (last seq ${last}, expected ${request.expectedCursor})`, {
            sessionId, expectedCursor: request.expectedCursor, cursor: last,
          })
        }
        const result = buildRewriteLog(stored.events, stored.inheritedEventCount, {
          throughSeq,
          edits: request.edits.map(edit => toEditOp(edit, stored.events)),
        })
        const meta = { ...stored.meta, isSeeded: result.isSeeded }
        // Refuse a log the Session itself would refuse before the stored copy changes.
        Session.create(sessionId, result.events, meta, result.inheritedEventCount, this.ctx.sessions.messageProjections)
        await persistence.replace({ meta, inheritedEventCount: result.inheritedEventCount, events: result.events })
        await this.ctx.get('sessionProjectionCache')?.invalidate(sessionId)
        cursor = result.events.at(-1)?.seq ?? -1
        // Before the resume, so no follower splices the resumed log onto its old cursor.
        this.ctx.emit('api-session/rewritten', sessionId)
      })
    } catch (error: unknown) {
      throw rewriteFailure(sessionId, error)
    }
    if (request.resume === true && agent.resume !== undefined && agent.status === 'idle') agent.resume()
    return { sessionId, cursor }
  }

  /**
   * Admit one prompt after Agent and attachment validation; the Remote method
   * has already validated the content and built the durable message source.
   * @param request - Session identity, prompt content, and delivery mode.
   * @param source - the `user-rpc` source recorded on the accepted message.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  async prompt(request: SessionPromptRequest, source: MessageSource): Promise<SessionPromptValue> {
    const agent = await this.resolveAgent(request.sessionId)
    if (hasPromptRequest(agent, request.requestId)) return { accepted: true }
    const hasImage = request.content.some(part => part.type === 'image')
    const admit = async (): Promise<SessionPromptValue> => {
      try {
        if (hasImage) {
          const current = this.agents.selectionFor(agent).current
          const model = await this.ctx.llm.resolveModelInfo(current.provider, current.model)
          if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
            throw new RemoteError(
              'session/attachment-invalid',
              `Model "${current.model}" does not support image input.`,
              { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
            )
          }
        }
        const admission = resolvePromptFileReceipts(
          request.content,
          receiptId => this.ctx.fileUploads.resolve(agent, receiptId),
        )
        const content = await this.ctx.attachments.admitPromptContent(admission.content)
        const message: UserMessage = createUserMessage({ content, source })
        if (this.ctx.agents.get(agent.id) !== agent) {
          throw new RemoteError(
            'session/not-found',
            `session "${agent.id}" was disposed during prompt admission`,
            { sessionId: agent.id },
          )
        }
        using binding = this.ctx.fileUploads.bindPrompt(agent, admission.receiptIds, request.requestId)
        if (request.mode === 'steer') agent.steer(message)
        else agent.followup(message)
        binding.commit()
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        if (error instanceof AttachmentError) {
          throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
        }
        throw new RemoteError('session/agent-busy', 'prompt rejected', { reason: String(error) })
      }
      return { accepted: true }
    }
    return hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit()
  }

  private async requireModel(selection: Pick<AgentModelSelection, 'provider' | 'model'>): Promise<void> {
    if (!await modelAvailable(this.ctx, selection)) {
      throw new RemoteError('session/model-unavailable', 'Select an available model before sending a message.',
        { provider: selection.provider, model: selection.model })
    }
  }

  /**
   * Read one durable image after proving the Session log references it.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    let source: SessionReadState
    try {
      source = await this.readSessionState(request.sessionId)
    } catch (error) {
      if (error instanceof ApiSessionNotFound) {
        throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `attachment authorization unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const ref = referencedImage(source.events, String(request.attachmentId))
    if (ref === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'Image is not referenced by this session.',
        { reason: 'ATTACHMENT_NOT_REFERENCED' },
      )
    }
    try {
      const stored = await this.ctx.attachments.readImage(ref)
      return {
        attachment: stored.ref,
        data: Buffer.from(stored.data).toString('base64'),
      }
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
      }
      throw new RemoteError('gateway/internal', 'Unable to read image attachment.', {})
    }
  }

  /**
   * Mutate one pending Inbox occurrence, restoring an ordinary cold Agent when needed.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  async updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    if (request.action.kind === 'edit') {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Remote callers can submit untyped JSON.
      if (request.action.content.some(block => block.type !== 'text')) {
        throw new RemoteError(
          'session/attachment-invalid',
          'queue edits accept text content only',
          { reason: 'QUEUE_EDIT_NON_TEXT' },
        )
      }
      if (!hasPromptContent(request.action.content)) {
        throw new RemoteError(
          'gateway/bad-request',
          'queue edit content must include non-whitespace text',
          {},
        )
      }
    }
    let agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      const found = await this.agents.resolveAgent(request.sessionId)
      if ('error' in found) {
        if (found.error.code !== 'session/not-found') throw found.error
        throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
      }
      agent = found.agent
    }
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      const identity = this.ctx.sessionProjections
        .snapshot(agent.session, ['subagent'])
        .values.subagent
      if (identity?.mode !== 'continuable'
        || !agent.session.isOwnSeq(identity.seq)) {
        throw apiSessionSubagentOwnershipError(request.sessionId)
      }
    }
    const nextTurn = agent.inbox.nextTurn.find(message => message.id === request.itemId)
    const nextStep = agent.inbox.nextStep.find(message => message.id === request.itemId)
    const located = nextTurn === undefined
      ? nextStep === undefined ? undefined : { target: 'next-step' as const, message: nextStep }
      : { target: 'next-turn' as const, message: nextTurn }
    if (located === undefined) {
      throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    const { target, message } = located
    if (request.action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
      throw new RemoteError('session/steer-unavailable', 'current turn no longer accepts steering', { itemId: request.itemId })
    }
    switch (request.action.kind) {
      case 'edit':
        agent.inbox.replace(request.itemId, freezeMessage<UserMessage>({
          ...message,
          content: [...request.action.content],
        }))
        break
      case 'remove': {
        agent.inbox.remove(request.itemId)
        const source = message.source
        if (source.kind === 'user' && 'rpcId' in source) {
          this.ctx.fileUploads.retirePrompt(agent, source.rpcId)
        }
        break
      }
      case 'steer':
        agent.inbox.remove(request.itemId)
        agent.steer(message)
        break
      /* v8 ignore next 2 -- closed-union exhaustiveness guard */
      default:
        assertNever(request.action, 'queue action')
    }
    return { accepted: true }
  }

  /**
   * Cancel one live ordinary Agent while retaining pending inbox work.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  cancel(request: SessionCancelRequest): SessionCancelValue {
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      throw new RemoteError(
        'session/not-found',
        `session "${request.sessionId}" not found (not attached)`,
        { sessionId: request.sessionId },
      )
    }
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      throw apiSessionSubagentOwnershipError(request.sessionId)
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { accepted: true }
  }

  /**
   * Resume the work one Session's last turn left unfinished, without a new
   * message. Only a turn that ended short of a reply is resumable: an error,
   * a stop, a crash, the output cap, or a fork cut inside it. A cold Session
   * is resumed first, and its crash repair is what closes a turn the process
   * died inside as `interrupted`.
   * @param request - Session whose unfinished turn resumes.
   * @returns acknowledgement that the resumed turn was admitted.
   */
  async resume(request: SessionResumeRequest): Promise<SessionResumeValue> {
    // Resolution refuses a Session its subagent parent owns, as prompt does.
    const agent = await this.resolveAgent(request.sessionId)
    const decision = resumeDecision(agent)
    if (decision.kind === 'unavailable') {
      throw new RemoteError('session/resume-unavailable', decision.reason, {
        sessionId: request.sessionId, reason: decision.reason,
      })
    }
    try {
      decision.resume()
    } catch (error) {
      throw new RemoteError('session/agent-busy', 'resume rejected', { reason: String(error) })
    }
    return { accepted: true }
  }

  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    return found.agent
  }

  private rejectCreation(error: unknown): never {
    if (remoteErrorOf(error) !== undefined) throw error
    if (error instanceof ApiSessionPresetConflict) {
      throw new RemoteError('agent-preset/conflict', error.message, {
        sessionId: error.sessionId,
        requestedPreset: error.requestedPreset,
      })
    }
    if (error instanceof ApiSessionCwdConflict) {
      throw new RemoteError('session/conflict', error.message, {
        sessionId: error.sessionId,
        requestedCwd: error.requestedCwd,
        ...(error.existingCwd === undefined ? {} : { existingCwd: error.existingCwd }),
      })
    }
    if (error instanceof ApiSessionSubagentOwnership) {
      throw apiSessionSubagentOwnershipError(error.sessionId)
    }
    throw new RemoteError('gateway/internal', `failed to create session: ${String(error)}`, {})
  }

  private async readSessionState(sessionId: SessionId): Promise<SessionReadState> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      return { id: attached.id, header: attached.header, events: attached.snapshotEvents() }
    }
    const inspected = await inspectApiSession(this.ctx, sessionId)
    return { id: inspected.meta.id, header: inspected.meta, events: inspected.events }
  }

  private async forkWorkspace(source: SessionHeader): Promise<Workspace | undefined> {
    const workspaces = this.ctx.workspaceRegistry.list()
    const direct = workspaces.find(workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.origin !== 'subagent') return direct
    const lineage = await this.ctx.sessionQuery.traceSession(source.id)
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }
}

/** Map one rewrite failure to the Remote error vocabulary. */
function rewriteFailure(sessionId: SessionId, error: unknown): Error {
  if (remoteErrorOf(error) !== undefined) return error as Error
  if (error instanceof SessionRewriteError) {
    return new RemoteError('session/rewrite-invalid', error.message, {
      sessionId, code: error.code, ...(error.seq === undefined ? {} : { seq: error.seq }),
    })
  }
  if (error instanceof ApiSessionForeignOwner) {
    return new RemoteError('session/rewrite-unavailable', error.message, { sessionId, reason: 'foreign-owner' })
  }
  if (error instanceof Error && (error.name === 'SessionAlreadyOwnedError' || error.name === 'SessionReplaceUnsupportedError' || error.name === 'SessionFormatUnsupportedError')) {
    return new RemoteError('session/rewrite-unavailable', error.message, { sessionId, reason: error.name })
  }
  if (error instanceof Error && error.message.startsWith('invalid seed event')) {
    return new RemoteError('session/rewrite-invalid', error.message, { sessionId, code: 'INVALID_RESULT' })
  }
  return new RemoteError('gateway/internal', `failed to rewrite session "${sessionId}": ${String(error)}`, {})
}

/**
 * Resolve one wire edit against the log it addresses. `keep` blocks reuse the
 * original message's block, so a client can only reference attachments the
 * log already holds.
 */
function toEditOp(edit: SessionEdit, events: readonly SessionEvent[]): SessionEditOp {
  const seqOf = (value: number): SessionSeq => {
    try {
      return SessionSeq(value)
    } catch {
      throw new SessionRewriteError(`edit seq ${String(value)} is not a non-negative safe integer`, 'INVALID_BOUNDARY')
    }
  }
  switch (edit.kind) {
    case 'replace-content': {
      const seq = seqOf(edit.seq)
      const original = messageContent(events[seq])
      return {
        kind: 'replace-content', seq,
        content: edit.content.map(block => toContentBlock(block, original, seq)),
        ...(edit.isError === undefined ? {} : { isError: edit.isError }),
      }
    }
    case 'delete':
      return { kind: 'delete', seq: seqOf(edit.seq) }
    case 'insert-user': {
      const afterSeq = seqOf(edit.afterSeq)
      return { kind: 'insert-user', afterSeq, content: edit.content.map(block => toContentBlock(block, [], afterSeq)) }
    }
    default:
      return assertNever(edit)
  }
}

function messageContent(event: SessionEvent | undefined): readonly ContentBlock[] {
  switch (event?.type) {
    case 'user/message':
      return event.data.content
    case 'developer/message':
    case 'system/message':
    case 'assistant/message':
    case 'tool/result':
      return event.data.message.content
    // Other events carry no message; the rewrite transform rejects edits aimed at them.
    default:
      return []
  }
}

function toContentBlock(block: SessionEditBlock, original: readonly ContentBlock[], seq: SessionSeq): ContentBlock {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return { type: block.type, text: block.text }
    case 'tool-call':
      return { type: 'tool-call', id: ToolCallId(block.id), name: block.name, arguments: block.arguments }
    case 'keep': {
      const kept = original[block.index]
      if (kept === undefined) {
        throw new SessionRewriteError(`event ${seq} has no content block ${block.index} to keep`, 'NOT_A_MESSAGE', seq)
      }
      return kept
    }
    default:
      return assertNever(block)
  }
}

function resolvePromptFileReceipts(
  content: SessionPromptRequest['content'],
  stagedFile: (receiptId: FileUploadReceiptId) => FileAttachmentRef | undefined,
): { readonly content: AttachmentAdmissionPart[]; readonly receiptIds: readonly FileUploadReceiptId[] } {
  const receiptIds = new Set<FileUploadReceiptId>()
  const resolved = content.map((part): AttachmentAdmissionPart => {
    if (part.type !== 'file') return part
    const attachment = stagedFile(part.receiptId)
    if (attachment === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'File was not uploaded for this session.',
        { reason: 'FILE_NOT_STAGED' },
      )
    }
    receiptIds.add(part.receiptId)
    return { type: 'file', attachment }
  })
  return { content: resolved, receiptIds: [...receiptIds] }
}

function hasPromptRequest(agent: Agent, requestId: SessionRequestId): boolean {
  const matches = (message: UserMessage): boolean => {
    const source = message.source
    return source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId
  }
  if (agent.inbox.nextTurn.some(matches) || agent.inbox.nextStep.some(matches)) return true
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  return agent.session.snapshotEvents().some((event) => {
    if (event.type !== 'user/message') return false
    const source = event.data.source
    return source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId
  })
}
function imageBlockIn(
  content: unknown,
  match: (ref: ImageAttachmentRef) => boolean,
): ImageAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { readonly type?: unknown; readonly attachment?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as ImageAttachmentRef
      if (match(ref)) return ref
    }
  }
  return undefined
}

/** Read only first-party declared content fields; unknown event payloads stay opaque. */
function imageInEvent(
  event: SessionEvent,
  match: (ref: ImageAttachmentRef) => boolean,
): ImageAttachmentRef | undefined {
  const data = event.data as {
    readonly content?: unknown
    readonly message?: { readonly content?: unknown }
    readonly inserted?: unknown
    readonly summary?: unknown
    readonly rawOutput?: unknown
  }
  // First-party event payloads can be present without their producer plugin mounted.
  const type: string = event.type
  switch (type) {
    case 'user/message':
    case 'tool/ptc-dispatch':
      return imageBlockIn(data.content, match)
    case 'system/message':
    case 'developer/message':
    case 'tool/result':
    case 'team/message/queued':
      return imageBlockIn(data.message?.content, match)
    case 'agent/inbox/spliced': {
      const messages = data.inserted
      if (!Array.isArray(messages)) return undefined
      for (const message of messages as readonly unknown[]) {
        if (typeof message !== 'object' || message === null || Array.isArray(message)) continue
        const found = imageBlockIn((message as { readonly content?: unknown }).content, match)
        if (found !== undefined) return found
      }
      return undefined
    }
    case 'compaction/summary':
      return imageBlockIn(data.summary, match) ?? imageBlockIn(data.rawOutput, match)
    case 'assistant/message': {
      const found = imageBlockIn(data.message?.content, match)
      if (found !== undefined) return found
      break
    }
    case 'assistant/attempt': break
    default: return undefined
  }
  const assistant = event as SessionEvent<'assistant/message' | 'assistant/attempt'>
  for (const chunk of assistantStreamChunks(assistant.data.stream, 'block-end')) {
    const found = imageBlockIn([chunk.block], match)
    if (found !== undefined) return found
  }
  return undefined
}

function referencedImage(
  events: readonly SessionEvent[],
  attachmentId: string,
): ImageAttachmentRef | undefined {
  for (const event of events) {
    const found = imageInEvent(event, ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}
