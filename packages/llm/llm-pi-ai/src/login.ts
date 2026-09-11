/**
 * Authorization flows for the pi-ai providers that ship a login, and for the
 * routes another plugin has contributed one to. This is the whole of the
 * translation between the harness's neutral notice/prompt vocabulary and
 * pi-ai's `AuthInteraction`; nothing above it knows which library ran the
 * conversation.
 *
 * @module dsh-llm-pi-ai/login
 */

import type { AuthEvent, AuthPrompt, AuthType, Provider } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationMethod, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { recordKeyFor } from './auth.ts'
import { contributedLogins, piAiMethods, watchContributedLogins } from './external-login.ts'
import type { PiAiLoginContribution } from './external-login.ts'
import type { PiAiAuthInjection } from './adapter.ts'
import { createModels } from './models.ts'

/**
 * The login methods one route offers, most preferred first.
 *
 * A contributed sign-in is placed ahead of pi-ai's own api-key method and
 * behind pi-ai's own sign-in: a surface that runs a flow's first method should
 * reach the browser conversation rather than the key prompt, while a provider
 * whose own OAuth pi-ai already implements keeps it as the preferred one.
 * @param ctx - the adapter's context, carrying any contributed logins.
 * @param provider - the installed catalog provider.
 * @returns its methods, most preferred first; empty when it offers no login.
 */
function loginMethods(ctx: Context, provider: Provider): AuthorizationMethod[] {
  const own = piAiMethods(provider)
  const contributed = contributedLogins(ctx, provider.id).map(entry => entry.method)
  const apiKeyAt = own.findIndex(method => method.id === 'api-key')
  if (apiKeyAt < 0) return [...own, ...contributed]
  return [...own.slice(0, apiKeyAt), ...contributed, ...own.slice(apiKeyAt)]
}

/** This package's settings section, where a route's profile lives. */
const NS = settingsNamespace('llm-pi-ai')

/**
 * Give the route a profile, so what was just signed into is usable.
 *
 * A stored credential is not a route: this adapter mounts dormant and registers
 * only what the settings section declares, so a sign-in that stopped at the
 * credential would leave the human looking at a Models page that gained
 * nothing and a picker with no new model. The empty profile is the whole
 * declaration a signed-in catalog route needs — endpoint, protocol, and models
 * come from the installed catalog, and the credential comes from the record the
 * login just wrote, so no `apiKeyEnv` is involved.
 *
 * An existing profile is left exactly as it is: it may carry an endpoint, a
 * narrowed model list, or a credential reference that this sign-in has no
 * business rewriting. A composition with no settings provider, or one that
 * refuses the write, keeps the credential and reports the refusal — the login
 * itself succeeded, and failing it here would discard a credential the human
 * did obtain.
 * @param ctx - the plugin context carrying the optional settings service.
 * @param provider - the route that was signed into.
 */
async function declareRoute(ctx: Context, provider: string): Promise<void> {
  const settings = ctx.get('settings')
  if (settings === undefined) return
  const section = settings.describe().find(descriptor => descriptor.ns === NS)?.value as
    { providers?: Record<string, unknown> } | undefined
  if (section?.providers?.[provider] !== undefined) return
  try {
    await settings.mutate(NS, [{ op: 'set', path: ['providers', provider], value: {} }])
  } catch (error: unknown) {
    ctx.logger.warn(
      'llm-pi-ai: signed in to "%s" but could not declare its route; add it on the Models page to use its models',
      provider)
    ctx.logger.warn(error)
  }
}

/**
 * Restate one pi-ai login event in the seam's vocabulary.
 *
 * A device-code grant is the one event carrying two things the human needs at
 * once — where to go and what to type there — which is why the neutral notice
 * has a `code` beside its `url` rather than folding the code into the message.
 * @param event - what pi-ai reported.
 * @param session - the attempt to report it to.
 */
function relay(event: AuthEvent, session: AuthorizationSession): void {
  switch (event.type) {
    case 'info': {
      const link = event.links?.[0]
      session.notify({ message: event.message, ...link === undefined ? {} : { url: link.url } })
      return
    }
    case 'auth_url':
      session.notify({
        message: event.instructions ?? 'Open this page to continue signing in.',
        url: event.url,
      })
      return
    case 'device_code':
      session.notify({
        message: 'Enter this code on the verification page to finish signing in.',
        url: event.verificationUri,
        code: event.userCode,
      })
      return
    case 'progress':
      session.notify({ message: event.message })
      return
    default:
      // pi-ai's event union is open to new members: a build that meets one it
      // does not know still shows the human that something is happening rather
      // than going silent mid-login.
      session.notify({ message: 'Signing in…' })
  }
}

/**
 * Restate one pi-ai prompt in the seam's vocabulary.
 *
 * `manual_code` becomes a plain text question because the difference pi-ai
 * draws — a code the human copies from a browser rather than a value they know
 * — changes nothing a surface renders. Its own `signal` is carried through, and
 * that is the part which matters: it is how a flow racing a typed code against
 * a browser callback withdraws the losing question.
 * @param prompt - what pi-ai asked.
 * @returns the neutral prompt to put to the human.
 */
