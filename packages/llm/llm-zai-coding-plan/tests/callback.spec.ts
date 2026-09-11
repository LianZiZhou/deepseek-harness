import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CALLBACK_PATH, listenForCallback } from '../src/callback.ts'
import type { LoopbackListener } from '../src/callback.ts'

const open: LoopbackListener[] = []
const blockers: Server[] = []

afterEach(async () => {
  for (const listener of open.splice(0)) listener.close()
  await Promise.all(blockers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

/** An ephemeral listener, registered for teardown. */
async function listening(): Promise<LoopbackListener> {
  const listener = await listenForCallback(0)
  expect(listener).toBeDefined()
  open.push(listener as LoopbackListener)
  return listener as LoopbackListener
}

/** Deliver one redirect to a listener and report what the browser saw. */
async function redirect(listener: LoopbackListener, path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${listener.port}${path}`)
}

describe('the loopback redirect listener', () => {
  it('reports the code and state the browser delivered', async () => {
    const listener = await listening()
    const answer = await redirect(listener, `${CALLBACK_PATH}?code=abc&state=xyz`)
    expect(answer.status).toBe(200)
    await expect(answer.text()).resolves.toContain('Signed in')
    await expect(listener.received).resolves.toEqual({ code: 'abc', state: 'xyz' })
  })

  it('reports a code the redirect carried without a state', async () => {
    const listener = await listening()
    await redirect(listener, `${CALLBACK_PATH}?code=abc`)
    await expect(listener.received).resolves.toEqual({ code: 'abc' })
  })

  it('fails the sign-in when the browser delivers a refusal', async () => {
    const listener = await listening()
    const rejected = expect(listener.received).rejects.toThrow(/refused the sign-in: access_denied/)
    const answer = await redirect(listener, `${CALLBACK_PATH}?error=access_denied`)
    expect(answer.status).toBe(400)
    await expect(answer.text()).resolves.toContain('Sign-in refused')
    await rejected
  })

  it('keeps waiting when the redirect carries no code', async () => {
    const listener = await listening()
    for (const query of ['', '?code=']) {
      const answer = await redirect(listener, `${CALLBACK_PATH}${query}`)
      expect(answer.status).toBe(400)
      await expect(answer.text()).resolves.toContain('Sign-in incomplete')
    }
    await expect(Promise.race([listener.received, Promise.resolve('still waiting')]))
      .resolves.toBe('still waiting')
  })

  it('answers anything else as not found', async () => {
    const listener = await listening()
    const answer = await redirect(listener, '/favicon.ico')
    expect(answer.status).toBe(404)
    await expect(answer.text()).resolves.toContain('Not found')
  })

  it('declines to listen when the port is already taken', async () => {
    const blocker = createServer()
    blockers.push(blocker)
    await new Promise<void>((resolve) => { blocker.listen(0, '127.0.0.1', () => { resolve() }) })
    const taken = (blocker.address() as AddressInfo).port
    await expect(listenForCallback(taken)).resolves.toBeUndefined()
  })

  it('stops listening once closed', async () => {
    const listener = await listenForCallback(0) as LoopbackListener
    const { port } = listener
    listener.close()
    await expect(fetch(`http://127.0.0.1:${port}${CALLBACK_PATH}?code=abc`)).rejects.toThrow()
  })
})
