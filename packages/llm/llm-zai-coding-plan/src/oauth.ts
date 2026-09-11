/**
 * The GLM Coding Plan browser sign-in, from the authorize page to the durable
 * key the route stores.
 *
 * The conversation is Z.AI's own desktop flow: an authorization-code request
 * against `chat.z.ai` with no PKCE, a token exchange whose body is not the
 * OAuth-standard one, and a key-provisioning sequence afterwards. None of the
 * three is a published API, so every field this module sends is the one Z.AI's
 * own client sends.
 *
 * @module dsh-llm-zai-coding-plan/oauth
 */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { PiAiContributedKey } from '@deepseek-ai/dsh-llm-pi-ai'
import { CALLBACK_PATH, listenForCallback } from './callback.ts'
import { mintCodingPlanKey } from './mint.ts'
import { trimmedString, ZaiSignInError, zaiPost } from './transport.ts'
import type { ZaiFetch, ZaiRequestContext } from './transport.ts'

/** Z.AI's own desktop client id; the authorize page rejects any other. */
const CLIENT_ID = 'client_P8X5CMWmlaRO9gyO-KSqtg'

/** The page the human signs in on. */
const AUTHORIZE_URL = 'https://chat.z.ai/api/oauth/authorize'

/** The endpoint that turns an authorization code into an OAuth access token. */
const TOKEN_URL = 'https://zcode.z.ai/api/v1/oauth/token'

/**
 * The port the browser is redirected back to. Fixed rather than ephemeral
 * because Z.AI matches the redirect against the address its own client
 * registers; a port of this harness's choosing is refused at the authorize
 * page, before the human can do anything about it.
 */
export const CALLBACK_PORT = 54548

/** What a caller may replace for a test; production supplies neither. */
export interface ZaiSignInOptions {
  /** The fetch implementation every Z.AI call runs on. */
  readonly fetch?: ZaiFetch
  /** The loopback port to listen on; `0` binds an ephemeral one. */
  readonly port?: number
}

/** An authorization code and the state it came back with. */
interface AuthorizationAnswer {
  code?: string
  state?: string
}

/**
 * Read an authorization answer out of whatever the human pasted.
 *
 * A human who cannot reach the loopback address copies something from the
 * browser's address bar, and what lands in the box is the whole redirect as
 * often as it is the code alone. All four spellings Z.AI's redirect can be
 * reduced to are accepted, because asking again for a differently-shaped copy
 * of the same value is not a question anyone can act on.
 * @param input - the pasted text.
 * @returns the code and state it carried, either of which may be absent.
 */
export function parseAuthorizationAnswer(input: string): AuthorizationAnswer {
  const value = input.trim()
  if (value.length === 0) return {}
  if (URL.canParse(value)) return fromQuery(new URL(value).searchParams)
  const separator = value.indexOf('#')
  if (separator >= 0) return { code: value.slice(0, separator), state: value.slice(separator + 1) }
  if (value.includes('code=')) return fromQuery(new URLSearchParams(value))
  return { code: value }
}

/**
 * The authorization answer one query string carries.
 * @param params - the parsed query.
 * @returns its code and state, either of which may be absent.
 */
function fromQuery(params: URLSearchParams): AuthorizationAnswer {
  const code = params.get('code')
  const state = params.get('state')
  return {
    ...code === null ? {} : { code },
    ...state === null ? {} : { state },
  }
}

/**
 * The page to send the human to.
 * @param state - the value this attempt expects echoed back.
 * @param redirectUri - the address the browser is redirected to afterwards.
 * @returns the authorize URL.
 */
function authorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: 'code',
    client_id: CLIENT_ID,
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

/**
 * Exchange the authorization code for the OAuth access token.
 *
 * The body carries neither `grant_type` nor a code verifier: this endpoint is
 * Z.AI's, not a standard OAuth token endpoint, and it refuses the standard
 * shape.
 * @param answer - the code and the redirect it was issued against.
 * @param context - the fetch implementation and the attempt's cancellation signal.
 * @returns the short-lived access token.
 * @throws {ZaiSignInError} code `ZAI_NO_ACCESS_TOKEN` when the reply carries none.
 */
