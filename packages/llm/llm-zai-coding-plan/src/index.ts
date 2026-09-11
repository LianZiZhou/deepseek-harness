/**
 * Browser sign-in for Z.AI's GLM Coding Plan, offered as a login method on the
 * pi-ai adapter's `zai` route.
 *
 * Z.AI issues no token an inference request can use directly: the browser
 * conversation ends in a short-lived OAuth token, and the key that authenticates
 * requests is minted from it afterwards through Z.AI's business API. So this
 * plugin's product is an ordinary api key, which is why it contributes a method
 * to the route pi-ai already ships rather than adding a provider of its own —
 * the models, the endpoint, and the stored record all stay the `zai` route's.
 *
 * ```yaml
 * - name: '@deepseek-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       zai: {}
 * - name: '@deepseek-ai/dsh-llm-zai-coding-plan'
 * ```
 *
 * @module @deepseek-ai/dsh-llm-zai-coding-plan
 */

import type { Context } from '@deepseek-ai/cordis'
import { contributePiAiLogin } from '@deepseek-ai/dsh-llm-pi-ai'
import { runZaiSignIn } from './oauth.ts'

export { KEY_NAME } from './mint.ts'
export { CALLBACK_PORT } from './oauth.ts'
export { runZaiSignIn }
export type { ZaiSignInOptions } from './oauth.ts'
export { ZaiSignInError } from './transport.ts'

export const name = 'llm-zai-coding-plan'

/** The pi-ai route this sign-in authenticates; its models and endpoint are pi-ai's own. */
const ROUTE = 'zai'

/**
 * Offer the GLM Coding Plan sign-in on the `zai` route.
 *
 * The method is offered whether or not a profile configures the route: signing
 * in is what makes the route worth configuring, and a composition that never
 * mounts the pi-ai adapter simply has no flow for the method to appear on.
 * @param ctx - the plugin context.
 * @returns Disposer that withdraws the method.
 */
export function apply(ctx: Context): () => void {
  return contributePiAiLogin(ctx, {
    provider: ROUTE,
    method: { id: 'oauth', label: 'Sign in with Z.AI (GLM Coding Plan)' },
    run: session => runZaiSignIn(session),
  })
}