function restate(prompt: AuthPrompt): AuthorizationPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  switch (prompt.type) {
    case 'select':
      return { ...signal, kind: 'select', message: prompt.message, options: prompt.options }
    case 'secret':
      return {
        ...signal,
        kind: 'secret',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    default:
      return {
        ...signal,
        kind: 'text',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
  }
}

/**
 * Run one contributed login and store the key it produced.
 *
 * The contributor never writes the record: this package owns the format every
 * `llm-pi-ai` record is written in, so a contribution that reported success
 * while storing nothing — or an empty key, which authenticates no request — is
 * refused here rather than settling as an authorized attempt.
 * @param contribution - the contributed login the caller picked.
 * @param providerId - the route whose credential is being written.
 * @param session - the running attempt.
 * @param auth - the injectables carrying the credential store.
 * @throws {LlmError} code `EMPTY_CONTRIBUTED_KEY` when the login resolved without a usable key.
 */
async function runContributed(
  contribution: PiAiLoginContribution,
  providerId: string,
  session: AuthorizationSession,
  auth: PiAiAuthInjection,
): Promise<void> {
  const { apiKey } = await contribution.run(session)
  if (apiKey.length === 0) {
    throw new LlmError(
      `llm-pi-ai: the "${contribution.method.id}" login for route "${providerId}" resolved without a key`,
      'EMPTY_CONTRIBUTED_KEY',
    )
  }
  await auth.credentials.modify(providerId, () => Promise.resolve({ type: 'api_key', key: apiKey }))
}

/**
 * Run one attempt on the route's own pi-ai login.
 * @param provider - the installed catalog provider being signed into.
 * @param providerId - the route key, which is also pi-ai's provider id.
 * @param session - the running attempt.
 * @param auth - the injectables every collection here is built with.
 */
async function runPiAi(
  provider: Provider,
  providerId: string,
  session: AuthorizationSession,
  auth: PiAiAuthInjection,
): Promise<void> {
  // A collection of its own, holding only the provider being signed into:
  // login is not serving requests, and the credential it produces lands in the
  // shared store either way.
  const models = createModels(auth)
  models.setProvider(provider)
  // Total over the two ids pi-ai declares, and the seam only ever hands back
  // one the flow declared.
  const type: AuthType = session.method === 'oauth' ? 'oauth' : 'api_key'
  // pi-ai persists what the login returns through that same store, which is
  // what makes it the single writer of this record.
  await models.login(providerId, type, {
    signal: session.signal,
    notify: (event) => { relay(event, session) },
    prompt: prompt => session.prompt(restate(prompt)),
  })
}

/**
 * Register one authorization flow per installed provider that ships a login.
 *
 * Registration is unconditional on configuration: a provider has to be signed
 * into before a route for it is worth adding, so the flow exists from the
 * moment the plugin mounts rather than appearing once a profile does. A route
 * whose contributed methods change is re-registered in place, which withdraws
 * an attempt running for it — the alternative is a picker offering a method the
 * running flow cannot serve.
 * @param ctx - the plugin context carrying `ctx.authorization`.
 * @param auth - the injectables every collection here is built with.
 */
export function registerPiAiFlows(ctx: Context, auth: PiAiAuthInjection): void {
  const registered = new Map<string, () => void>()

  const register = (providerId: string): void => {
    const provider = catalogProvider(providerId)
    /* v8 ignore next 2 -- every id reaching here names an installed provider,
       whether it came from the catalog or from a contribution this package
       already refused for an id the catalog does not ship. */
    if (provider === undefined) return
    const [first, ...rest] = loginMethods(ctx, provider)
    /* v8 ignore next 2 -- every installed provider ships a login, so no entry
       is skipped; the guard keeps that from becoming a crash if it stops being true. */
    if (first === undefined) return
    /* v8 ignore next 7 -- every installed catalog id is a lowercase
       hyphenated identifier; the guard keeps a future upstream id outside the
       record grammar (dotted or uppercase, as vendor ids elsewhere already
       are) from throwing in `recordKeyFor` and failing the whole mount. */
    if (!isCredentialKeySegment(providerId)) {
      ctx.logger.warn(
        'llm-pi-ai: catalog provider "%s" cannot address a credential record; its sign-in is not offered',
        providerId)
      return
    }
    registered.set(providerId, ctx.authorization.registerFlow({
      key: recordKeyFor(providerId),
      label: provider.name,
      methods: [first, ...rest],
      async run(session) {
        const contribution = contributedLogins(ctx, providerId)
          .find(entry => entry.method.id === session.method)
        if (contribution === undefined) await runPiAi(provider, providerId, session, auth)
        else await runContributed(contribution, providerId, session, auth)
        // After the credential, because a route declared before one exists
        // would register and then fail every request until the login finished.
        await declareRoute(ctx, providerId)
      },
    }))
  }

  for (const providerId of catalogProviderIds()) register(providerId)

  watchContributedLogins(ctx, (providerId) => {
    const previous = registered.get(providerId)
    /* v8 ignore next 2 -- a contribution can only name an installed route, and
       every installed route registered its flow in the loop above. */
    if (previous === undefined) return
    previous()
    registered.delete(providerId)
    register(providerId)
  })
}
