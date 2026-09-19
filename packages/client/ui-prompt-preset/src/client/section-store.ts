/**
 * Prompt-preset management controller: the roster as a list, one draft under
 * edit, and the preview that shows what the draft would actually produce.
 *
 * The Host stays the single fact source. Edits are staged here and written only
 * on save, every write re-reads the roster afterwards, and the preview is
 * always the Host's answer rather than a second implementation of the rule
 * engine in the browser.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  PromptPresetPreviewSection,
  PromptPresetRow,
  PromptPresetWarning,
  PromptRule,
  PromptRuleKind,
} from '@deepseek-ai/dsh-prompt-presets/types'
import {
  draftBlocker, emptyRule, idBlocker, mintRuleKey, wireRules,
  type Blocker, type PresetDraft,
} from './preset-model.ts'

/** How this page is reading the Host. */
export type SectionStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

/** The create dialog's staged fields. */
export interface CreateDraft {
  /** The id being typed; becomes the storage key. */
  id: string
  /** The display name being typed. */
  name: string
  /** Whether the create call is in flight. */
  saving: boolean
  /** The last create failure, cleared by the next edit. */
  error: string | null
}

/** What the preview last produced. */
export interface PreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** Sections the assembly produces with no preset at all. */
  baseline: readonly PromptPresetPreviewSection[]
  /** Sections after the candidate's rules. */
  sections: readonly PromptPresetPreviewSection[]
  /** The rendered prompt a step would commit under the candidate. */
  prompt: string
  /** The rendered prompt with no preset. */
  baselinePrompt: string
  /** What the candidate could not do exactly as written. */
  warnings: readonly PromptPresetWarning[]
}

/** Everything the settings section renders. */
export interface PromptPresetSectionState {
  status: SectionStatus
  error: string | null
  /** Whether this deployment can store a preset at all. */
  writable: boolean
  rows: readonly PromptPresetRow[]
  /** Preset used by tasks that name none; `''` when there is none. */
  defaultId: string
  /** Whether a roster write is in flight. */
  busy: boolean
  selectedId: string | null
  draft: PresetDraft | null
  saving: boolean
  saveError: string | null
  create: CreateDraft | null
  pendingDelete: string | null
  deleting: boolean
  /** Set while switching presets would discard unsaved edits. */
  pendingSwitch: string | null
  preview: PreviewState
}

const EMPTY_PREVIEW: PreviewState = {
  status: 'idle',
  error: null,
  baseline: [],
  sections: [],
  prompt: '',
  baselinePrompt: '',
  warnings: [],
}

const INITIAL: PromptPresetSectionState = {
  status: 'idle',
  error: null,
  writable: false,
  rows: [],
  defaultId: '',
  busy: false,
  selectedId: null,
  draft: null,
  saving: false,
  saveError: null,
  create: null,
  pendingDelete: null,
  deleting: false,
  pendingSwitch: null,
  preview: EMPTY_PREVIEW,
}

/** How long an edit rests before the Host is asked to redraw the preview. */
const PREVIEW_DEBOUNCE_MS = 300

/** Roster, editor, and preview for the prompt-preset settings section. */
export class PromptPresetSectionController {
  /** What the page renders, bound by the renderer as `usePromptPresetSection`. */
  readonly store: SnapshotStore<PromptPresetSectionState> = createSnapshotStore(INITIAL)

  /** The read in flight, so concurrent callers share one request. */
  private loadFlight: Promise<void> | undefined
  /** Whether a read arrived while one was already running. */
  private reloadRequested = false

  /** The same flag through a getter, which `load()` may have set mid-await. */
  private get reloadPending(): boolean {
    return this.reloadRequested
  }
  /** The pending preview timer, cleared on teardown. */
  private previewTimer: ReturnType<typeof setTimeout> | undefined
  /** Monotonic preview generation, so a late reply cannot overwrite a newer one. */
  private previewGeneration = 0
  /** The session the preview is drawn against, when one is open. */
  private previewSession: SessionId | undefined

  constructor(
    private readonly ctx: ClientContext,
    private readonly rosterChanged: () => void = () => {},
  ) {}

