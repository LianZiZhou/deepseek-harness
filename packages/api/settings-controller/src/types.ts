/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves, plus the sign-in conversation's wire views and its forwarded Cordis
 * events. The redacted settings views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because the
     * stored document no longer parses. The details name only the reference,
     * never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** One registered sign-in as a configuration page sees it. */
export interface AuthorizationEntryView {
  /** The credential record this flow writes, in `<scope>/<id>` form. */
  readonly key: string
  /** User-facing name of what is being authorized. */
  readonly label: string
  /** The methods the flow offers, most preferred first. */
  readonly methods: readonly AuthorizationMethodView[]
  /** Whether an attempt for this key is running right now, started by any page. */
  readonly inFlight: boolean
}

/** One way a sign-in can be run, as offered to a page. */
export interface AuthorizationMethodView {
  /** Flow-owned identifier, echoed back when a page picks this method. */
  readonly id: string
  /** User-facing label for a picker. */
  readonly label: string
}

/** How one sign-in ended, as its own caller sees it. */
export interface AuthorizationOutcomeView {
  /** `authorized` once the record is committed; `cancelled` when the human declined or the page gave up. */
  readonly status: 'authorized' | 'cancelled'
}

/** One choice offered by a sign-in's `select` question. */
export interface AuthorizationPromptOptionView {
  /** Value answered with when this option is chosen. */
  readonly id: string
  /** User-facing label. */
  readonly label: string
  /** Extra context a capable page renders beside the label. */
  readonly description?: string
}

/** Progress from a running sign-in, or what the human must do next. Never carries a secret. */
export interface AuthorizationNoticeEvent {
  /** The attempt reporting it. */
  readonly attempt: string
  /** The flow key that attempt is authorizing. */
  readonly key: string
  /** What is happening, or what to do next. */
  readonly message: string
  /** A page the human must open to continue. */
  readonly url?: string
  /** A short code the human must enter on that page. */
  readonly code?: string
}

/** A question a running sign-in needs answered before it can continue. */
export interface AuthorizationPromptEvent {
  /** The attempt asking it. */
  readonly attempt: string
  /** The flow key that attempt is authorizing. */
  readonly key: string
  /** This question's id, which its answer must carry back. */
  readonly prompt: string
  /** How the question should be presented; `secret` differs from `text` only in that a page masks it. */
  readonly kind: 'text' | 'secret' | 'select'
  /** What to ask. */
  readonly message: string
  /** Placeholder for a `text` or `secret` question. */
  readonly placeholder?: string
  /** The choices of a `select` question. */
  readonly options?: readonly AuthorizationPromptOptionView[]
}

/**
 * One question the flow itself withdrew, leaving the sign-in running. A flow
 * racing a browser callback against a typed answer retires the losing question
 * this way, and a page that keeps showing it would be collecting an answer
 * nothing is waiting for.
 */
export interface AuthorizationPromptClosedEvent {
  /** The attempt that asked the question. */
  readonly attempt: string
  /** The withdrawn question's id. */
  readonly prompt: string
}

/** Stable authorization failure details returned by the `authorization` namespace. */
export interface AuthorizationErrorDetailsMap {
  /**
   * The flow failed. A withdrawn or declined attempt is not here: the seam
   * reports those as a `cancelled` outcome, so everything carried by this code
   * is the flow itself breaking, with the flow's own message.
   */
  'authorization-rejected': { readonly key: string }
}

/** Authorization business failure carried by a rejected Remote call. */
export type AuthorizationError = {
  [Code in keyof AuthorizationErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: AuthorizationErrorDetailsMap[Code]
  }
}[keyof AuthorizationErrorDetailsMap]

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A running sign-in reported progress, or what the human must do next.
     * @mode emit
     * @param notice - the attempt, its flow key, and the message with any page or code it refers to.
     */
    'api-authorization/notice'(notice: AuthorizationNoticeEvent): void
    /**
     * A running sign-in needs a question answered before it can continue.
     * @mode emit
     * @param prompt - the attempt, its flow key, the question id, and how to present it.
     */
    'api-authorization/prompt'(prompt: AuthorizationPromptEvent): void
    /**
     * A running sign-in withdrew one of its own questions.
     * @mode emit
     * @param closed - the attempt and the withdrawn question's id.
     */
    'api-authorization/prompt-closed'(closed: AuthorizationPromptClosedEvent): void
  }
}
