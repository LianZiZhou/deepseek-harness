import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyOwnedError, SessionPersistenceNotFoundError,
  type SessionPersistence,
} from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { generationLogFilename, sessionDir } from '../src/format.ts'

const renameFailure = vi.hoisted(() => ({ error: undefined as Error | undefined }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: (from: string, to: string) => {
      const error = renameFailure.error
      renameFailure.error = undefined
      return error === undefined ? actual.rename(from, to) : Promise.reject(error)
    },
  }
})
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

  it('stores a seeded replacement with its inherited cut', async () => {
    const { persistence } = await mount('none')
    await store(persistence, 'seeded')
    const prefix = oneTurnLog()
    const marker = { type: 'session/end-seed' as const, seq: SessionSeq(prefix.length), time: 9, data: { inherited: true as const } }
    const header = { ...meta('seeded', '/work'), isSeeded: true, parentSession: SessionId('parent') }
    await persistence.replace({ meta: header, inheritedEventCount: SessionLogOffset(prefix.length), events: [...prefix, marker] })
    await using handle = await persistence.open(SessionId('seeded'), 'read')
    expect(handle.inheritedEventCount).toBe(prefix.length)
    expect(handle.header).toMatchObject({ isSeeded: true, parentSession: 'parent' })
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

  it('refuses a log stored at a historical format without touching it', async () => {
    const { root, persistence } = await mount('none')
    const dir = sessionDir(root, '/work', SessionId('historical'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, generationLogFilename(1, 'none')), '{}\n')
    await expect(persistence.replace({ meta: meta('historical', '/work'), inheritedEventCount: SessionLogOffset(0), events: [] }))
      .rejects.toThrow(/open it for write once to migrate/)
    expect(await readdir(dir)).toEqual([generationLogFilename(1, 'none')])
  })

  it('removes its temporary file and keeps the old log when publication fails', async () => {
    const { root, persistence } = await mount('none')
    await store(persistence, 'unpublished')
    renameFailure.error = new Error('rename failed')
    await expect(persistence.replace({ meta: meta('unpublished', '/work'), inheritedEventCount: SessionLogOffset(0), events: [] }))
      .rejects.toThrow('rename failed')
    const entries = await readdir(sessionDir(root, '/work', SessionId('unpublished')))
    expect(entries.some(name => name.endsWith('.tmp'))).toBe(false)
    await using handle = await persistence.open(SessionId('unpublished'), 'read')
    expect((await handle.read()).events).toHaveLength(oneTurnLog().length)
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
