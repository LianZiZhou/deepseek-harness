/**
 * Prompt presets: the user's own ordered transforms over the system prompt a
 * session assembles, selectable per session and switchable at any point in it.
 *
 * The transform is registered as the prompt registry's single final override
 * ({@link SystemPrompt.finalize}), which runs after the assembly waterfall,
 * after a `complete: true` section has been restored, and after runtime-context
 * suppression. That is what makes a user's choice decisive rather than
 * dependent on which plugin registered a listener last: nothing the registry
 * admits can change the prompt after this package has.
 *
 * Which preset a session runs is read from its durable `promptPreset`
 * projection on every assembly, never from a cached per-agent value, so a
 * resumed or forked session rebuilds the same override with no seeding code.
 * @module @deepseek-ai/dsh-prompt-presets
 */

import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { AssembledSection, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session-projection'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
// Type-only: declaration-merges the optional `ctx.commands` child.
import type {} from '@deepseek-ai/dsh-commands'
// Type-only: the Loader's Fiber.entry and `loader/volatile-update` merges.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { applyRules, errorText, ruleSectionName } from './rules.ts'
import type { PromptPreset, PromptRule } from './rules.ts'
import {
  PRESET_ID,
  PromptPresetSchema,
  presetViolation,
  validatePresetSettings,
} from './schema.ts'
import type { PresetLimits, PromptPresetSettings } from './schema.ts'
import { promptPresetProjectionDefinition } from './session.ts'
import type {
  PromptPresetInput,
  PromptPresetLimits,
  PromptPresetPreview,
  PromptPresetPreviewSection,
  PromptPresetRoster,
  PromptPresetRow,
  PromptPresetWarning,
} from './types.ts'

export * from './rules.ts'
export * from './types.ts'
export { PRESET_ID, PromptPresetSchema } from './schema.ts'
export { promptPresetProjectionDefinition } from './session.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptPresets: PromptPresetStore
  }
}

/**
 * A short, stable digest of one rendered prompt.
 * @param text - the prompt text.
 * @returns its digest, so a session retains no prompt text between steps.
 */
function digest(text: string): string {
  return createHash('sha256').update(text).digest('base64')
}

/**
 * The profile entry id this package is composed under in the shipped bundles.
 *
 * Stored presets are this entry's own Config, and a form write names the entry
 * it edits; the running instance reads its real id from its Loader entry and
 * falls back to this one only when it was mounted without a Loader.
 */
export const SETTINGS_NAMESPACE = 'prompt-presets'

/** Sections that state a rule the executor enforces, not prose a user may drop. */
const PROTECTED_SECTIONS = ['tools:ptc-only', 'tool:structured_output']

/**
 * Deployment configuration for the prompt-preset roster.
 *
 * Every field is required and defaulted by {@link PromptPresetStore.Config}, so
 * the resolved entry is the one place a default is decided and no read below
 * restates one.
 */
export interface Config {
  /**
   * Every stored preset, keyed by id. Volatile: an edit from the settings page
   * lands in the profile patch and reaches this reference without a remount,
   * so a session's next step renders under it.
   */
  presets: Volatile<Record<string, PromptPreset>>
  /** Preset stamped into blank sessions; `''` means none. Volatile, as above. */
  default: Volatile<string>
  /** Sections a `replace` keeps and a `remove` may not name. */
  protectedSections: string[]
  /** Most presets one deployment stores. */
  maxPresets: number
  /** Most rules one preset carries. */
  maxRules: number
  /** Longest accepted regular-expression source. */
  maxPatternLength: number
  /** Largest accepted rule text, in UTF-8 bytes. */
  maxTextBytes: number
}

/** The preset a session runs, resolved against the stored roster. */
interface ResolvedPreset {
  readonly id: string
  readonly preset: PromptPreset
}

