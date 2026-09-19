/**
 * The editor's refusals and the Host's refusals: every action is safe to call
 * with nothing open, and every write that comes back refused leaves the page
 * saying so rather than pretending it landed.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptPresetInput, PromptPresetRoster } from '@deepseek-ai/dsh-prompt-presets/types'
import { PromptPresetSectionController } from '../src/client/section-store.ts'

const SESSION = SessionId('task')

const SHOUT = {
  promptPreset: 'shout',
  name: 'Shout',
  rules: [{ kind: 'append' as const, text: 'BE LOUD.' }],
  source: 'user' as const,
  isDefault: false,
}

const ROSTER: PromptPresetRoster = {
  presets: [SHOUT],
  default: '',
  revision: 3,
  writable: true,
  limits: { maxPresets: 8, maxRules: 8, maxPatternLength: 64, maxTextBytes: 1024 },
  protectedSections: [],
}

/** Which call the Host refuses, if any. */
type Refusal = 'create' | 'update' | 'delete' | 'default' | 'preview'

/** The Remote double, refusing whichever call the spec names. */
function bench(refuse?: Refusal) {
  const ctx = new Context()
  /** Every document the editor sent, so a spec reads what was written. */
  const sent: PromptPresetInput[] = []
  const refused = (name: Refusal) => ({
    ok: false as const,
    error: new RemoteError('gateway/internal', `${name} refused`, {}),
  })
  const promptPresets = {
    list: () => Promise.resolve({ ok: true as const, value: ROSTER }),
    create: (id: string, document: PromptPresetInput) => {
      sent.push(document)
      return Promise.resolve(refuse === 'create'
        ? refused('create')
        : { ok: true as const, value: { ...SHOUT, promptPreset: id } })
    },
    update: (_id: string, document: PromptPresetInput) => {
      sent.push(document)
      return Promise.resolve(refuse === 'update'
        ? refused('update')
        : { ok: true as const, value: SHOUT })
    },
    deletePreset: () => Promise.resolve(refuse === 'delete'
      ? refused('delete')
      : { ok: true as const, value: undefined }),
    setDefault: () => Promise.resolve(refuse === 'default'
      ? refused('default')
      : { ok: true as const, value: undefined }),
    select: () => Promise.resolve({ ok: true as const, value: null }),
    preview: () => Promise.resolve(refuse === 'preview'
      ? refused('preview')
      : {
        ok: true as const,
        value: {
          sections: [], prompt: '', baselineSections: [], baselinePrompt: '', warnings: [],
        },
      }),
  }
  const remote = new TestRemote(ctx, {})
  ctx.provide('remote.promptPresets', promptPresets as never)
  Object.assign(remote, { promptPresets })
  return { controller: new PromptPresetSectionController(ctx), sent }
}

describe('acting with nothing open', () => {
  it('leaves every editor action inert', async () => {
    const { controller } = bench()
    await controller.load()

    controller.setName('x')
    controller.setDescription('x')
    controller.addRule('append')
    controller.removeRule('nope')
    controller.moveRule('nope', 1)
    controller.patchRule('nope', { kind: 'append', text: 'x' })
    controller.setRuleEnabled('nope', false)
    controller.discard()
    await controller.save()

    expect(controller.store.getSnapshot()).toMatchObject({ draft: null, saving: false })
  })

  it('leaves every create-dialog action inert', () => {
    const { controller } = bench()
    controller.patchCreate({ id: 'x' })
    expect(controller.createBlocker()).toBeUndefined()
    expect(controller.store.getSnapshot().create).toBeNull()
  })

  it('ignores a confirmation nobody asked for', async () => {
    const { controller } = bench()
    await controller.load()
    controller.confirmSwitch()
    await controller.remove()
    expect(controller.store.getSnapshot()).toMatchObject({ selectedId: null, deleting: false })
  })

  it('opens nothing for an id the roster does not carry', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('absent')
    expect(controller.store.getSnapshot().draft).toBeNull()
  })
})

