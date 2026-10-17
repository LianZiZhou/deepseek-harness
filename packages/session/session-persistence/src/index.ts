/**
 * Durable session-persistence Service Definition (`ctx.sessionPersistence`). Backends store
 * {@link SessionEvent}s as the event-sourced log and carry non-replayable
 * {@link SessionHeader} metadata separately; callers address one stored
 * session through a {@link SessionHandle} obtained from `create`/`open`.
 * @module @deepseek-ai/dsh-session-persistence
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionAccess } from './handle.ts'
import type { SessionPersistenceRevision } from './revision.ts'
import { SessionReplaceUnsupportedError } from './errors.ts'

// Re-export the metadata vocabulary so Consumers import it from the Service Definition.
export type { SessionHeader } from '@deepseek-ai/dsh-session'
export { SessionPersistenceRevision } from './revision.ts'
export type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
} from './handle.ts'
export {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionFormatUnsupportedError,
  SessionHandleClosedError,
  SessionOwnershipLostError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionReadOnlyError,
  SessionReplaceUnsupportedError,
  sessionFormatVersionRefusal,
} from './errors.ts'
export type { SessionLocation } from './errors.ts'
export {
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
} from './storage-contract.ts'

/**
 * Lightweight stored-session observation returned by {@link SessionPersistence.stat}
 * and {@link SessionPersistence.list} without reading the full event log.
 */
export interface SessionPersistenceSnapshot {
  /** Detached metadata for one stored session. */
  readonly header: SessionHeader
  /** Header-only format classification; absent without versioned artifact metadata. */
  readonly formatStatus?: 'current' | 'migration-required'
  /** Opaque change token; see {@link SessionPersistence.stat}. */
  readonly revision: SessionPersistenceRevision
  /** Logical event count, when the backend can provide it cheaply from metadata; otherwise absent. */
  readonly eventCount?: number
  /** Physical artifact byte size, when the backend can provide it cheaply (JSONL); otherwise absent. */
  readonly sizeBytes?: number
}

/** Options for {@link SessionPersistence.create}. */
export interface SessionPersistenceCreateOptions {
  /** Optional cancellation observed before backend work starts. */
  readonly signal?: AbortSignal
  /**
   * Exact fork-inherited prefix length. Required when `header.isSeeded` is
   * true and must be omitted (or `0`) otherwise; the backend refuses a
   * mismatch at create.
   */
  readonly inheritedEventCount?: SessionLogOffset
}

/**
 * Logical Session header paired with its exact inherited cut for body-bearing
 * storage operations. `isSeeded` marks fork lineage on the header; the
 * numeric cut travels beside it, never inside the replayable event log.
 */
export interface SessionStorageMetadata {
  /** Validated immutable Session header. */
  readonly meta: SessionHeader
  /** Number of leading events inherited from the Session's fork parent. */
  readonly inheritedEventCount: SessionLogOffset
}

/** Immutable logical session read: storage metadata plus the complete validated event log. */
export interface SessionInspection extends SessionStorageMetadata {
  /** Contiguous validated events from seq 0. */
  readonly events: readonly SessionEvent[]
}

/** Options for {@link SessionPersistence.open}. */
export interface SessionPersistenceOpenOptions {
  /** Optional cancellation observed before backend work starts. */
  readonly signal?: AbortSignal
}

/** Options for {@link SessionPersistence.stat}. */
export interface SessionPersistenceStatOptions {
  /** Optional cancellation for backend metadata reads. */
  readonly signal?: AbortSignal
}

/** Options for {@link SessionPersistence.replace}. */
export interface SessionPersistenceReplaceOptions {
  /** Optional cancellation observed before the replacement publishes. */
  readonly signal?: AbortSignal
}

/** Options for {@link SessionPersistence.list}. */
export interface SessionPersistenceListOptions {
  /** Optional cancellation for backend listing work. */
  readonly signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }
}

