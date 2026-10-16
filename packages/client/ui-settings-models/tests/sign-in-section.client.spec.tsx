// @vitest-environment jsdom
/** The Models page's sign-in rows: the whole conversation, rendered. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthorizationEntryView, AuthorizationPromptEvent,
} from '@deepseek-ai/dsh-api-settings-controller/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SignInSection } from '../src/client/SignInSection.tsx'
import { SignInStore } from '../src/client/sign-in-store.ts'
import type { SignInRemote } from '../src/client/sign-in-store.ts'
import { en } from '../src/client/locales.ts'

const KEY = 'llm-pi-ai/zai'

const FLOW: AuthorizationEntryView = {
  key: KEY,
  label: 'Z.AI',
  methods: [{ id: 'oauth', label: 'Sign in with Z.AI' }, { id: 'api-key', label: 'Z.AI API key' }],
  inFlight: false,
}

const t = (key: keyof typeof en): string => en[key]

/** A remote whose `begin` stays open until the test settles it. */
function remote(flows: AuthorizationEntryView[] = [FLOW]): SignInRemote & {
  settle: (status: 'authorized' | 'cancelled') => void
  answer: ReturnType<typeof vi.fn>
  decline: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
} {
  let settle!: (outcome: unknown) => void
  const api = {
    list: vi.fn(() => Promise.resolve({ ok: true, value: flows })),
    begin: vi.fn(() => new Promise((resolve) => { settle = resolve })),
    answer: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    decline: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    cancel: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  }
  const typed: SignInRemote = api as never
  return Object.assign(typed, api, {
    settle: (status: 'authorized' | 'cancelled') => { settle({ ok: true, value: { status } }) },
  })
}

/** A question as the carrier delivers it. */
function prompt(id: string, extra: Partial<AuthorizationPromptEvent> = {}): AuthorizationPromptEvent {
  return { attempt: 'a1', key: KEY, prompt: id, kind: 'text', message: 'Paste the code', ...extra }
}

/** Render the section over a loaded store. */
async function mount(api: ReturnType<typeof remote>): Promise<SignInStore> {
  const store = new SignInStore(api)
  await act(async () => { await store.load() })
  render(<SignInSection controller={store} t={t} />)
  return store
}

afterEach(() => { cleanup() })

