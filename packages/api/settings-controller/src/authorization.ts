/**
 * Host owner of the `authorization` Remote namespace: the sign-in half of
 * `ctx.authorization` as a browser configuration page drives it.
 *
 * The seam's flows are conversations — a flow reports where to go and asks what
 * the human found there — so this namespace is not a plain request/response
 * façade. One `begin` call spans the whole conversation and settles with its
 * outcome; the notices and questions raised along the way ride forwarded Cordis
 * events, and the page answers each question with its own `answer` call. The
 * attempt and prompt ids are what tie the three together, so a page that opened
 * two sign-ins never answers the wrong question.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/authorization.ts
 */

import { Context } from '@deepseek-ai/cordis'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationInteraction, AuthorizationNotice, AuthorizationPrompt, AuthorizationService,
} from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { z } from 'zod'
import type { AuthorizationEntryView, AuthorizationOutcomeView } from './types.ts'

/** The credential-key grammar, which is also the flow key a page may address. */
const keySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/)
const beginRequestSchema = z.object({ key: keySchema, method: z.string().min(1).optional() })
const answerRequestSchema = z.object({
  attempt: z.string().min(1),
  prompt: z.string().min(1),
  value: z.string(),
})
const promptRequestSchema = z.object({ attempt: z.string().min(1), prompt: z.string().min(1) })
const cancelRequestSchema = z.object({ key: keySchema })

/** One question waiting on the page that asked it. */
interface PendingPrompt {
  /** The attempt that raised it, so a stale answer cannot settle a later question. */
  readonly attempt: string
  /** Hand the flow the human's answer. */
  readonly resolve: (value: string) => void
  /** Tell the flow the human said no, or that the page gave up. */
  readonly reject: (error: Error) => void
}

/** Parse the domain constraints that are more specific than generated TypeScript codecs. */
function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new TypertRemoteFailure({
      code: 'bad-request',
      message: `invalid payload for ${method}`,
      details: { issues: parsed.error.issues },
    })
  }
  return parsed.data
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace.
 *
 * Nothing here interprets a flow: the seam owns which flows exist and what each
 * one does, and this class owns only what the wire adds — the key grammar, the
 * attempt and prompt identity a stateless page needs, and the refusal mapping.
 * No method returns a credential, because no flow hands one to its caller.
 */
export class AuthorizationController extends TypertRemoteService {
  /** Questions raised by this controller's running attempts, by prompt id. */
  private readonly pending = new Map<string, PendingPrompt>()

  /** @param ctx - Host context where the authorization seam may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /**
   * Every sign-in this composition offers, for a configuration page listing
   * what can be authorized. A deployment mounting no authorization seam offers
   * none, which is a fact about the composition rather than a failure — the
   * page renders no sign-in and its credential fields still work.
   * @returns one entry per registered flow, in registration order; empty when nothing is mounted.
   */
  @Remote
  list(): AuthorizationEntryView[] {
    return (this.ctx.get('authorization')?.list() ?? []).map(entry => ({
      key: String(entry.key),
      label: entry.label,
      methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
      inFlight: entry.inFlight,
    }))
  }

  /**
   * Run one sign-in for the page that asked, and settle when it ends.
   *
   * The call lives as long as the conversation: the browser holds it open while
   * the human is away in their own browser tab, and the notices and questions
   * raised meanwhile arrive as forwarded events carrying this attempt's id.
   * Abandoning the call — a closed page, a navigated-away tab — aborts the
   * signal, which withdraws the attempt.
   * @param key - the credential record to authorize, in `<scope>/<id>` form.
   * @param method - which of the flow's methods to run; its first when absent.
   * @param signal - caller lifetime; abort withdraws the attempt.
   * @returns `authorized` once the flow commits its record, or `cancelled` when the human declined or the page gave up.
   * @throws TypertRemoteFailure when the request is invalid, no seam is mounted, or the flow fails.
   */
  @Remote
  async begin(key: string, method: string | undefined, signal: AbortSignal): Promise<AuthorizationOutcomeView> {
    const request = parseRequest('authorization.begin', beginRequestSchema, { key, method })
    const authorization = this.provider()
    const attempt = randomUUID()
    const [scope, id] = request.key.split('/') as [string, string]
    try {
      const outcome = await authorization.begin({
        key: credentialKey(scope, id),
        ...request.method === undefined ? {} : { method: request.method },
        interaction: this.interaction(attempt, request.key),
        signal,
      })
      return { status: outcome.status }
    } catch (error: unknown) {
      throw rejected(request.key, error)
    } finally {
      this.withdrawAttempt(attempt)
    }
  }

  /**
   * Answer one question a running sign-in asked.
   *
   * Answering a question that is no longer open is refused rather than ignored:
   * a page that raced its own withdrawal must learn its answer went nowhere,
   * because the flow is still waiting for a different one.
   * @param attempt - the attempt whose question is being answered.
   * @param prompt - the question's id, as its event carried it.
   * @param value - what the human typed, or the chosen option's id.
   * @throws TypertRemoteFailure when the request is invalid or that question is not open.
   */
  @Remote
  answer(attempt: string, prompt: string, value: string): void {
    this.take('authorization.answer', { attempt, prompt, value }, answerRequestSchema).resolve(value)
  }