/**
 * Store of the user's prompt presets, and the prompt registry's final override.
 *
 * It owns one data set with create, read, update, delete, and selection; it
 * neither arbitrates providers nor executes work, so `Store` is the honest
 * role. The override it installs is global and unscoped: per-session behavior
 * comes from reading each assembly's own session, which covers agents created
 * before this plugin loaded and needs no per-agent bookkeeping.
 */
export default class PromptPresetStore extends TypertRemoteService {
  // `settings` is optional: without it presets still apply, they just cannot be edited here.
  static inject = ['systemPrompt', 'sessionProjections', 'sessions']

  // Inline schema call: the config catalog walks `static Config` statically.
  static Config = z.object({
    presets: z.dict(PromptPresetSchema).default({}).volatile(),
    default: z.string().default('').volatile(),
    protectedSections: z.array(z.string()).default(PROTECTED_SECTIONS),
    maxPresets: z.natural().default(64),
    maxRules: z.natural().default(32),
    maxPatternLength: z.natural().default(512),
    maxTextBytes: z.natural().default(16384),
  })

  /** Bounds and protections every stored preset is judged against. */
  private readonly limits: PresetLimits

  /** The Loader entry this instance's Config belongs to, and that writes name. */
  private readonly entryId: string

  /**
   * The service's own untraced context. Methods reached through the traceable
   * proxy see `this.ctx` rebound to the caller's context; the projection and
   * prompt reads below must resolve through this service's own fiber.
   */
  private readonly selfCtx: Context

  /** Apply-time warnings already logged, so one bad rule warns once per session. */
  private readonly warned = new Set<string>()

  /** One queued selection per session, so a write and its log append stay paired. */
  private readonly switches = new Map<string, Promise<unknown>>()

  /**
   * Digests of the prompts this override produced for one session since its
   * last committed `system/message`, so the committed text can be checked
   * against what this package actually returned.
   */
  private readonly produced = new Map<string, Set<string>>()

