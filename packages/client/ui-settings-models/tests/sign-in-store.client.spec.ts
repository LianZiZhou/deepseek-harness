/** The Models page's sign-in conversation: the list, one attempt, and its pushed events. */
import { describe, expect, it, vi } from 'vitest'
import type {
  AuthorizationEntryView, AuthorizationNoticeEvent, AuthorizationPromptEvent,
} from '@deepseek-ai/dsh-api-settings-controller/types'
import { SignInStore } from '../src/client/sign-in-store.ts'
import type { SignInRemote } from '../src/client/sign-in-store.ts'

/** Answers over the Remote carrier, which has no envelope. */
type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { code: string; message: string; details: object } }

function remoteOk<T>(value: T): RemoteAnswer<T> {
  return { ok: true, value }
}

function remoteFail<T>(message: string): RemoteAnswer<T> {
  return { ok: false, error: { code: 'authorization-rejected', message, details: {} } }
}

const KEY = 'llm-pi-ai/zai'

const FLOW: AuthorizationEntryView = {
  key: KEY,
  label: 'Z.AI',
  methods: [{ id: 'oauth', label: 'Sign in with Z.AI' }, { id: 'api-key', label: 'Z.AI API key' }],
  inFlight: false,
}

/** A notice as the carrier delivers it. */
function notice(attempt: string, extra: Partial<AuthorizationNoticeEvent> = {}): AuthorizationNoticeEvent {
  return { attempt, key: KEY, message: 'Open this page', ...extra }
}

/** A question as the carrier delivers it. */
function prompt(attempt: string, id: string, extra: Partial<AuthorizationPromptEvent> = {}): AuthorizationPromptEvent {
  return { attempt, key: KEY, prompt: id, kind: 'text', message: 'Paste the code', ...extra }
}

/** A remote whose `begin` stays open until the test settles it. */
function remote(overrides: Partial<SignInRemote> = {}): SignInRemote & {
  settle: (outcome: RemoteAnswer<{ status: 'authorized' | 'cancelled' }>) => void
  calls: { answer: string[][]; cancel: string[][]; decline: string[][] }
} {
  let settle: (outcome: RemoteAnswer<{ status: 'authorized' | 'cancelled' }>) => void = () => {}
  const calls: { answer: string[][]; cancel: string[][]; decline: string[][] } = { answer: [], cancel: [], decline: [] }
  const api = {
    list: vi.fn(() => Promise.resolve(remoteOk([FLOW]))),
    begin: vi.fn(() => new Promise<RemoteAnswer<{ status: 'authorized' | 'cancelled' }>>((resolve) => {
      settle = resolve
    })),
    answer: vi.fn((...args: string[]) => { calls.answer.push(args); return Promise.resolve(remoteOk(undefined)) }),
    decline: vi.fn((...args: string[]) => { calls.decline.push(args); return Promise.resolve(remoteOk(undefined)) }),
    cancel: vi.fn((...args: string[]) => { calls.cancel.push(args); return Promise.resolve(remoteOk(undefined)) }),
    ...overrides,
  }
  return Object.assign(api, { settle: (outcome: Parameters<typeof settle>[0]) => { settle(outcome) }, calls })
}

