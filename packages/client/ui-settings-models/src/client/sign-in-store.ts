/**
 * Sign-in controller for the Models page: the browser half of one
 * `authorization` conversation.
 *
 * A sign-in is not a form submission. One `begin` call stays open while the
 * human is away in their own browser tab, and what the flow has to say along
 * the way — the page to open, the question to answer — arrives as pushed
 * events rather than as that call's result. This store is what turns those
 * three wire pieces into one renderable state per flow.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  AuthorizationEntryView, AuthorizationNoticeEvent, AuthorizationPromptEvent,
  AuthorizationPromptClosedEvent,
} from '@deepseek-ai/dsh-api-settings-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The authorization Remote methods this page drives. */
export type SignInRemote = Pick<ClientRemote['authorization'], 'answer' | 'begin' | 'cancel' | 'decline' | 'list'>

/** One sign-in's live state, as its row renders it. */
export interface SignInAttempt {
  /** The attempt this row is following; absent while nothing runs. */
  attempt?: string | undefined
  /** What the flow last said, oldest first. */
  notices: readonly AuthorizationNoticeEvent[]
  /** The question waiting on the human, when one is open. */
  prompt?: AuthorizationPromptEvent | undefined
  /** What the human has typed into that question so far. */
  draft: string
  /** Whether a call is in flight, which disables the row's controls. */
  busy: boolean
  /** How the last finished attempt ended, for the row's closing line. */
  outcome?: 'authorized' | 'cancelled' | undefined
  /** The flow's own failure message, when it broke. */
  error?: string | undefined
}

/** The whole page's sign-in state. */
export interface SignInState {
  /** Whether the flow list has been read yet. */
  status: 'idle' | 'loading' | 'ready'
  /** Every sign-in this composition offers, in registration order. */
  flows: readonly AuthorizationEntryView[]
  /** The live attempt per flow key; a key with none has never been started. */
  attempts: Readonly<Record<string, SignInAttempt>>
  /**
   * Why the last read failed, when it did. An unreadable list is not the same
   * fact as an empty one — a page that showed nothing either way would hide a
   * broken connection behind a composition that offers no sign-in — so the
   * failure is held and the next reload clears it.
   */
  error?: string | undefined
}

/** A row that has never been started, which is also what a finished row resets to. */
const IDLE: SignInAttempt = { notices: [], draft: '', busy: false }