  /** Sessions already reported as diverging, so one mismatch warns once. */
  private readonly diverged = new Set<string>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'promptPresets')
    this.selfCtx = ctx
    this.limits = {
      protectedSections: config.protectedSections,
      maxPatternLength: config.maxPatternLength,
      maxPresets: config.maxPresets,
      maxRules: config.maxRules,
      maxTextBytes: config.maxTextBytes,
    }
    // `options.id`, not `id`: the latter is qualified by the Include that owns
    // the row, while the settings forms and the profile patch name the row itself.
    this.entryId = ctx.fiber.entry?.options.id ?? SETTINGS_NAMESPACE
    // This package renders its own editor, so the settings page must not also
    // generate a raw form for the same two fields.
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    ctx.on('loader/volatile-update', () => {
      this.audit()
      ctx.emit('prompt-preset/changed')
    })
    this.audit()
    // The front-door-neutral control: every interactive surface that dispatches
    // the command registry — the Web composer and terminal front doors alike —
    // gets it without shipping its own picker. Not `/preset`: terminal front
    // doors already use that name for agent presets, and a registry command
    // would shadow theirs.
    ctx.inject(['commands'], (child) => {
      child.commands.register({
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-prompt-presets'),
        name: 'prompt-preset',
        description: 'Show or switch this session\'s prompt preset',
        input: { hint: '<preset> | off | default <preset|off>' },
        handler: ({ agent, rawInput }) => this.command(agent, rawInput),
      })
    })

    ctx.sessionProjections.register(promptPresetProjectionDefinition)
    ctx.systemPrompt.finalize((assembly, context) => this.finalize(assembly, context))

    ctx.on('agent/created', ({ agent }) => { this.stampInitial(agent) })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'system/message') {
        this.checkCommitted(session.id, event.data.message.content)
        return
      }
      if (event.type !== 'prompt-preset/selected') return
      ctx.emit('prompt-preset/selected', session.id, event.data.promptPreset)
    })
  }

  /**
   * Replace an assembly's sections with what the session's preset produces.
   *
   * The whole preset is discarded for one assembly when applying it would make
   * `renderPrompt` throw, because a rendering failure fails the turn and a
   * stored document must never be able to do that. Everything else is a
   * contained warning: the remaining rules still apply.
   */
  private finalize(
    assembly: PromptAssembly,
    context: { agent?: Agent; preview?: boolean; promptPresetOverride?: { preset: PromptPreset | null } },
  ): PromptAssembly {
    const override = context.promptPresetOverride
    const resolved = override !== undefined
      ? (override.preset === null ? null : { id: '', preset: override.preset })
      : this.presetForAgent(context.agent)
    if (resolved === null) return assembly
    const { sections, warnings } = applyRules(assembly.sections, resolved.preset, this.limits)
    const next: PromptAssembly = { ...assembly, sections }
    let rendered: string
    try {
      rendered = renderPrompt(next)
    } catch (error) {
      this.warn(context.agent, resolved.id, { code: 'render-failed', detail: errorText(error) })
      return assembly
    }
    for (const warning of warnings) this.warn(context.agent, resolved.id, warning)
    if (context.preview !== true) this.record(context.agent, rendered)
    return next
  }

  /**
   * Remember what this override produced for a live step.
   *
   * A preview runs the same pipeline on the same agent, so only the assembly's
   * own `preview` marker separates a what-if from a step that will commit.
   * @param agent - the agent whose step assembled, when one did.
   * @param prompt - the text this override returned, already rendered.
   */
  private record(agent: Agent | undefined, prompt: string): void {
    if (agent === undefined) return
    const key = String(agent.session.id)
    const digests = this.produced.get(key) ?? new Set<string>()
    digests.add(digest(prompt))
    this.produced.set(key, digests)
  }

  /**
   * Check one committed system prompt against what this override produced.
   *
   * This is the end-to-end reading of the guarantee the final override makes:
   * the committed text travels through `renderPrompt`, the surface projection,
   * and the session log, so agreeing with it is an observation this package
   * did not make itself. A divergence means something downstream rewrote the
   * prompt after the override spoke, which the override alone cannot see. It
   * warns and never interrupts: the step has already run, and failing the turn
   * over a reporting mismatch would be worse than the mismatch.
   *
   * A session running several agents can commit one step's prompt while
   * another is mid-assembly, so a committed text is a divergence only when it
   * matches none of the prompts produced since the last commit.
   * @param sessionId - the session that committed the message.
   * @param content - the committed system message content.
   */
  private checkCommitted(sessionId: string, content: readonly { type: string; text?: string }[]): void {
    const digests = this.produced.get(sessionId)
    if (digests === undefined) return
    this.produced.delete(sessionId)
    const committed = content
      .filter((part): part is { type: string; text: string } => typeof part.text === 'string')
      .map(part => part.text)
      .join('')
    if (digests.has(digest(committed)) || this.diverged.has(sessionId)) return
    this.diverged.add(sessionId)
    this.selfCtx.logger.warn(
      'prompt presets: the committed system prompt differs from the one this override returned; '
      + 'something rewrote it after the final override ran. The step was not interrupted.',
    )
  }

  /** The preset one agent's session runs, or null when it overrides nothing. */
  private presetForAgent(agent: Agent | undefined): ResolvedPreset | null {
    if (agent === undefined) return null
    const id = this.selfCtx.sessionProjections.stateOf(agent.session, 'promptPreset')
    if (id === undefined || id === null || id === '') return null
    const preset = this.stored().presets[id]
    if (preset === undefined) {
      this.warn(agent, id, { code: 'unknown-preset' })
      return null
    }
    return { id, preset }
  }

  /** Log one apply-time warning once per session, preset, code, and rule. */
  private warn(agent: Agent | undefined, id: string, warning: PromptPresetWarning): void {
    const key = `${agent?.id ?? ''}|${id}|${warning.code}|${String(warning.rule ?? '')}`
    if (this.warned.has(key)) return
    this.warned.add(key)
    const at = warning.rule === undefined ? '' : ` rule ${warning.rule}`
    const about = warning.section === undefined ? '' : ` section ${JSON.stringify(warning.section)}`
    const detail = warning.detail === undefined ? '' : `: ${warning.detail}`
    this.selfCtx.logger.warn(
      `prompt preset ${JSON.stringify(id)}${at}${about}: ${warning.code}${detail}`,
    )
  }

  /**
   * Stamp a session that has produced nothing with the preset it should run:
   * its delegating parent's for a subagent child, the deployment's default
   * otherwise.
   *
   * Applied and logged are the same operation here: the preset reaches the
   * model only through a recorded selection, so a resumed session rebuilds it
   * from the log rather than from whatever the default happens to be later.
   * That is also what makes a child reconstructable — without the stamp, a
   * cold read of it resolves the deployment default and rebuilds its turns
   * under a prompt the child never actually ran.
   */
  private stampInitial(agent: Agent): void {
    try {
      const current = this.selfCtx.sessionProjections.stateOf(agent.session, 'promptPreset')
      if (current !== null && current !== undefined) return
      const boundary = this.selfCtx.sessionProjections.stateOf(agent.session, 'turnBoundary')
      if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) return
      const stored = this.stored()
      const wanted = this.inheritedPreset(agent) ?? stored.default
      if (wanted === '' || !(wanted in stored.presets)) return
      agent.session.append('prompt-preset/selected', { promptPreset: wanted })
    } catch (error) {
      // A throw here would veto the agent's publication, and a session that
      // cannot start is a worse outcome than one that starts with no override.
      this.selfCtx.logger.warn(`prompt-presets: could not stamp the initial preset: ${errorText(error)}`)
    }
  }

  /**
   * The preset a delegating parent was running, for a subagent child to adopt.
   *
   * A child assembles its own prompt from its own session, so without this it
   * would silently fall back to the deployment default however deliberately
   * its parent was steered. The read is gated on `origin: 'subagent'`: a fork
   * also carries `parentSession`, but it inherits the parent's log prefix and
   * therefore already replays the selection, which the caller's own check for
   * an existing value catches first.
   *
   * A parent that selected nothing yields `undefined`, not `''`, so the
   * deployment default still applies to the child exactly as it would to any
   * other blank session.
   * @param agent - the freshly created agent.
   * @returns the parent's preset id, or undefined when there is nothing to adopt.
   */
  private inheritedPreset(agent: Agent): string | undefined {
    const header = agent.session.header
    if (header.origin !== 'subagent' || header.parentSession === undefined) return undefined
    const parent = this.selfCtx.sessions.get(header.parentSession)
    if (parent === undefined) return undefined
    const inherited = this.selfCtx.sessionProjections.stateOf(parent, 'promptPreset')
    return inherited === null || inherited === undefined || inherited === '' ? undefined : inherited
  }

  /** The roster as a client reads it. */
  private roster(): PromptPresetRoster {
    const value = this.stored()
    const deployment = this.deploymentIds()
    const limits: PromptPresetLimits = {
      maxPresets: this.limits.maxPresets,
      maxRules: this.limits.maxRules,
      maxPatternLength: this.limits.maxPatternLength,
      maxTextBytes: this.limits.maxTextBytes,
    }
    const presets: PromptPresetRow[] = Object.entries(value.presets)
      .map(([id, preset]) => this.rowFor(id, preset, value.default, deployment))
      .sort((a, b) => rosterRank(a) - rosterRank(b) || a.promptPreset.localeCompare(b.promptPreset))
    return {
      presets,
      default: value.default,
      revision: this.revision(),
      writable: this.selfCtx.get('settings') !== undefined,
      limits,
      protectedSections: this.limits.protectedSections,
    }
  }

  /** One stored preset as a client reads it. */
  private rowFor(
    id: string,
    preset: PromptPreset,
    defaultId: string,
    deployment: ReadonlySet<string>,
  ): PromptPresetRow {
    return {
      promptPreset: id,
      name: preset.name,
      ...preset.description === undefined ? {} : { description: preset.description },
      rules: preset.rules,
      source: deployment.has(id) ? 'deployment' : 'user',
      isDefault: defaultId === id,
    }
  }

  /** The entry revision a caller sends back as `expectedRevision`. */
  private revision(): number {
    return this.descriptor()?.revision ?? 0
  }

  /**
   * This entry's settings form, when the deployment composes a settings service.
   *
   * Without one the store still reads and applies presets, it just cannot
   * write them, which the roster reports as `writable: false`.
   */
  private descriptor(): SettingsDescriptor | undefined {
    return this.selfCtx.get('settings')?.describe().find(entry => entry.ns === this.entryId)
  }

  /**
   * Ids the bundles supply, as opposed to ones this profile stored.
   *
   * Read from the inherited layer rather than from the live value: a write
   * pins the whole map into the profile, so after one edit every id is present
   * there, and only the inherited layer still says which ones shipped.
   */
  private deploymentIds(): ReadonlySet<string> {
    const base = this.descriptor()?.base as { presets?: Record<string, unknown> } | undefined
    return new Set(Object.keys(base?.presets ?? {}))
  }

  /**
   * The stored document, captured for one operation. Both fields are defaulted
   * by the schema, so neither reference can hold an absent value.
   */
  private stored(): PromptPresetSettings {
    return {
      presets: this.config.presets.get(),
      default: this.config.default.get(),
    }
  }

  /**
   * Report a stored document the write path would have refused.
   *
   * Writes from the editor are checked before they land, but the profile patch
   * is also a file a person can edit by hand, and the Loader validates only its
   * shape. Apply time already contains every rule that cannot run, so this is
   * a warning rather than a refusal: the session keeps working either way.
   */
  private audit(): void {
    try {
      validatePresetSettings(this.stored(), this.limits)
    } catch (error) {
      this.selfCtx.logger.warn(`prompt-presets: the stored presets fail validation: ${errorText(error)}`)
    }
  }

  /**
   * Every stored preset plus the effective default and this deployment's bounds.
   * @returns the roster one editor or picker reads in a single call.
   */
  @Remote('list')
  list(): PromptPresetRoster {
    return this.roster()
  }

  /**
   * Store a new preset under an unused id.
   * @param promptPreset - the id to create, matching {@link PRESET_ID}.
   * @param document - the preset's writable half.
   * @returns the stored row.
   * @throws {RemoteError} `prompt-preset/invalid`, `prompt-preset/exists`, or `prompt-preset/conflict`.
   */
  @Remote('create')
  async create(promptPreset: string, document: PromptPresetInput): Promise<PromptPresetRow> {
    this.checkId(promptPreset)
    if (promptPreset in this.stored().presets) {
      throw new RemoteError('prompt-preset/exists', `prompt preset "${promptPreset}" already exists`, { promptPreset })
    }
    const stored = this.checkDocument(promptPreset, document)
    const count = Object.keys(this.stored().presets).length
    if (count >= this.limits.maxPresets) {
      throw new RemoteError(
        'prompt-preset/invalid',
        `this deployment stores at most ${this.limits.maxPresets} prompt presets`,
        { promptPreset, reason: 'roster is full' },
      )
    }
    await this.write(promptPreset, [{ op: 'set', path: ['presets', promptPreset], value: stored }], undefined)
    return this.rowOf(promptPreset)
  }

  /**
   * Replace one stored preset's document wholesale.
   * @param promptPreset - the id to update.
   * @param document - the preset's writable half.
   * @param expectedRevision - the roster `revision` the caller read, when fencing.
   * @returns the stored row.
   * @throws {RemoteError} `prompt-preset/not-found`, `prompt-preset/invalid`, or `prompt-preset/conflict`.
   */
  @Remote('update')
  async update(
    promptPreset: string,
    document: PromptPresetInput,
    expectedRevision?: number,
  ): Promise<PromptPresetRow> {
    this.checkId(promptPreset)
    this.checkExists(promptPreset)
    const stored = this.checkDocument(promptPreset, document)
    await this.write(promptPreset, [{ op: 'set', path: ['presets', promptPreset], value: stored }], expectedRevision)
    return this.rowOf(promptPreset)
  }

  /**
   * Delete one locally stored preset, clearing a default that named it.
   * @param promptPreset - the id to delete.
   * @throws {RemoteError} `prompt-preset/not-found`, `prompt-preset/read-only`, or `prompt-preset/conflict`.
   */
  @Remote('deletePreset')
  async deletePreset(promptPreset: string): Promise<void> {
    this.checkId(promptPreset)
    this.checkExists(promptPreset)
    if (this.deploymentIds().has(promptPreset)) {
      throw new RemoteError(
        'prompt-preset/read-only',
        `prompt preset "${promptPreset}" comes from this deployment's composition`,
        { promptPreset },
      )
    }
    // One write, so the roster is never momentarily pointing at a deleted id.
    const ops = [
      { op: 'unset' as const, path: ['presets', promptPreset] },
      ...this.stored().default === promptPreset
        ? [{ op: 'set' as const, path: ['default'], value: '' }]
        : [],
    ]
    await this.write(promptPreset, ops, undefined)
  }

  /**
   * Choose the preset sessions that name none will use.
   * @param promptPreset - the id to make default; `''` clears it.
   * @throws {RemoteError} `prompt-preset/not-found` or `prompt-preset/conflict`.
   */
  @Remote('setDefault')
  async setDefault(promptPreset: string): Promise<void> {
    if (promptPreset !== '') {
      this.checkId(promptPreset)
      this.checkExists(promptPreset)
    }
    await this.write(promptPreset, [{ op: 'set', path: ['default'], value: promptPreset }], undefined)
  }

  /**
   * Switch one session's prompt preset, at any point in that session.
   *
   * There is no blank-session lock: an agent preset is locked because swapping
   * tools would strand logged tool calls, while the system prompt is a
   * replaceable surface node the next step re-renders.
   * @param agent - the session's live agent, resolved from the wire identity.
   * @param promptPreset - the preset to run, or `null` to override nothing.
   * @returns the preset recorded, or `null`.
   * @throws {RemoteError} `prompt-preset/not-found` when the roster has no such id.
   */
  @Remote('select')
  async select(agent: Agent, promptPreset: string | null): Promise<string | null> {
    if (promptPreset !== null) {
      this.checkId(promptPreset)
      this.checkExists(promptPreset)
    }
    const queued = this.switches.get(agent.id) ?? Promise.resolve()
    const turn = queued.then(() => this.swap(agent, promptPreset))
    const guard = turn.catch(() => undefined)
    this.switches.set(agent.id, guard)
    try {
      return await turn
    } finally {
      if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id)
    }
  }

  /**
   * Run one `/prompt-preset` line against the receiving session.
   *
   * Bare, it reports; `<preset>` and `off` switch the session exactly as
   * {@link select} does; `default <preset|off>` changes the deployment default
   * through the same write path as the editor, so it refuses the same way
   * without a settings service. `off` and `default` are keywords here, so a
   * preset stored under either id is reachable only through the Remote API.
   * No text repeats the command's own name: surfaces render `name · text`.
   * @param agent - the receiving agent.
   * @param rawInput - everything after the command name.
   * @returns the settled outcome.
   */
  private async command(agent: Agent, rawInput: string): Promise<CommandResult> {
    const [verb, target, ...extra] = rawInput.trim().split(/\s+/).filter(word => word !== '')
    const stored = this.stored()
    const ids = Object.keys(stored.presets)
    const roster = ids.length === 0 ? 'none stored' : `available: ${ids.join(', ')}`
    const unknown = (id: string): CommandResult => ({ kind: 'error', text: `unknown preset "${id}" (${roster})` })
    if (verb === undefined) {
      const current = this.selfCtx.sessionProjections.stateOf(agent.session, 'promptPreset') ?? ''
      return { kind: 'success', text: `current ${current || 'off'}, default ${stored.default || 'off'} (${roster})` }
    }
    if (verb === 'default') {
      if (target === undefined || extra.length > 0) return usage()
      const id = target === 'off' ? '' : target
      if (id !== '' && !(id in stored.presets)) return unknown(id)
      try {
        await this.setDefault(id)
      } catch (error) {
        // A read-only deployment is an expected refusal, not a failed handler.
        if (error instanceof RemoteError) return { kind: 'error', text: error.message }
        throw error
      }
      return { kind: 'success', text: `default ${target}, for new sessions` }
    }
    if (target !== undefined) return usage()
    if (verb === 'off') {
      await this.select(agent, null)
      return { kind: 'success', text: 'off, from the next step' }
    }
    if (!(verb in stored.presets)) return unknown(verb)
    await this.select(agent, verb)
    return { kind: 'success', text: `${verb}, from the next step` }
  }

  /** One queued switch: re-check the roster, then record what the session runs. */
  private async swap(agent: Agent, promptPreset: string | null): Promise<string | null> {
    await Promise.resolve()
    if (promptPreset !== null) this.checkExists(promptPreset)
    const current = this.selfCtx.sessionProjections.stateOf(agent.session, 'promptPreset') ?? null
    if (current === promptPreset) return promptPreset
    agent.session.append('prompt-preset/selected', { promptPreset })
    return promptPreset
  }

  /**
   * What one candidate preset would produce for one live session.
   *
   * It runs the real assembly for that agent's own scope, so the preview shows
   * the same sections, tool guidance, and resolved variables a step would, and
   * marks the assembly `preview` so no listener records a route from it.
   * The candidate is a document rather than a stored id, so an editor previews
   * the draft in front of the person instead of making them save first.
   * @param agent - the session whose composition to preview against.
   * @param document - the candidate, or `null` for the untransformed prompt.
   * @param signal - cancels between the candidate and baseline assemblies.
   * @returns the rendered sections, the final prompt, and the baseline to compare.
   */
  @Remote('preview')
  async preview(
    agent: Agent,
    document: PromptPresetInput | null,
    signal: AbortSignal,
  ): Promise<PromptPresetPreview> {
    // No validation: every way a rule can fail is already contained in
    // `applyRules` and reported as a warning, and a draft mid-edit is exactly
    // what this call exists to show.
    const preset: PromptPreset | null = document === null
      ? null
      : { name: document.name, rules: document.rules }
    const base = assembleContextFor(agent)
    const warnings: PromptPresetWarning[] = []
    const baseline = await this.selfCtx.systemPrompt.assemble({
      ...base,
      preview: true,
      promptPresetOverride: { preset: null },
    })
    signal.throwIfAborted()
    let candidate = baseline
    if (preset !== null) {
      candidate = await this.selfCtx.systemPrompt.assemble({
        ...base,
        preview: true,
        promptPresetOverride: { preset },
      })
      warnings.push(...applyRules(baseline.sections, preset, this.limits).warnings)
      // A baseline of exactly one section that the candidate did not keep is a
      // `complete: true` contribution the rules replaced.
      const [only] = baseline.sections
      if (only !== undefined && baseline.sections.length === 1 && candidate.sections.length !== 1) {
        warnings.push({ code: 'complete-section-overridden', section: only.name })
      }
    }
    const prompt = renderPrompt(candidate)
    if (prompt.length === 0) warnings.push({ code: 'empty-prompt' })
    return {
      sections: candidate.sections.map(section => this.previewSection(section, candidate)),
      prompt,
      baselineSections: baseline.sections.map(section => this.previewSection(section, baseline)),
      baselinePrompt: renderPrompt(baseline),
      warnings,
    }
  }

  /** One assembled section as the preview shows it: rendered, attributed, marked. */
  private previewSection(section: AssembledSection, assembly: PromptAssembly): PromptPresetPreviewSection {
    const fromRule = ruleIndexOf(section.name)
    return {
      name: section.name,
      text: renderPrompt({ ...assembly, sections: [section] }),
      ...fromRule === undefined ? {} : { fromRule },
      ...this.limits.protectedSections.includes(section.name) ? { protectedSection: true as const } : {},
    }
  }

  /** Refuse an id the storage key grammar does not accept. */
  private checkId(promptPreset: string): void {
    if (PRESET_ID.test(promptPreset)) return
    throw new RemoteError(
      'prompt-preset/invalid',
      `prompt preset id "${promptPreset}" must match ${String(PRESET_ID)}`,
      { promptPreset, reason: 'invalid id' },
    )
  }

  /** Refuse an id the roster does not supply. */
  private checkExists(promptPreset: string): void {
    this.requirePreset(promptPreset)
  }

  /** Resolve one stored preset, or refuse. */
  private requirePreset(promptPreset: string): PromptPreset {
    const preset = this.stored().presets[promptPreset]
    if (preset !== undefined) return preset
    throw new RemoteError(
      'prompt-preset/not-found',
      `no prompt preset "${promptPreset}" is stored`,
      { promptPreset, available: Object.keys(this.stored().presets) },
    )
  }

  /** Refuse a document this deployment's bounds and protections reject. */
  private checkDocument(promptPreset: string, document: PromptPresetInput): PromptPreset {
    const stored: PromptPreset = {
      name: document.name,
      ...document.description === undefined ? {} : { description: document.description },
      rules: document.rules,
    }
    const violation = presetViolation(stored, this.limits)
    if (violation === undefined) return stored
    throw new RemoteError(
      'prompt-preset/invalid',
      `prompt preset "${promptPreset}" is unusable: ${violation.reason}`,
      {
        promptPreset,
        ...violation.rule === undefined ? {} : { rule: violation.rule },
        reason: violation.reason,
      },
    )
  }

  /** Persist one edit, classifying a stale-revision refusal. */
  private async write(
    promptPreset: string,
    ops: readonly SettingsPathOp[],
    expectedRevision: number | undefined,
  ): Promise<void> {
    const settings = this.selfCtx.get('settings')
    if (settings === undefined) {
      throw new RemoteError(
        'prompt-preset/read-only',
        'this deployment composes no settings service, so prompt presets cannot be edited here',
        { promptPreset },
      )
    }
    try {
      await settings.mutate(this.entryId, ops, expectedRevision)
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        throw new RemoteError(
          'prompt-preset/conflict',
          `prompt preset "${promptPreset}" changed since it was read`,
          { promptPreset, revision: this.revision() },
          { cause: error },
        )
      }
      throw error
    }
  }

  /**
   * The row a completed write produced.
   * @throws {RemoteError} `prompt-preset/not-found` if the write did not land.
   */
  private rowOf(promptPreset: string): PromptPresetRow {
    return this.rowFor(promptPreset, this.requirePreset(promptPreset), this.stored().default, this.deploymentIds())
  }
}

/** The refusal for a `/prompt-preset` line its grammar does not accept. */
function usage(): CommandResult {
  return { kind: 'error', text: 'usage: [<preset> | off | default <preset|off>]' }
}

/** Deployment rows sort ahead of the user's own. */
function rosterRank(row: PromptPresetRow): number {
  return row.source === 'deployment' ? 0 : 1
}

/** The rule index a created section's name records, when it records one. */
function ruleIndexOf(name: string): number | undefined {
  for (const kind of ['prepend', 'append', 'replace'] as const) {
    const prefix = ruleSectionName(kind, 0).slice(0, -1)
    if (!name.startsWith(prefix)) continue
    const index = Number(name.slice(prefix.length))
    if (Number.isInteger(index)) return index
  }
  return undefined
}


export type { PromptRule, PromptPreset }
