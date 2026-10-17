/** Backends that do not implement log replacement refuse it with a typed error. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionPersistence, SessionReplaceUnsupportedError } from '@deepseek-ai/dsh-session-persistence'
import { meta } from './contract.ts'

class ReadOnlyBackend extends SessionPersistence {
  create(): never { throw new Error('unused') }
  open(): never { throw new Error('unused') }
  flush(): Promise<void> { return Promise.resolve() }
  stat(): Promise<undefined> { return Promise.resolve(undefined) }
  list(): Promise<[]> { return Promise.resolve([]) }
}

describe('SessionPersistence.replace default', () => {
  it('rejects with SessionReplaceUnsupportedError naming the session', async () => {
    const backend = new ReadOnlyBackend(new Context())
    const header = meta('kept')
    await expect(backend.replace({ meta: header, inheritedEventCount: SessionLogOffset(0), events: [] }))
      .rejects.toEqual(new SessionReplaceUnsupportedError(header.id, 'ReadOnlyBackend'))
  })
})