async function exchangeCode(
  answer: { code: string; state: string; redirectUri: string },
  context: ZaiRequestContext,
): Promise<string> {
  const body = {
    provider: 'zai',
    code: answer.code,
    redirect_uri: answer.redirectUri,
    state: answer.state,
  }
  const data = await zaiPost(TOKEN_URL, body, {}, 'token exchange', context) as
    { zai?: { access_token?: unknown } } | undefined
  const accessToken = trimmedString(data?.zai?.access_token)
  if (accessToken === undefined) {
    throw new ZaiSignInError('Z.AI token exchange returned no access token', 'ZAI_NO_ACCESS_TOKEN')
  }
  return accessToken
}

/**
 * Wait for the authorization code, from whichever of the two ways it arrives.
 *
 * The browser redirect and the pasted address are raced rather than ordered:
 * the human on the harness's own machine never sees the question, and the one
 * whose browser is elsewhere is not left waiting on a redirect that cannot
 * reach this process. Whichever loses is withdrawn, so a surface never keeps
 * showing a question the flow has already answered.
 * @param session - the running attempt.
 * @param listener - the loopback listener, when one could be bound.
 * @returns the code and the state it came back with.
 */
async function awaitAuthorization(
  session: AuthorizationSession,
  listener: Awaited<ReturnType<typeof listenForCallback>>,
): Promise<AuthorizationAnswer> {
  const withdraw = new AbortController()
  const pasted = session.prompt({
    kind: 'text',
    message: 'Paste the address your browser was redirected to, or the authorization code it showed.',
    placeholder: `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}?code=…`,
    signal: withdraw.signal,
  }).then(text => ({ pasted: text }))
  // Attached before the race so the withdrawn question's rejection is never
  // the process's problem, whichever side wins.
  pasted.catch(() => {})
  const caught = listener?.received.then(query => ({ query }))
  const winner = caught === undefined ? await pasted : await Promise.race([pasted, caught])
  withdraw.abort()
  return 'query' in winner ? winner.query : parseAuthorizationAnswer(winner.pasted)
}

/**
 * Run one GLM Coding Plan sign-in.
 *
 * @param session - the running attempt, carrying the human and the cancellation signal.
 * @param options - test-supplied replacements for the fetch implementation and the loopback port.
 * @returns the durable key to store for the `zai` route.
 * @throws {ZaiSignInError} code `ZAI_NO_CODE` when no authorization code arrived,
 *   or `ZAI_STATE_MISMATCH` when the answer belongs to a different attempt.
 */
export async function runZaiSignIn(
  session: AuthorizationSession,
  options: ZaiSignInOptions = {},
): Promise<PiAiContributedKey> {
  const context: ZaiRequestContext = { fetch: options.fetch ?? fetch, signal: session.signal }
  const state = randomUUID()
  const port = options.port ?? CALLBACK_PORT
  const listener = await listenForCallback(port)
  try {
    const redirectUri = `http://localhost:${listener?.port ?? port}${CALLBACK_PATH}`
    session.notify({
      message: listener === undefined
        ? 'Open this page to sign in to Z.AI, then paste the address your browser ends up at.'
        : 'Open this page to sign in to Z.AI; this harness is listening for the redirect.',
      url: authorizeUrl(state, redirectUri),
    })
    const answer = await awaitAuthorization(session, listener)
    if (answer.code === undefined || answer.code.length === 0) {
      throw new ZaiSignInError('Z.AI sign-in produced no authorization code', 'ZAI_NO_CODE')
    }
    if (answer.state !== undefined && answer.state !== state) {
      throw new ZaiSignInError(
        'Z.AI returned an authorization code for a different sign-in attempt', 'ZAI_STATE_MISMATCH')
    }
    session.notify({ message: 'Exchanging the authorization code…' })
    const accessToken = await exchangeCode({ code: answer.code, state, redirectUri }, context)
    session.notify({ message: 'Provisioning your Z.AI API key…' })
    return { apiKey: await mintCodingPlanKey(accessToken, context) }
  } finally {
    listener?.close()
  }
}