describe('the sign-in controller', () => {
  it('reads the flows this composition offers', async () => {
    const api = remote()
    const store = new SignInStore(api)
    expect(store.store.getSnapshot().status).toBe('idle')
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', flows: [FLOW] })
  })

  it('renders nothing to offer when the list cannot be read', async () => {
    const store = new SignInStore(remote({ list: vi.fn(() => Promise.resolve(remoteFail('no seam'))) as never }))
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', flows: [] })
  })

  it('re-reads the list only once it has been read at all', async () => {
    const api = remote()
    const store = new SignInStore(api)
    await store.reload()
    expect(api.list).not.toHaveBeenCalled()
    await store.load()
    await store.reload()
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('follows one attempt from its notices to its outcome', async () => {
    const api = remote()
    const store = new SignInStore(api)
    const running = store.begin(KEY, 'oauth')
    expect(store.attempt(KEY).busy).toBe(true)
    store.notice(notice('a1', { url: 'https://chat.z.ai', code: 'WXYZ' }))
    expect(store.attempt(KEY)).toMatchObject({ attempt: 'a1', notices: [expect.objectContaining({ code: 'WXYZ' })] })
    api.settle(remoteOk({ status: 'authorized' }))
    await running
    expect(store.attempt(KEY)).toMatchObject({ busy: false, outcome: 'authorized', attempt: undefined })
    expect(api.begin).toHaveBeenCalledWith(KEY, 'oauth')
  })

  it('shows the flow\'s own message when a sign-in breaks', async () => {
    const api = remote()
    const store = new SignInStore(api)
    const running = store.begin(KEY)
    api.settle(remoteFail('Z.AI token exchange failed'))
    await running
    expect(store.attempt(KEY)).toMatchObject({ busy: false, error: 'Z.AI token exchange failed' })
  })

  it('answers the open question and drops it from the row', async () => {
    const api = remote()
    const store = new SignInStore(api)
    const running = store.begin(KEY, 'oauth')
    store.prompt(prompt('a1', 'p1', { placeholder: 'code…' }))
    store.type(KEY, 'pasted')
    expect(store.attempt(KEY).draft).toBe('pasted')
    expect(store.attempt(KEY).prompt?.prompt).toBe('p1')
    await store.answer(KEY, 'pasted')
    expect(api.calls.answer).toEqual([['a1', 'p1', 'pasted']])
    expect(store.attempt(KEY)).toMatchObject({ prompt: undefined, draft: '' })
    api.settle(remoteOk({ status: 'authorized' }))
    await running
  })

  it('reports a refused answer without losing the row', async () => {
    const api = remote({
      answer: vi.fn(() => Promise.resolve(remoteFail('no open question'))) as never,
    })
    const store = new SignInStore(api)
    const running = store.begin(KEY, 'oauth')
    store.prompt(prompt('a1', 'p1'))
    await store.answer(KEY, 'late')
    expect(store.attempt(KEY).error).toBe('no open question')
    api.settle(remoteOk({ status: 'cancelled' }))
    await running
  })

  it('declines the open question', async () => {
    const api = remote()
    const store = new SignInStore(api)
    const running = store.begin(KEY, 'oauth')
    store.prompt(prompt('a1', 'p1'))
    await store.decline(KEY)
    expect(api.calls.decline).toEqual([['a1', 'p1']])
    expect(store.attempt(KEY).prompt).toBeUndefined()
    api.settle(remoteOk({ status: 'cancelled' }))
    await running
  })

  it('answers and declines nothing when no question is open', async () => {
    const api = remote()
    const store = new SignInStore(api)
    await store.answer(KEY, 'value')
    await store.decline(KEY)
    expect(api.calls.answer).toEqual([])
    expect(api.calls.decline).toEqual([])
  })

  it('withdraws the running attempt', async () => {
    const api = remote()
    const store = new SignInStore(api)
    const running = store.begin(KEY, 'oauth')
    await store.cancel(KEY)
    expect(api.calls.cancel).toEqual([[KEY]])
    api.settle(remoteOk({ status: 'cancelled' }))
    await running
    expect(store.attempt(KEY).outcome).toBe('cancelled')
  })

  it('stops showing a question its flow withdrew', async () => {
    const api = remote()
    const store = new SignInStore(api)
    const running = store.begin(KEY, 'oauth')
    store.prompt(prompt('a1', 'p1'))
    store.promptClosed({ attempt: 'a1', prompt: 'other' })
    expect(store.attempt(KEY).prompt).toBeDefined()
    store.promptClosed({ attempt: 'a1', prompt: 'p1' })
    expect(store.attempt(KEY).prompt).toBeUndefined()
    api.settle(remoteOk({ status: 'authorized' }))
    await running
  })

  it('answers the idle row for a flow that never ran', () => {
    const store = new SignInStore(remote())
    expect(store.attempt('llm-pi-ai/anthropic')).toEqual({ notices: [], draft: '', busy: false })
  })

  it('reads a message out of whatever the carrier reported', async () => {
    const api = remote()
    const store = new SignInStore(api)
    const running = store.begin(KEY)
    api.settle({ ok: false, error: 'plain string' } as never)
    await running
    expect(store.attempt(KEY).error).toBe('plain string')

    const second = remote()
    const other = new SignInStore(second)
    const running2 = other.begin(KEY)
    second.settle({ ok: false, error: new Error('thrown') } as never)
    await running2
    expect(other.attempt(KEY).error).toBe('thrown')
  })
})
