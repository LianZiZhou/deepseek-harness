/**
 * The loopback listener that catches Z.AI's browser redirect.
 *
 * Z.AI returns the authorization code by redirecting the browser at a local
 * address, so the sign-in listens on one while the human is away. The listener
 * is optional by design: the port can already be taken, and the browser can be
 * on a different machine than the harness, so failing to listen is a fallback
 * to the pasted redirect rather than a failed sign-in.
 *
 * @module dsh-llm-zai-coding-plan/callback
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** The loopback address the redirect is caught on; never a routable interface. */
const CALLBACK_HOST = '127.0.0.1'

/** The redirect path, which is part of what Z.AI is asked to redirect to. */
export const CALLBACK_PATH = '/callback'

/** What the browser delivered to the redirect. */
export interface ZaiCallbackQuery {
  /** The authorization code to exchange. */
  readonly code: string
  /** The state Z.AI echoed back, when it echoed one. */
  readonly state?: string
}

/** A loopback listener waiting for one redirect. */
export interface LoopbackListener {
  /** The port actually bound, which the redirect address names. */
  readonly port: number
  /** Settles when the browser delivers the redirect, or rejects when it delivers a refusal. */
  readonly received: Promise<ZaiCallbackQuery>
  /** Stop listening, whether or not the redirect ever arrived. */
  close(): void
}

/** The page shown in the browser tab that completed the sign-in. */
function resultPage(title: string, detail: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + `<title>${title}</title></head><body style="font-family:system-ui;padding:3rem">`
    + `<h1>${title}</h1><p>${detail}</p></body></html>`
}

/** Answer one redirect and report what it carried. */
function handle(
  url: URL,
  settle: { resolve: (query: ZaiCallbackQuery) => void; reject: (error: Error) => void },
): { status: number; body: string } {
  const failure = url.searchParams.get('error')
  if (failure !== null) {
    settle.reject(new Error(`Z.AI refused the sign-in: ${failure}`))
    return { status: 400, body: resultPage('Sign-in refused', 'You can close this tab and try again.') }
  }
  const code = url.searchParams.get('code')
  if (code === null || code.length === 0) {
    return { status: 400, body: resultPage('Sign-in incomplete', 'This address carried no authorization code.') }
  }
  const state = url.searchParams.get('state')
  settle.resolve({ code, ...state === null ? {} : { state } })
  return { status: 200, body: resultPage('Signed in', 'You can close this tab and return to the harness.') }
}

/**
 * Listen on the loopback address for one Z.AI redirect.
 *
 * @param port - the port to bind; `0` binds an ephemeral one.
 * @returns the listener, or undefined when the port cannot be bound — which is
 *   a working sign-in through the pasted redirect, not a failure.
 */
export async function listenForCallback(port: number): Promise<LoopbackListener | undefined> {
  let settle!: { resolve: (query: ZaiCallbackQuery) => void; reject: (error: Error) => void }
  const received = new Promise<ZaiCallbackQuery>((resolve, reject) => { settle = { resolve, reject } })
  const server: Server = createServer((request, response) => {
    // A server request always carries a url; the optional type belongs to the
    // client half of `IncomingMessage`, which this handler never sees.
    const url = new URL(request.url as string, `http://${CALLBACK_HOST}:${port}`)
    const answer = url.pathname === CALLBACK_PATH
      ? handle(url, settle)
      : { status: 404, body: resultPage('Not found', 'This address is not part of the sign-in.') }
    response.writeHead(answer.status, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(answer.body)
  })
  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => { resolve(false) })
    server.listen(port, CALLBACK_HOST, () => { resolve(true) })
  })
  if (!listening) {
    // `received` stays pending forever and is discarded with this listener: no
    // request can reach a server that never bound, so nothing settles it.
    server.close()
    return undefined
  }
  // A TCP server that has emitted `listening` always reports an `AddressInfo`;
  // the string form belongs to a pipe or socket, which this never binds.
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    received,
    close() {
      received.catch(() => {})
      server.closeAllConnections()
      server.close()
    },
  }
}
