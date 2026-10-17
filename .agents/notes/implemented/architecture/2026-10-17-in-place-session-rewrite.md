# Agent Note: In-place Session log rewrite

Status: implemented

English | [中文](2026-10-17-in-place-session-rewrite.zh.md)

## Problem

Users inspecting an agent loop need to change any part of the context the model sees, then continue from a chosen point under the same Session. Forking at any event already keeps the original Session intact, but the requested edit mode overwrites the existing Session. The Session log is append-only, persistence promises that `append` never rewrites committed events, a live Agent holds the single write handle, and projection caches and client followers hold state keyed by the old seqs.

## Decision

`session.rewrite` is the only path that replaces a stored log. It runs in four owners:

- `buildRewriteLog` in `dsh-session` keeps `events[0..throughSeq]`, applies content replacements, message deletions, and inserted user messages, remaps envelope seq references and `developer/message.headerSeq`, and closes an open tail turn with `interrupted` closers that the resume policy accepts. An edited assistant message drops its embedded stream, usage, and provider replay state. Renumbering across an event whose data may cite seqs (`UNMAPPABLE_REFERENCE`), a broken tool-call pairing (`INVALID_RESULT`), or an edit inside an inherited fork prefix (which unseeds the log) are decided here, and the controller then validates the result with the `Session` seed invariants before storage changes.
- `SessionPersistence.replace` atomically replaces the whole log under write ownership. The JSONL backend writes a synced temporary file, links the previous current-format file as `<file>.rewrite-<ms>.bak`, and renames over the generation path; historical-format logs must be migrated by a write open first. Backends without the operation refuse with `SessionReplaceUnsupportedError`.
- The Session controller keeps the `AgentHandle` of every Agent it creates or resumes, refuses a live Agent another owner started, stops its own Agent, checks the client's `expectedCursor`, replaces the log, invalidates the projection cache record, emits `api-session/rewritten` before resuming, and optionally starts a turn. Concurrent resolutions of the Session wait for the resumed Agent.
- Clients drop projections and the open history window on `api-session/rewritten`; host followers of the Session end. The Context tab of `ui-trajectory` reads `session.context` and commits staged edits through `session.rewrite`.

The rewritten log is exactly what the model sees next, so "model-visible means logged" still holds. System prompt, tools, and request configuration are re-derived every step and stay read-only in the editor.

## Alternatives considered

**Fork and append overriding events.** Keeps every log append-only and is already available as "fork from here", but the user explicitly required the existing Session to change in place.

**Surface `replace` events in the same Session.** Shadows old messages without removing them and cannot express tool-call argument edits, deletions inside a step, or a cut that discards later events.

**Revision-named generation files.** A `session.vN.rK.jsonl` naming would never replace a committed path, but it changes generation selection, migration, and header identity across every reader. The backup link keeps the previous content recoverable with a local change.

**Editing system prompt, tools, and config in place.** The loop re-projects them every step, so an edited logged copy would be overwritten by the next request; a durable override needs its own logged record.

## Consequences

Older harness builds read a replaced log like any other current-format log. Followers and caches that missed `api-session/rewritten` recover through the changed persistence revision. Backups accumulate beside the Session log until removed by hand. Plugin records that cite seqs block deletions and insertions before them; content edits and cuts remain available.

Verification covers every edit kind and rejection in `rewrite.spec.ts`, JSONL replacement, cancellation, refusal, and backup in `replace.spec.ts`, controller stop/replace/resume ordering, conflicts, ownership, failures, and follower closure in `session-rewrite.host.spec.ts`, and the Context tab edit and restart flows in `context-view.client.spec.tsx`.