describe('acting on an open draft', () => {
  it('ignores a rule key the stack does not carry', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('shout')
    const before = controller.store.getSnapshot().draft?.rules
    controller.moveRule('nope', 1)
    controller.setRuleEnabled('nope', false)
    expect(controller.store.getSnapshot().draft?.rules).toBe(before)
  })

  it('replaces one rule of a stack and leaves its neighbours alone', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('shout')
    controller.addRule('prepend')
    const rules = controller.store.getSnapshot().draft?.rules ?? []
    controller.patchRule(rules[1]!.key, { kind: 'prepend', text: 'FIRST.' })
    const after = controller.store.getSnapshot().draft?.rules ?? []
    expect(after[0]).toBe(rules[0])
    expect(after[1]?.rule).toEqual({ kind: 'prepend', text: 'FIRST.' })
  })

  it('writes nothing for a draft nobody edited', async () => {
    const { controller } = bench('update')
    await controller.load()
    controller.select('shout')
    await controller.save()
    // Clean, so the refusing update was never reached.
    expect(controller.store.getSnapshot().saveError).toBeNull()
  })

  it('reports a refused save and keeps the edits', async () => {
    const { controller } = bench('update')
    await controller.load()
    controller.select('shout')
    controller.setName('Louder')
    await controller.save()
    expect(controller.store.getSnapshot()).toMatchObject({ saving: false, saveError: 'update refused' })
    expect(controller.store.getSnapshot().draft).toMatchObject({ name: 'Louder', dirty: true })
  })

  it('runs one save at a time', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('shout')
    controller.setName('Louder')
    await Promise.all([controller.save(), controller.save()])
    expect(controller.store.getSnapshot().draft?.dirty).toBe(false)
  })

  it('sends a description only once there is one', async () => {
    const blank = bench()
    await blank.controller.load()
    blank.controller.select('shout')
    blank.controller.setName('Louder')
    await blank.controller.save()
    // A preset with no description sends no key at all, rather than an empty
    // string the Host would have to strip.
    expect(blank.sent[0]).not.toHaveProperty('description')

    const described = bench()
    await described.controller.load()
    described.controller.select('shout')
    described.controller.setDescription('Loud and proud')
    await described.controller.save()
    expect(described.sent[0]).toMatchObject({ description: 'Loud and proud' })
  })

  it('re-seeds the editor from the roster on discard', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('shout')
    controller.setName('Louder')
    controller.discard()
    expect(controller.store.getSnapshot().draft).toMatchObject({ name: 'Shout', dirty: false })
  })
})

describe('refused roster writes', () => {
  it('keeps the create dialog open and says why', async () => {
    const { controller } = bench('create')
    await controller.load()
    controller.beginCreate()
    controller.patchCreate({ id: 'terse', name: 'Terse' })
    await Promise.all([controller.confirmCreate(), controller.confirmCreate()])
    expect(controller.store.getSnapshot().create)
      .toMatchObject({ saving: false, error: 'create refused' })
  })

  it('reports a refused delete and forgets the question', async () => {
    const { controller } = bench('delete')
    await controller.load()
    controller.confirmDelete('shout')
    await Promise.all([controller.remove(), controller.remove()])
    expect(controller.store.getSnapshot())
      .toMatchObject({ deleting: false, pendingDelete: null, error: 'delete refused' })
  })

  it('reports a refused default and runs one at a time', async () => {
    const { controller } = bench('default')
    await controller.load()
    await Promise.all([controller.setDefault('shout'), controller.setDefault('shout')])
    expect(controller.store.getSnapshot()).toMatchObject({ busy: false, error: 'default refused' })
  })
})

describe('creating a preset', () => {
  it('names an unnamed preset after its id', async () => {
    const { controller, sent } = bench()
    await controller.load()
    controller.beginCreate()
    controller.patchCreate({ id: 'terse' })
    await controller.confirmCreate()
    expect(controller.store.getSnapshot().create).toBeNull()
    expect(sent[0]).toMatchObject({ name: 'terse' })
  })
})

describe('the preview', () => {
  it('reports a refused redraw', async () => {
    const { controller } = bench('preview')
    await controller.load()
    controller.setPreviewSession(SESSION)
    controller.select('shout')
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.store.getSnapshot().preview)
      .toMatchObject({ status: 'error', error: 'preview refused' })
  })

  it('redraws nothing when the task it already watches is named again', async () => {
    const { controller } = bench()
    await controller.load()
    controller.select('shout')
    controller.setPreviewSession(SESSION)
    controller.setPreviewSession(SESSION)
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.store.getSnapshot().preview.status).toBe('ready')
  })
})