describe('the sign-in rows', () => {
  it('renders nothing when this composition offers no sign-in', async () => {
    const store = new SignInStore(remote([]))
    await act(async () => { await store.load() })
    const { container } = render(<SignInSection controller={store} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('leaves out a flow whose only method is the key field shown above', async () => {
    const keyOnly: AuthorizationEntryView = {
      key: 'llm-pi-ai/groq',
      label: 'Groq',
      methods: [{ id: 'api-key', label: 'Groq API key' }],
      inFlight: false,
    }
    const store = new SignInStore(remote([keyOnly]))
    await act(async () => { await store.load() })
    const { container } = render(<SignInSection controller={store} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('says the list could not be read instead of pretending there is nothing to sign in to', async () => {
    const api = remote()
    const failing = Object.assign(api, {
      list: vi.fn(() => Promise.resolve({ ok: false, error: new RemoteError('gateway/internal', 'no seam', {}) })),
    }) as never as SignInRemote
    const store = new SignInStore(failing)
    await act(async () => { await store.load() })
    render(<SignInSection controller={store} t={t} />)
    expect(screen.getByText(`${en.signInLoadFailed}: no seam`)).toBeTruthy()
  })

  it('offers one button per method the flow declares', async () => {
    const api = remote()
    await mount(api)
    expect(screen.getByText(en.signInTitle)).toBeTruthy()
    expect(screen.getByText(KEY)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Z.AI' }))
    expect(api.begin).toHaveBeenCalledWith(KEY, 'oauth')
  })

  it('disables the buttons while another page runs the same flow', async () => {
    await mount(remote([{ ...FLOW, inFlight: true }]))
    expect(screen.getByRole('button', { name: 'Sign in with Z.AI' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows the page to open, the code to enter, and offers to withdraw', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    act(() => {
      store.notice({ attempt: 'a1', key: KEY, message: 'Open this page', url: 'https://chat.z.ai', code: 'WXYZ' })
    })
    const link = screen.getByRole('link', { name: en.signInOpenPage })
    expect(link.getAttribute('href')).toBe('https://chat.z.ai')
    expect(screen.getByText('WXYZ')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signInCancel }))
    expect(api.cancel).toHaveBeenCalledWith(KEY)
    await act(async () => { api.settle('cancelled') })
  })

  it('answers a typed question from the button and from Enter', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    act(() => { store.prompt(prompt('p1', { placeholder: 'code…' })) })
    const field = screen.getByLabelText('Paste the code')
    expect(screen.getByRole('button', { name: en.signInSubmit }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(field, { target: { value: 'typed' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.signInSubmit })) })
    expect(api.answer).toHaveBeenCalledWith('a1', 'p1', 'typed')

    act(() => { store.prompt(prompt('p2')) })
    fireEvent.change(screen.getByLabelText('Paste the code'), { target: { value: 'again' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Paste the code'), { key: 'Enter' })
    })
    expect(api.answer).toHaveBeenCalledWith('a1', 'p2', 'again')

    act(() => { store.prompt(prompt('p3')) })
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Paste the code'), { key: 'Enter' }) })
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Paste the code'), { key: 'a' }) })
    expect(api.answer).toHaveBeenCalledTimes(2)
    await act(async () => { api.settle('authorized') })
  })

  it('masks a secret question', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    act(() => { store.prompt(prompt('p1', { kind: 'secret', message: 'Enter the key' })) })
    expect(screen.getByLabelText('Enter the key').getAttribute('type')).toBe('password')
    await act(async () => { api.settle('cancelled') })
  })

  it('answers a select question with the chosen option', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    act(() => {
      store.prompt(prompt('p1', {
        kind: 'select',
        message: 'Pick an account',
        options: [{ id: 'work', label: 'Work', description: 'the work tenant' }, { id: 'me', label: 'Personal' }],
      }))
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Work' })) })
    expect(api.answer).toHaveBeenCalledWith('a1', 'p1', 'work')
    await act(async () => { api.settle('authorized') })
  })

  it('declines a question from the row', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    act(() => { store.prompt(prompt('p1')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.cancel })) })
    expect(api.decline).toHaveBeenCalledWith('a1', 'p1')
    await act(async () => { api.settle('cancelled') })
  })

  it('renders a bare notice and an optionless select without inventing controls', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    act(() => { store.notice({ attempt: 'a1', key: KEY, message: 'Provisioning your key…' }) })
    expect(screen.getByText('Provisioning your key…')).toBeTruthy()
    expect(screen.queryByRole('link', { name: en.signInOpenPage })).toBeNull()
    act(() => { store.prompt(prompt('p1', { kind: 'select', message: 'Pick an account' })) })
    expect(screen.getByText('Pick an account')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signInSubmit })).toBeNull()
    await act(async () => { api.settle('cancelled') })
  })

  it('says how the sign-in ended', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    await act(async () => { api.settle('authorized') })
    expect(screen.getByText('Signed in to Z.AI.')).toBeTruthy()

    const cancelled = remote()
    const other = new SignInStore(cancelled)
    await act(async () => { await other.load() })
    cleanup()
    render(<SignInSection controller={other} t={t} />)
    act(() => { other.begin(KEY, 'oauth').catch(() => {}) })
    await act(async () => { cancelled.settle('cancelled') })
    expect(screen.getByText('The Z.AI sign-in was cancelled.')).toBeTruthy()
  })

  it('shows the flow\'s own failure message', async () => {
    const api = remote()
    const store = await mount(api)
    act(() => { store.begin(KEY, 'oauth').catch(() => {}) })
    await act(async () => {
      store.store.update((s) => {
        s.attempts = { [KEY]: { notices: [], draft: '', busy: false, error: 'token exchange failed' } }
      })
    })
    expect(screen.getByText('token exchange failed')).toBeTruthy()
    await act(async () => { api.settle('cancelled') })
  })
})