/**
 * Read one wire failure's message.
 * @param error - the rejected call's failure.
 * @returns the message to show.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

/** The Models page's sign-in controller (one per settings surface). */
export class SignInStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<SignInState> = createSnapshotStore<SignInState>({
    status: 'idle',
    flows: [],
    attempts: {},
  })

  /** @param api - the page's authorization Remote face. */
  constructor(private readonly api: SignInRemote) {}

  /**
   * Read which sign-ins this composition offers.
   *
   * A composition mounting no authorization seam answers an empty list, which
   * renders nothing: a page with no sign-in to offer says nothing about it
   * rather than showing an error the human cannot act on.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    this.store.update((s) => { s.status = 'loading' })
    const listed = await this.api.list()
    this.store.update((s) => {
      s.status = 'ready'
      s.flows = listed.ok ? listed.value : []
      s.error = listed.ok ? undefined : messageOf(listed.error)
    })
  }

  /**
   * Re-read the list only once it has been read at all: an unopened page must
   * not fetch on a background reconnect.
   * @returns nothing; the snapshot carries the outcome.
   */
  async reload(): Promise<void> {
    if (this.store.getSnapshot().status === 'idle') return
    await this.load()
  }

  /**
   * Start one sign-in and follow it to its end.
   *
   * The call is awaited for as long as the conversation lasts; the notices and
   * questions raised meanwhile arrive through {@link notice} and {@link prompt}.
   * @param key - the flow to run.
   * @param method - which of its methods; its first when absent.
   * @returns nothing; the snapshot carries the outcome.
   */
  async begin(key: string, method?: string): Promise<void> {
    this.patch(key, () => ({ ...IDLE, busy: true }))
    const outcome = await this.api.begin(key, method)
    this.patch(key, current => outcome.ok
      ? { ...current, attempt: undefined, prompt: undefined, busy: false, outcome: outcome.value.status }
      : { ...current, attempt: undefined, prompt: undefined, busy: false, error: messageOf(outcome.error) })
    await this.load()
  }

  /**
   * Withdraw the sign-in running for one flow.
   * @param key - the flow whose attempt should stop.
   * @returns nothing; the awaited `begin` settles as cancelled.
   */
  async cancel(key: string): Promise<void> {
    this.patch(key, current => ({ ...current, busy: true }))
    await this.api.cancel(key)
  }

  /**
   * Answer the open question of one flow's attempt.
   * @param key - the flow whose question is being answered.
   * @param value - what the human typed, or the chosen option's id.
   * @returns nothing; the flow continues and the snapshot drops the question.
   */
  async answer(key: string, value: string): Promise<void> {
    const open = this.attempt(key)
    if (open.prompt === undefined || open.attempt === undefined) return
    const { attempt, prompt } = { attempt: open.attempt, prompt: open.prompt.prompt }
    this.patch(key, current => ({ ...current, prompt: undefined, draft: '' }))
    const answered = await this.api.answer(attempt, prompt, value)
    if (!answered.ok) this.patch(key, current => ({ ...current, error: messageOf(answered.error) }))
  }

  /**
   * Decline the open question of one flow's attempt, which cancels the sign-in.
   * @param key - the flow whose question is being declined.
   * @returns nothing; the awaited `begin` settles as cancelled.
   */
  async decline(key: string): Promise<void> {
    const open = this.attempt(key)
    if (open.prompt === undefined || open.attempt === undefined) return
    const { attempt, prompt } = { attempt: open.attempt, prompt: open.prompt.prompt }
    this.patch(key, current => ({ ...current, prompt: undefined, draft: '' }))
    await this.api.decline(attempt, prompt)
  }

  /**
   * Record what the human has typed into the open question.
   * @param key - the flow whose question is being typed into.
   * @param draft - the current input value.
   */
  type(key: string, draft: string): void {
    this.patch(key, current => ({ ...current, draft }))
  }

  /**
   * Take one pushed notice.
   * @param notice - what the flow said, and which attempt said it.
   */
  notice(notice: AuthorizationNoticeEvent): void {
    this.patch(notice.key, current => ({
      ...current,
      attempt: notice.attempt,
      notices: [...current.notices, notice],
    }))
  }

  /**
   * Take one pushed question.
   * @param prompt - what the flow asked, and which attempt asked it.
   */
  prompt(prompt: AuthorizationPromptEvent): void {
    this.patch(prompt.key, current => ({ ...current, attempt: prompt.attempt, prompt, draft: '' }))
  }

  /**
   * Take one question the flow withdrew. Matched on the question's own id, so a
   * withdrawal that lost a race against the human's answer leaves the next
   * question — already showing — alone.
   * @param closed - the withdrawn question's attempt and id.
   */
  promptClosed(closed: AuthorizationPromptClosedEvent): void {
    for (const [key, current] of Object.entries(this.store.getSnapshot().attempts)) {
      if (current.prompt?.prompt !== closed.prompt) continue
      this.patch(key, existing => ({ ...existing, prompt: undefined, draft: '' }))
    }
  }

  /**
   * One flow's current row state.
   * @param key - the flow key.
   * @returns its live state, or the idle row when nothing has run.
   */
  attempt(key: string): SignInAttempt {
    return this.store.getSnapshot().attempts[key] ?? IDLE
  }

  /**
   * Replace one flow's row state, leaving every other row's identity untouched.
   * The next row is computed from the published snapshot rather than from the
   * draft, so nothing a draft owns escapes into the state it replaces.
   */
  private patch(key: string, next: (current: SignInAttempt) => SignInAttempt): void {
    const updated = next(this.attempt(key))
    this.store.update((draft) => { draft.attempts = { ...draft.attempts, [key]: updated } })
  }
}