  /**
   * Report that the human declined one question, which settles its attempt as
   * cancelled rather than failed.
   * @param attempt - the attempt whose question was declined.
   * @param prompt - the question's id, as its event carried it.
   * @throws TypertRemoteFailure when the request is invalid or that question is not open.
   */
  @Remote
  decline(attempt: string, prompt: string): void {
    this.take('authorization.decline', { attempt, prompt, value: '' }, promptRequestSchema)
      .reject(new AuthorizationDeclinedError())
  }

  /**
   * Withdraw the attempt running for one key, from a second call.
   *
   * Separate from the `begin` call's own signal because a Cancel button is a
   * new request: the page pressing it holds no handle on the call it is
   * cancelling. Withdrawing a key with nothing running is a no-op, so a page
   * racing a flow that just settled is not told it made a mistake.
   * @param key - the credential record whose attempt should stop.
   * @throws TypertRemoteFailure when the request is invalid or no seam is mounted.
   */
  @Remote
  cancel(key: string): void {
    const request = parseRequest('authorization.cancel', cancelRequestSchema, { key })
    const [scope, id] = request.key.split('/') as [string, string]
    this.provider().cancel(credentialKey(scope, id))
  }

  /**
   * The interaction one attempt reports through: notices and questions leave as
   * forwarded events, and each question's answer arrives as its own call.
   * @param attempt - this attempt's id, carried by every event it emits.
   * @param key - the flow key, so a page can route an event to the row that started it.
   * @returns the interaction to hand the seam.
   */
  private interaction(attempt: string, key: string): AuthorizationInteraction {
    return {
      notify: (notice: AuthorizationNotice) => {
        this.ctx.emit('api-authorization/notice', {
          attempt,
          key,
          message: notice.message,
          ...notice.url === undefined ? {} : { url: notice.url },
          ...notice.code === undefined ? {} : { code: notice.code },
        })
      },
      prompt: (prompt: AuthorizationPrompt) => new Promise<string>((resolve, reject) => {
        const id = randomUUID()
        this.pending.set(id, { attempt, resolve, reject })
        // A flow racing a browser callback against a typed answer withdraws the
        // losing question itself; the page is told so it can stop showing it.
        prompt.signal?.addEventListener('abort', () => {
          if (this.pending.delete(id)) {
            this.ctx.emit('api-authorization/prompt-closed', { attempt, prompt: id })
            reject(new Error('the question was withdrawn by its flow'))
          }
        }, { once: true })
        this.ctx.emit('api-authorization/prompt', {
          attempt,
          key,
          prompt: id,
          kind: prompt.kind,
          message: prompt.message,
          ...prompt.kind === 'select'
            ? {
              options: prompt.options.map(option => ({
                id: option.id,
                label: option.label,
                ...option.description === undefined ? {} : { description: option.description },
              })),
            }
            : prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
        })
      }),
    }
  }

  /** Claim one open question, or refuse because it is not this controller's to settle. */
  private take<T extends { attempt: string; prompt: string }>(
    method: string,
    request: { attempt: string; prompt: string; value: string },
    schema: z.ZodType<T>,
  ): PendingPrompt {
    const parsed = parseRequest(method, schema, request)
    const waiting = this.pending.get(parsed.prompt)
    if (waiting === undefined || waiting.attempt !== parsed.attempt) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: `no open question ${JSON.stringify(parsed.prompt)} on attempt ${JSON.stringify(parsed.attempt)}`,
        details: {},
      })
    }
    this.pending.delete(parsed.prompt)
    return waiting
  }

  /** Fail every question one finished attempt left open, so no promise outlives its flow. */
  private withdrawAttempt(attempt: string): void {
    for (const [id, waiting] of [...this.pending]) {
      if (waiting.attempt !== attempt) continue
      this.pending.delete(id)
      waiting.reject(new Error('the sign-in ended while this question was open'))
    }
  }

  /** Resolve the optional seam or report how to supply it. */
  private provider(): AuthorizationService {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new TypertRemoteFailure({
        code: 'internal',
        message: 'authorization service is absent: this deployment does not mount the authorization seam (@deepseek-ai/dsh-authorization) in its composition',
        details: {},
      })
    }
    return authorization
  }
}

/**
 * Classify one seam refusal. A withdrawn or declined attempt never reaches
 * here — the seam reports those as a `cancelled` outcome — so everything that
 * does is the flow itself failing, and the page shows the flow's own message.
 * @param key - the flow key the attempt addressed.
 * @param error - whatever the seam threw.
 * @returns the failure to raise for that refusal.
 */
function rejected(key: string, error: unknown): TypertRemoteFailure {
  return new TypertRemoteFailure({
    code: 'authorization-rejected',
    message: error instanceof Error ? error.message : String(error),
    details: { key },
  })
}

export default AuthorizationController