/**
 * Durable append-only session storage addressed through per-session handles.
 *
 * Storage semantics shared by every backend: events are contiguous from seq 0
 * and never rewritten by `append`; only an explicit {@link replace} swaps a
 * whole log; a torn physical tail is never returned to a reader and
 * is truncated by the write path before its first append; reads validate
 * current-format records only and refuse unknown vocabulary fail-closed.
 * `append` persists best-effort; `flush` — per handle or service-wide — is
 * the durability barrier.
 *
 * Visibility: a created session is observable through `stat`/`list`/`open`
 * in this process from the moment `create` resolves, even while a backend
 * defers physical materialization (a pure optimization); other processes see
 * the session only once it materializes, and a session that never
 * materialized before a crash never existed. `SessionHandle.flush` forces
 * materialization.
 *
 * Freshness: once an `append` or `flush` resolves, reads started afterwards
 * on this backend instance observe at least that prefix.
 */
export abstract class SessionPersistence extends Service {
  /** Process-local instance identity, stable through Context proxies and distinct after service replacement. */
  readonly identity: symbol = Symbol('sessionPersistence')

  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }

  /**
   * Create a new stored session and take its write ownership.
   * @param header - the immutable header (id, version, cwd, lineage) to store.
   * @param options - optional cancellation.
   * @returns a `write` handle owned by the caller; close it to release ownership.
   * @throws {SessionAlreadyExistsError} when the id already exists.
   */
  abstract create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle>

  /**
   * Open an existing stored session.
   *
   * `read` never takes ownership and works while another handle (or process)
   * holds write ownership. `write` atomically claims single-writer ownership;
   * an existing active owner rejects.
   * @param id - the stored session to open.
   * @param access - `read` or `write`.
   * @param options - optional cancellation.
   * @returns the open handle.
   * @throws {SessionPersistenceNotFoundError} when the session does not exist.
   * @throws {SessionAlreadyOwnedError} for `write` when ownership is taken.
   */
  abstract open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle>

  /**
   * Flush every active write handle owned by this service instance in one
   * durability barrier: each handle's routed live events drain durably and
   * its session materializes, exactly as that handle's own
   * `SessionHandle.flush` would. Read handles buffer nothing and are
   * untouched. A handle closed concurrently counts as flushed — close itself
   * drains durably.
   * @returns resolution once every write handle active at the call has flushed.
   * @throws {AggregateError} naming each session whose flush failed; the
   *   remaining handles still flush.
   */
  abstract flush(): Promise<void>

  /**
   * Observe one stored session without reading its event log or taking
   * ownership.
   *
   * The snapshot's `revision` is an opaque change token comparable only
   * against revisions from the same service instance and session id: equal
   * revisions may be treated as an unchanged log; unequal revisions promise
   * nothing. Write-ownership churn does not change a revision. It exists for
   * derived read-model caches keyed off `stat`/`list`; it plays no part in
   * open, read, or resume.
   * @param id - the stored session to observe.
   * @param options - optional cancellation.
   * @returns the snapshot, or `undefined` when the session does not exist.
   */
  abstract stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined>

  /**
   * List every stored session visible to this process, in no promised order.
   * @param options - optional cancellation.
   * @returns one snapshot per stored session.
   */
  abstract list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]>

  /**
   * Atomically replace one stored session's complete log and header under the
   * same id. The caller must hold no write handle for the session; the
   * backend claims write ownership for the duration of the swap, so a
   * concurrent writer makes it reject instead of interleaving. On resolution
   * every later `open`, `read`, `stat`, and `list` observes the new log and a
   * changed `revision`; on rejection the stored log is unchanged. Backends
   * that cannot replace a log keep this default refusal.
   * @param storage - the replacement header, inherited cut, and complete event log from seq 0.
   * @param options - optional cancellation observed before the replacement publishes.
   * @returns resolution once the replacement is durable.
   * @throws {SessionReplaceUnsupportedError} from backends without log replacement.
   * @throws {SessionPersistenceNotFoundError} when the session does not exist.
   * @throws {SessionAlreadyOwnedError} when a write handle is active.
   */
  replace(storage: SessionInspection, options?: SessionPersistenceReplaceOptions): Promise<void> {
    void options
    return Promise.reject(new SessionReplaceUnsupportedError(storage.meta.id, this.constructor.name))
  }
}

export default SessionPersistence