  /** Merge one patch into the rendered state. */
  private set(patch: Partial<PromptPresetSectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /** Merge one patch into the preview slice. */
  private setPreview(patch: Partial<PreviewState>): void {
    this.set({ preview: { ...this.store.getSnapshot().preview, ...patch } })
  }

  /**
   * Point the preview at one session, or at none.
   * @param sessionId - the session to preview against.
   */
  setPreviewSession(sessionId: SessionId | undefined): void {
    if (this.previewSession === sessionId) return
    this.previewSession = sessionId
    this.schedulePreview({ immediate: true })
  }

  /**
   * Read the roster, coalescing concurrent callers.
   * @returns when the newest read has been applied.
   */
  async load(): Promise<void> {
    if (this.loadFlight !== undefined) {
      this.reloadRequested = true
      return this.loadFlight
    }
    this.loadFlight = this.drainLoads()
    try {
      await this.loadFlight
    } finally {
      this.loadFlight = undefined
    }
  }

  /** Run reads until no further one was requested while the last was running. */
  private async drainLoads(): Promise<void> {
    do {
      this.reloadRequested = false
      await this.loadOnce()
    } while (this.reloadPending)
  }

  /** One roster read. */
  private async loadOnce(): Promise<void> {
    if (this.store.getSnapshot().status === 'idle') this.set({ status: 'loading' })
    const result = await this.ctx.remote.promptPresets.list()
    if (!result.ok) {
      // A deployment that composes no store answers this way; rendering nothing
      // is the honest result, not an error the user can act on.
      if (result.error.code === 'gateway/invocation-unavailable') {
        this.set({ status: 'unavailable', error: null })
        return
      }
      this.set({ status: 'error', error: result.error.message })
      return
    }
    const roster = result.value
    this.set({
      status: 'ready',
      error: null,
      writable: roster.writable,
      rows: roster.presets,
      defaultId: roster.default,
    })
  }

  /**
   * Open one preset in the editor.
   * @param id - the preset to edit.
   */
  select(id: string): void {
    const state = this.store.getSnapshot()
    if (state.draft?.dirty === true && state.draft.id !== id) {
      this.set({ pendingSwitch: id })
      return
    }
    this.open(id)
  }

  /** Seed the editor from the roster row. */
  private open(id: string): void {
    const state = this.store.getSnapshot()
    const row = state.rows.find(entry => entry.promptPreset === id)
    if (row === undefined) return
    this.set({
      selectedId: id,
      pendingSwitch: null,
      saveError: null,
      draft: {
        id,
        name: row.name,
        description: row.description ?? '',
        rules: row.rules.map(rule => ({ key: mintRuleKey(), rule })),
        revision: undefined,
        dirty: false,
      },
      preview: EMPTY_PREVIEW,
    })
    this.schedulePreview({ immediate: true })
  }

  /** Discard the open draft and follow through on a blocked switch. */
  confirmSwitch(): void {
    const target = this.store.getSnapshot().pendingSwitch
    if (target === null) return
    this.open(target)
  }

  /** Keep editing after a blocked switch. */
  cancelSwitch(): void {
    this.set({ pendingSwitch: null })
  }

  /** Patch the open draft and mark it edited. */
  private patchDraft(patch: Partial<PresetDraft>, redraw = true): void {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    this.set({ draft: { ...draft, ...patch, dirty: true }, saveError: null })
    if (redraw) this.schedulePreview()
  }

  /**
   * Rename the open preset.
   * @param name - the new display name.
   */
  setName(name: string): void {
    this.patchDraft({ name }, false)
  }

  /**
   * Redescribe the open preset.
   * @param description - the new one-sentence description.
   */
  setDescription(description: string): void {
    this.patchDraft({ description }, false)
  }

  /**
   * Append one rule of the chosen kind.
   * @param kind - the rule kind to add.
   */
  addRule(kind: PromptRuleKind): void {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    this.patchDraft({ rules: [...draft.rules, { key: mintRuleKey(), rule: emptyRule(kind) }] })
  }

  /**
   * Remove one rule.
   * @param key - the editor key of the rule to remove.
   */
  removeRule(key: string): void {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    this.patchDraft({ rules: draft.rules.filter(entry => entry.key !== key) })
  }

  /**
   * Move one rule up or down its stack.
   * @param key - the editor key of the rule to move.
   * @param direction - -1 for earlier, 1 for later.
   */
  moveRule(key: string, direction: -1 | 1): void {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    const index = draft.rules.findIndex(entry => entry.key === key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= draft.rules.length) return
    const rules = [...draft.rules]
    const [moved] = rules.splice(index, 1)
    // The splice above removed exactly the entry `index` addressed.
    rules.splice(target, 0, moved as (typeof rules)[number])
    this.patchDraft({ rules })
  }

  /**
   * Replace one rule's own fields.
   * @param key - the editor key of the rule to change.
   * @param rule - the rule as it now stands.
   */
  patchRule(key: string, rule: PromptRule): void {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    this.patchDraft({
      rules: draft.rules.map(entry => entry.key === key ? { key, rule } : entry),
    })
  }

  /**
   * Turn one rule on or off without deleting it.
   * @param key - the editor key of the rule to toggle.
   * @param enabled - whether it should participate.
   */
  setRuleEnabled(key: string, enabled: boolean): void {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    const entry = draft.rules.find(rule => rule.key === key)
    if (entry === undefined) return
    this.patchRule(key, { ...entry.rule, enabled })
  }

  /**
   * Persist the open draft.
   * @returns when the write and the re-read have settled.
   */
  async save(): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.draft
    if (draft === null || !draft.dirty || state.saving) return
    if (draftBlocker(draft) !== undefined) return
    this.set({ saving: true, saveError: null })
    const result = await this.ctx.remote.promptPresets.update(
      draft.id,
      {
        name: draft.name,
        ...draft.description === '' ? {} : { description: draft.description },
        // Sent as written: `draftBlocker` above refuses a save while any
        // enabled rule is unusable, so nothing here needs disabling.
        rules: draft.rules.map(entry => entry.rule),
      },
      draft.revision,
    )
    if (!result.ok) {
      this.set({ saving: false, saveError: result.error.message })
      return
    }
    this.set({ saving: false, draft: { ...draft, dirty: false } })
    await this.load()
    this.rosterChanged()
  }

