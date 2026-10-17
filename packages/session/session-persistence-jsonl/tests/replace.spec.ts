import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyOwnedError, SessionPersistenceNotFoundError,
  type SessionPersistence,
} from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { sessionDir } from '../src/format.ts'
import type { JsonlCompression } from '../src/format.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function mount(compression: JsonlCompression): Promise<{ root: string; persistence: SessionPersistence }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-replace-'))
  const ctx = new Context()
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression })
  cleanups.push(async () => {
    await fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { root, persistence: ctx.sessionPersistence }
}

async function store(persistence: SessionPersistence, id: string): Promise<void> {
  const handle = await persistence.create(meta(id, '/work'))
  await handle.append(oneTurnLog())
  await handle.close()
}

describe('JsonlSessionPersistence.replace', () => {
  it.each(['none', 'zstd'] as const)('swaps the complete log, changes the revision, and keeps a backup (%s)', async (compression) => {
    const { root, persistence } = await mount(compression)
    await store(persistence, 'replaced')
    const before = await persistence.stat(SessionId('replaced'))
    const shorter = oneTurnLog().slice(0, 2)

    await persistence.replace({ meta: meta('replaced', '/work'), inheritedEventCount: SessionLogOffset(0), events: shorter })

    const after = await persistence.stat(SessionId('replaced'))
    expect(after?.revision).not.toBe(before?.revision)
    await using handle = await persistence.open(SessionId('replaced'), 'write')
    expect((await handle.read()).events).toEqual(shorter)
    const entries = await readdir(sessionDir(root, '/work', SessionId('replaced')))
    expect(entries.filter(name => name.includes('.rewrite-') && name.endsWith('.bak'))).toHaveLength(1)
    await handle.append([{ ...oneTurnLog()[2]!, seq: oneTurnLog()[2]!.seq }])
    expect((await handle.read()).events).toHaveLength(3)
  })

  it('refuses while a write handle is active and leaves the log unchanged', async () => {
    const { persistence } = await mount('none')
    await store(persistence, 'owned')
    await using handle = await persistence.open(SessionId('owned'), 'write')

    await expect(persistence.replace({ meta: meta('owned', '/work'), inheritedEventCount: SessionLogOffset(0), events: [] }))
      .rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    expect((await handle.read()).events).toHaveLength(oneTurnLog().length)
  })

  it('refuses a missing session and a non-contiguous log', async () => {
    const { persistence } = await mount('none')
    await expect(persistence.replace({ meta: meta('missing', '/work'), inheritedEventCount: SessionLogOffset(0), events: [] }))
      .rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
    await store(persistence, 'gap')
    await expect(persistence.replace({ meta: meta('gap', '/work'), inheritedEventCount: SessionLogOffset(0), events: oneTurnLog().slice(1) }))
      .rejects.toThrow(/seq mismatch/)
  })

  it('observes cancellation before publication', async () => {
    const { persistence } = await mount('none')
    await store(persistence, 'cancelled')
    const controller = new AbortController()
    controller.abort()
    await expect(persistence.replace({ meta: meta('cancelled', '/work'), inheritedEventCount: SessionLogOffset(0), events: [] }, { signal: controller.signal }))
      .rejects.toThrow()
    await using handle = await persistence.open(SessionId('cancelled'), 'read')
    expect((await handle.read()).events).toHaveLength(oneTurnLog().length)
  })
})
