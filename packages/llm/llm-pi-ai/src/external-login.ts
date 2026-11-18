/**
 * The contribution point through which a plugin outside this package adds one
 * login method to a pi-ai route.
 *
 * pi-ai ships the logins its own providers declare, and a route whose vendor
 * offers a sign-in pi-ai does not implement would otherwise have nowhere to put
 * it: the authorization seam allows one flow per credential record, and this
 * package already claims every installed route's. A contribution therefore adds
 * a *method* to the flow this package registers rather than a flow of its own,
 * which keeps this package the single writer of its records and keeps the
 * contributor free of pi-ai's own auth model — it hands back a key, and where
 * that key is stored stays this package's business.
 *
 * ```ts
 * const dispose = contributePiAiLogin(ctx, {
 *   provider: 'zai',
 *   method: { id: 'oauth', label: 'Sign in with Z.AI' },
 *   async run(session) {
 *     session.notify({ message: 'Continue in your browser', url })
 *     return { apiKey: await mintKey(session.signal) }
 *   },
 * })
 * ```
 *
 * @module dsh-llm-pi-ai/external-login
 */

import type { Provider } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationMethod, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { catalogProvider } from './catalog.ts'

/** What a contributed login produces: the key this package stores for the route. */
export interface PiAiContributedKey {
  /** The non-empty api key the login obtained. */
  readonly apiKey: string
}

/**
 * One login another plugin offers for a pi-ai route.
 *
 * The contributor owns the conversation and the protocol; it never writes the
 * credential. Resolving with a key is what commits it, so a `run` that reaches
 * the end without one has failed rather than succeeded quietly.
 */
export interface PiAiLoginContribution {
  /** The installed pi-ai route this method signs into. */
  readonly provider: string
  /** How the method is named and addressed; its id is unique within the route. */
  readonly method: AuthorizationMethod
  /**
   * Run one attempt.
   * @param session - the cancellation signal and the interaction callbacks.
   * @returns the key to store for this route.
   * @throws when the attempt fails or the human declines.
   */
  run(session: AuthorizationSession): Promise<PiAiContributedKey>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Collect the mounted login methods for one installed pi-ai route.
     * @mode emit
     * @param provider - installed route id.
     * @param add - receives each contribution in registration order.
     */
    'llm-pi-ai/collect-logins'(provider: string, add: (entry: PiAiLoginContribution) => void): void
    /**
     * Refresh a route's authorization flow after a login method is added or removed.
     * @mode emit
     * @param provider - installed route id.
     */
    'llm-pi-ai/logins-changed'(provider: string): void
  }
}

/**
 * Offer one login method for an installed pi-ai route.
 *
 * The method appears on that route's authorization flow for as long as the
 * contributing fiber lives; the flow is re-registered to carry it, which
 * withdraws an attempt already running for that route.
 *
 * @param ctx - the contributing plugin's context.
 * @param contribution - the route, the method, and its runner.
 * @returns Disposer that withdraws the method.
 * @throws {LlmError} code `UNKNOWN_PI_AI_ROUTE` when pi-ai ships no provider
 *   under that id, or `DUPLICATE_LOGIN_METHOD` when the route already offers a
 *   method with that id.
 */
export function contributePiAiLogin(ctx: Context, contribution: PiAiLoginContribution): () => void {
  const { provider, method } = contribution
  const installed = catalogProvider(provider)
  if (installed === undefined) {
    throw new LlmError(
      `llm-pi-ai: no installed pi-ai provider is named "${provider}", so a login cannot be contributed to it;`
      + ' a route pi-ai does not ship authenticates through its own configured credential',
      'UNKNOWN_PI_AI_ROUTE',
    )
  }
  if (piAiMethods(installed).some(existing => existing.id === method.id)
    || contributedLogins(ctx, provider).some(existing => existing.method.id === method.id)) {
    throw new LlmError(
      `llm-pi-ai: route "${provider}" already offers a login method named "${method.id}"`,
      'DUPLICATE_LOGIN_METHOD',
    )
  }
  const dispose = ctx.effect(() => {
    const remove = ctx.on('llm-pi-ai/collect-logins', (route, add) => {
      if (route === provider) add(contribution)
    })
    ctx.emit('llm-pi-ai/logins-changed', provider)
    return () => {
      remove()
      ctx.emit('llm-pi-ai/logins-changed', provider)
    }
  }, 'contributePiAiLogin()')
  return () => void dispose()
}

/**
 * Catalog providers whose OAuth login this adapter does not offer. pi-ai's Sign
 * in with ChatGPT (`openai`) identifies the installation to OpenAI with a
 * stable UUID that the app supplies through `LoginOptions.getDeviceId`, and it
 * refuses to start without one. The harness keeps no installation ID meant for
 * a third-party account sign-in, so the route signs in with an API key.
 */
const UNSERVED_OAUTH: ReadonlySet<string> = new Set(['openai'])

/**
 * The methods pi-ai itself declares for one route, in its own preference order.
 *
 * A method appears only when pi-ai can actually run it: `oauth` carries a
 * `login` that runs without app-supplied login options except for the
 * providers in {@link UNSERVED_OAUTH}, while an api-key method has one only
 * when the provider collects its key interactively.
 * @param provider - the installed catalog provider.
 * @returns pi-ai's own methods, most preferred first; empty when it offers no login.
 */
export function piAiMethods(provider: Provider): AuthorizationMethod[] {
  const methods: AuthorizationMethod[] = []
  const { apiKey } = provider.auth
  const oauth = UNSERVED_OAUTH.has(provider.id) ? undefined : provider.auth.oauth
  if (oauth !== undefined) methods.push({ id: 'oauth', label: oauth.loginLabel ?? oauth.name })
  if (apiKey?.login !== undefined) methods.push({ id: 'api-key', label: apiKey.name })
  return methods
}

/**
 * The logins contributed for one route.
 * @param ctx - the adapter's context.
 * @param provider - the route key.
 * @returns the contributions in registration order; empty when there are none.
 */
export function contributedLogins(ctx: Context, provider: string): readonly PiAiLoginContribution[] {
  const contributions: PiAiLoginContribution[] = []
  ctx.emit('llm-pi-ai/collect-logins', provider, (entry) => { contributions.push(entry) })
  return contributions
}