  /** Throw away the open draft and re-seed it from the roster. */
  discard(): void {
    const id = this.store.getSnapshot().selectedId
    if (id === null) return
    this.open(id)
  }

  /** Open the create dialog. */
  beginCreate(): void {
    this.set({ create: { id: '', name: '', saving: false, error: null } })
  }

  /** Close the create dialog. */
  cancelCreate(): void {
    this.set({ create: null })
  }

  /**
   * Edit the create dialog's fields.
   * @param patch - the fields a person changed.
   */
  patchCreate(patch: Partial<Pick<CreateDraft, 'id' | 'name'>>): void {
    const create = this.store.getSnapshot().create
    if (create === null) return
    this.set({ create: { ...create, ...patch, error: null } })
  }

  /**
   * The complaint blocking the create dialog, when there is one.
   * @returns the blocker, or undefined while the staged id is usable.
   */
  createBlocker(): Blocker | undefined {
    const state = this.store.getSnapshot()
    if (state.create === null) return undefined
    return idBlocker(state.create.id, state.rows.map(row => row.promptPreset))
  }

  /**
   * Store the staged new preset and open it.
   * @returns when the write, the re-read, and the editor seeding have settled.
   */
  async confirmCreate(): Promise<void> {
    const state = this.store.getSnapshot()
    const create = state.create
    if (create === null || create.saving) return
    if (this.createBlocker() !== undefined) return
    this.set({ create: { ...create, saving: true, error: null } })
    const result = await this.ctx.remote.promptPresets.create(create.id, {
      name: create.name === '' ? create.id : create.name,
      rules: [],
    })
    if (!result.ok) {
      this.set({ create: { ...create, saving: false, error: result.error.message } })
      return
    }
    this.set({ create: null })
    await this.load()
    this.rosterChanged()
    this.open(create.id)
  }

  /**
   * Ask before deleting, or clear the question.
   * @param id - the preset to delete, or null to cancel.
   */
  confirmDelete(id: string | null): void {
    this.set({ pendingDelete: id })
  }

  /**
   * Delete the preset the confirmation names.
   * @returns when the write and the re-read have settled.
   */
  async remove(): Promise<void> {
    const state = this.store.getSnapshot()
    const id = state.pendingDelete
    if (id === null || state.deleting) return
    this.set({ deleting: true })
    const result = await this.ctx.remote.promptPresets.deletePreset(id)
    if (!result.ok) {
      this.set({ deleting: false, pendingDelete: null, error: result.error.message })
      return
    }
    const closing = state.selectedId === id
    this.set({
      deleting: false,
      pendingDelete: null,
      ...closing ? { selectedId: null, draft: null, preview: EMPTY_PREVIEW } : {},
    })
    await this.load()
    this.rosterChanged()
  }

  /**
   * Make one preset the default for tasks that name none.
   * @param id - the preset to make default, or `''` to clear it.
   * @returns when the write and the re-read have settled.
   */
  async setDefault(id: string): Promise<void> {
    if (this.store.getSnapshot().busy) return
    this.set({ busy: true })
    const result = await this.ctx.remote.promptPresets.setDefault(id)
    this.set({ busy: false, ...result.ok ? {} : { error: result.error.message } })
    if (!result.ok) return
    await this.load()
    this.rosterChanged()
  }

  /** Redraw the preview now, ignoring the debounce. */
  refreshPreview(): void {
    this.schedulePreview({ immediate: true })
  }

  /** Queue a preview redraw. */
  private schedulePreview(options: { immediate?: boolean } = {}): void {
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer)
    const run = (): void => { void this.runPreview() }
    if (options.immediate === true) {
      run()
      return
    }
    this.previewTimer = setTimeout(run, PREVIEW_DEBOUNCE_MS)
  }

  /** Ask the Host what the open draft would produce. */
  private async runPreview(): Promise<void> {
    const generation = ++this.previewGeneration
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    const session = this.previewSession
    if (session === undefined) {
      this.setPreview({ ...EMPTY_PREVIEW, status: 'ready' })
      return
    }
    this.setPreview({ status: 'loading', error: null })
    // The draft as it stands, not the stored preset, so an unsaved edit is what
    // the person sees.
    const result = await this.ctx.remote.promptPresets.preview(
      session,
      { name: draft.name, rules: wireRules(draft) },
    )
    if (generation !== this.previewGeneration) return
    if (!result.ok) {
      this.setPreview({ status: 'error', error: result.error.message })
      return
    }
    this.setPreview({
      status: 'ready',
      error: null,
      sections: result.value.sections,
      prompt: result.value.prompt,
      baseline: result.value.baselineSections,
      baselinePrompt: result.value.baselinePrompt,
      warnings: result.value.warnings,
    })
  }

  /** Stop the pending preview redraw, so nothing fires after teardown. */
  dispose(): void {
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer)
    this.previewTimer = undefined
  }
}
