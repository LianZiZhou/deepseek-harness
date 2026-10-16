// @vitest-environment jsdom
/**
 * The two surfaces, fed plain props: the task header's switcher and the
 * settings page with its rule editor and preview.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PromptPresetSeat } from '../src/client/PromptPresetSeat.tsx'
import type { PromptPresetSeatProps } from '../src/client/PromptPresetSeat.tsx'
import { PromptPresetSection } from '../src/client/PromptPresetSection.tsx'
import type { PromptPresetSectionProps } from '../src/client/PromptPresetSection.tsx'
import { PromptPresetPreview } from '../src/client/PromptPreview.tsx'
import { TextArea } from '../src/client/TextArea.tsx'
import type { PromptPresetSeatState, PromptPresetSectionState } from '../src/client/index.ts'
import { mintRuleKey } from '../src/client/preset-model.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = SessionId('task')

/** The runtime's own `{name}` substitution, so a test reads the shown text. */
function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const SEAT_READY: PromptPresetSeatState = {
  status: 'ready',
  options: [{ id: 'shout', name: 'Shout' }, { id: 'terse', name: 'Terse' }],
  switching: false,
  error: null,
}

const SECTION_READY: PromptPresetSectionState = {
  status: 'ready',
  error: null,
  writable: true,
  rows: [
    { promptPreset: 'shipped', name: 'Shipped', rules: [], source: 'deployment', isDefault: true },
    {
      promptPreset: 'shout',
      name: 'Shout',
      rules: [{ kind: 'append', text: 'BE LOUD.' }],
      source: 'user',
      isDefault: false,
    },
  ],
  defaultId: 'shipped',
  busy: false,
  selectedId: null,
  draft: null,
  saving: false,
  saveError: null,
  create: null,
  pendingDelete: null,
  deleting: false,
  pendingSwitch: null,
  preview: {
    status: 'ready',
    error: null,
    baseline: [{ name: 'harness:identity', text: 'identity' }],
    sections: [{ name: 'harness:identity', text: 'identity' }],
    prompt: 'identity',
    baselinePrompt: 'identity',
    warnings: [],
  },
}

/** The open draft used by the editor tests. */
function draftOf(...rules: PromptPresetSectionState['rows'][number]['rules']): PromptPresetSectionState['draft'] {
  return {
    id: 'shout',
    name: 'Shout',
    description: '',
    rules: rules.map(rule => ({ key: mintRuleKey(), rule })),
    revision: undefined,
    dirty: true,
  }
}

function renderSeat(state: Partial<PromptPresetSeatState> = {}, overrides: Partial<PromptPresetSeatProps> = {}) {
  const store = createSnapshotStore<PromptPresetSeatState>({ ...SEAT_READY, ...state })
  const select = vi.fn(() => Promise.resolve())
  const props = {
    sessionId: SESSION,
    useSessions: <Selected,>(selector: (value: never) => Selected): Selected =>
      selector({ byId: { [SESSION]: { projectionValues: { promptPreset: 'shout' } } } } as never),
    usePromptPresetSeat: bindSnapshotSelector(store),
    load: () => Promise.resolve(),
    select,
    clearError: vi.fn(),
    t: translate,
    ...overrides,
  } as PromptPresetSeatProps
  render(<PromptPresetSeat {...props} />)
  return { select, props }
}

function renderSection(state: Partial<PromptPresetSectionState> = {}, overrides: Record<string, unknown> = {}) {
  const store = createSnapshotStore<PromptPresetSectionState>({ ...SECTION_READY, ...state })
  const actions = {
    load: () => Promise.resolve(),
    select: vi.fn(),
    confirmSwitch: vi.fn(),
    cancelSwitch: vi.fn(),
    beginCreate: vi.fn(),
    cancelCreate: vi.fn(),
    patchCreate: vi.fn(),
    confirmCreate: () => Promise.resolve(),
    createBlocker: () => undefined,
    setName: vi.fn(),
    setDescription: vi.fn(),
    addRule: vi.fn(),
    removeRule: vi.fn(),
    moveRule: vi.fn(),
    patchRule: vi.fn(),
    setRuleEnabled: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
    discard: vi.fn(),
    setDefault: vi.fn(() => Promise.resolve()),
    confirmDelete: vi.fn(),
    remove: vi.fn(() => Promise.resolve()),
    refreshPreview: vi.fn(),
    hasSession: () => true,
    ...overrides,
  }
  const props = {
    close: vi.fn(),
    usePromptPresetSection: bindSnapshotSelector(store),
    t: translate,
    ...actions,
  } as PromptPresetSectionProps
  render(<PromptPresetSection {...props} />)
  return actions
}

describe('the task switcher', () => {
  it('names the preset the task runs, and offers the stored ones', () => {
    const { select } = renderSeat()
    fireEvent.click(screen.getByRole('button', { name: en['seat.label'] }))
    expect(screen.getByText('Terse')).toBeTruthy()

    fireEvent.click(screen.getByText('Terse'))
    expect(select).toHaveBeenCalledWith('terse')
  })

  it('says a change applies from the next turn', () => {
    renderSeat()
    fireEvent.click(screen.getByRole('button', { name: en['seat.label'] }))
    expect(screen.getByText(en['seat.appliesNextTurn'])).toBeTruthy()
  })

  it('shows no preset on a Hero that has no task yet', () => {
    // The Hero seat is session-maybe: before a task exists there is no log to
    // read a selection from, and the control still offers the roster.
    renderSeat({}, { sessionId: undefined })
    expect(screen.getByRole('button', { name: en['seat.label'] }).textContent)
      .toContain(en['seat.none'])
  })

  it('shows no preset when the task selected none', () => {
    renderSeat({}, {
      useSessions: <Selected,>(selector: (value: never) => Selected): Selected =>
        selector({ byId: { [SESSION]: { projectionValues: {} } } } as never),
    })
    expect(screen.getByRole('button', { name: en['seat.label'] }).textContent)
      .toContain(en['seat.none'])
  })

  it('renders nothing while the deployment stores none', () => {
    const { container } = render(<div />)
    cleanup()
    renderSeat({ status: 'unavailable', options: [] })
    expect(screen.queryByRole('button', { name: en['seat.label'] })).toBeNull()
    expect(container).toBeTruthy()
  })

  it('surfaces a refused switch and clears it when read', () => {
    const clearError = vi.fn()
    renderSeat({ error: 'locked' }, { clearError })
    const notice = screen.getByText(translate('seat.switchFailed', { message: 'locked' }))
    fireEvent.click(notice)
    expect(clearError).toHaveBeenCalledOnce()
  })
})

describe('the settings page', () => {
  it('renders nothing when the deployment stores no presets', () => {
    renderSection({ status: 'unavailable' })
    expect(screen.queryByText(en.nav)).toBeNull()
  })

  it('lists the roster, marking the default and the built-in rows', () => {
    renderSection()
    expect(screen.getByText('Shipped')).toBeTruthy()
    expect(screen.getByText(en.defaultTag)).toBeTruthy()
    expect(screen.getByText(en.builtIn)).toBeTruthy()
    expect(screen.getByText(translate('ruleCount', { count: '1' }))).toBeTruthy()
  })

  it('opens a preset, makes one default, and asks before deleting', () => {
    const actions = renderSection()
    fireEvent.click(screen.getByText('Shout'))
    expect(actions.select).toHaveBeenCalledWith('shout')

    fireEvent.click(screen.getAllByText(en.setDefault)[0]!)
    expect(actions.setDefault).toHaveBeenCalledWith('shout')

    fireEvent.click(screen.getByRole('button', { name: en.deletePreset }))
    expect(actions.confirmDelete).toHaveBeenCalledWith('shout')
  })

  it('says nothing is open until a preset is selected', () => {
    renderSection()
    expect(screen.getByText(en.editorEmpty)).toBeTruthy()
  })

  it('offers every rule kind and adds the chosen one', () => {
    const actions = renderSection({ selectedId: 'shout', draft: draftOf({ kind: 'append', text: 'x' }) })
    fireEvent.click(screen.getByText(en.addRule))
    fireEvent.click(screen.getByText(en['rule.substitute.name']))
    expect(actions.addRule).toHaveBeenCalledWith('substitute')
  })

  it('blocks Save while a rule is unusable, and offers it once the rule is fixed', () => {
    renderSection({ selectedId: 'shout', draft: draftOf({ kind: 'remove', sections: [] }) })
    expect(screen.getByText(en.saveBlocked)).toBeTruthy()
    expect(screen.getByText(en['rule.error.sectionsRequired'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save }).getAttribute('disabled')).not.toBeNull()

    cleanup()
    const actions = renderSection({ selectedId: 'shout', draft: draftOf({ kind: 'append', text: 'x' }) })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('disables the move buttons at the ends of the stack', () => {
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'append', text: 'a' }, { kind: 'append', text: 'b' }),
    })
    const cards = screen.getAllByRole('listitem').filter(item => item.getAttribute('aria-label') !== null)
    const first = within(cards[0]!).getByRole('button', { name: en['rule.moveUp'] })
    const last = within(cards[1]!).getByRole('button', { name: en['rule.moveDown'] })
    expect(first.hasAttribute('disabled')).toBe(true)
    expect(last.hasAttribute('disabled')).toBe(true)
  })

  it('marks a rule an earlier replace leaves nothing to act on', () => {
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'replace', text: 'only' }, { kind: 'remove', sections: ['x'] }),
    })
    expect(screen.getByText(en['rule.badge.shadowed'])).toBeTruthy()
  })

  it('refuses a second enabled replace', () => {
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'replace', text: 'a' }, { kind: 'replace', text: 'b' }),
    })
    expect(screen.getByText(en['rule.error.replaceDuplicate'])).toBeTruthy()
  })

  it('shows a pattern the engine rejects, beside its field', () => {
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'substitute', pattern: '(', replacement: '' }),
    })
    expect(screen.getByText(/not valid/)).toBeTruthy()
  })

  it('asks before discarding a dirty draft, and before deleting', () => {
    const switching = renderSection({ pendingSwitch: 'other' })
    expect(screen.getByText(en.unsavedTitle)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.unsavedDiscard }))
    expect(switching.confirmSwitch).toHaveBeenCalledOnce()

    cleanup()
    const deleting = renderSection({ pendingDelete: 'shout' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.deleteConfirm }))
    expect(deleting.remove).toHaveBeenCalledOnce()
  })

  it('creates a preset through the dialog, and reports what blocks it', () => {
    const actions = renderSection(
      { create: { id: 'Not Valid', name: '', saving: false, error: null } },
      { createBlocker: () => ({ key: 'idInvalid' }) },
    )
    expect(screen.getByText(en.idInvalid)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: en.cancel })[0]!)
    expect(actions.cancelCreate).toHaveBeenCalled()
  })
})

describe('the preview pane', () => {
  it('asks for a task when none is open', () => {
    render(
      <PromptPresetPreview
        preview={SECTION_READY.preview}
        hasSession={false}
        onRefresh={vi.fn()}
        t={translate as never}
      />,
    )
    expect(screen.getByText(en['preview.needsSession'])).toBeTruthy()
  })

  it('marks what the rules added, changed, and removed', () => {
    render(
      <PromptPresetPreview
        preview={{
          ...SECTION_READY.preview,
          baseline: [
            { name: 'harness:identity', text: 'identity' },
            { name: 'tool:bash', text: 'bash' },
          ],
          sections: [
            { name: 'harness:identity', text: 'IDENTITY' },
            { name: 'prompt-preset:append-0', text: 'LOUD', fromRule: 0 },
          ],
        }}
        hasSession
        onRefresh={vi.fn()}
        t={translate as never}
      />,
    )
    expect(screen.getByText(en['preview.tag.changed'])).toBeTruthy()
    expect(screen.getByText(en['preview.tag.added'])).toBeTruthy()
    expect(screen.getByText(en['preview.tag.removed'])).toBeTruthy()
  })

  it('switches to the rendered prompt and back', () => {
    const onRefresh = vi.fn()
    render(
      <PromptPresetPreview
        preview={{ ...SECTION_READY.preview, prompt: 'FINAL PROMPT' }}
        hasSession
        onRefresh={onRefresh}
        t={translate as never}
      />,
    )
    fireEvent.click(screen.getByText(en['preview.prompt']))
    expect(screen.getByText('FINAL PROMPT')).toBeTruthy()
    fireEvent.click(screen.getByText(en['preview.sections']))
    expect(screen.getByText('identity')).toBeTruthy()
    fireEvent.click(screen.getByText(en['preview.refresh']))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('words every warning the Host sent, and prints an unrecognized one verbatim', () => {
    render(
      <PromptPresetPreview
        preview={{
          ...SECTION_READY.preview,
          status: 'loading',
          warnings: [
            { code: 'no-match', rule: 1 },
            { code: 'unknown-section', section: 'tool:absent' },
            { code: 'weird' as never, detail: 'raw text' },
          ],
        }}
        hasSession
        onRefresh={vi.fn()}
        t={translate as never}
      />,
    )
    expect(screen.getByText(translate('preview.warn.noMatch', { position: '2' }))).toBeTruthy()
    expect(screen.getByText(translate('preview.warn.unknownSection', { section: 'tool:absent' }))).toBeTruthy()
    expect(screen.getByText('raw text')).toBeTruthy()
    expect(screen.getByText(en['preview.loading'])).toBeTruthy()
  })

  it('reports a failed preview', () => {
    render(
      <PromptPresetPreview
        preview={{ ...SECTION_READY.preview, status: 'error', error: 'boom' }}
        hasSession
        onRefresh={vi.fn()}
        t={translate as never}
      />,
    )
    expect(screen.getByText(translate('preview.error', { message: 'boom' }))).toBeTruthy()
  })
})

describe('the multi-line field', () => {
  it('reports each keystroke and grows with its text', () => {
    const onChange = vi.fn()
    render(<TextArea value="a" onChange={onChange} ariaLabel="body" rows={2} maxRows={4} />)
    const field = screen.getByLabelText('body')
    fireEvent.change(field, { target: { value: 'ab' } })
    expect(onChange).toHaveBeenCalledWith('ab')
    expect(field.getAttribute('style')).toContain('height')
  })

  it('marks itself rejected and refuses edits when disabled', () => {
    render(<TextArea value="" onChange={vi.fn()} ariaLabel="body" invalid monospace disabled />)
    const field = screen.getByLabelText('body')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.hasAttribute('disabled')).toBe(true)
  })
})

describe('the rule editor', () => {
  it('reports a rename, a redescription, and a rule edit', () => {
    const actions = renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'append', text: 'x' }),
    })
    fireEvent.change(screen.getByLabelText(en.presetName), { target: { value: 'Louder' } })
    expect(actions.setName).toHaveBeenCalledWith('Louder')

    fireEvent.change(screen.getByLabelText(en.presetDescription), { target: { value: 'note' } })
    expect(actions.setDescription).toHaveBeenCalledWith('note')

    fireEvent.change(screen.getByLabelText(en['rule.field.text']), { target: { value: 'y' } })
    expect(actions.patchRule).toHaveBeenCalledWith(expect.any(String), { kind: 'append', text: 'y' })
  })

  it('reports a toggle, a move, and a removal', () => {
    const actions = renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'append', text: 'a' }, { kind: 'append', text: 'b' }),
    })
    const cards = screen.getAllByRole('listitem').filter(item => item.getAttribute('aria-label') !== null)

    fireEvent.click(within(cards[0]!).getByRole('switch'))
    expect(actions.setRuleEnabled).toHaveBeenCalledWith(expect.any(String), false)

    fireEvent.click(within(cards[1]!).getByRole('button', { name: en['rule.moveUp'] }))
    expect(actions.moveRule).toHaveBeenCalledWith(expect.any(String), -1)

    fireEvent.click(within(cards[0]!).getByRole('button', { name: en['rule.delete'] }))
    expect(actions.removeRule).toHaveBeenCalledOnce()
  })

  it('edits a removal list and a substitution, and offers the interpolation switch', () => {
    const actions = renderSection({
      selectedId: 'shout',
      draft: draftOf(
        { kind: 'remove', sections: ['a'] },
        { kind: 'substitute', pattern: 'p', flags: 'g', replacement: 'r' },
      ),
    })
    const cards = screen.getAllByRole('listitem').filter(item => item.getAttribute('aria-label') !== null)

    fireEvent.change(
      within(cards[0]!).getByLabelText(en['rule.field.sections']),
      { target: { value: 'a, b' } },
    )
    expect(actions.patchRule).toHaveBeenCalledWith(expect.any(String), { kind: 'remove', sections: ['a', 'b'] })

    fireEvent.change(within(cards[1]!).getByLabelText(en['rule.field.pattern']), { target: { value: 'q' } })
    fireEvent.change(within(cards[1]!).getByLabelText(en['rule.field.flags']), { target: { value: 'gi' } })
    fireEvent.change(within(cards[1]!).getByLabelText(en['rule.field.replacement']), { target: { value: 's' } })
    fireEvent.change(within(cards[1]!).getByLabelText(en['rule.field.sections']), { target: { value: 'x' } })
    expect(actions.patchRule).toHaveBeenCalledTimes(5)
  })

  it('marks a rule its author turned off, and keeps its fields readable', () => {
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'prepend', text: 'a', enabled: false }),
    })
    expect(screen.getByText(en['rule.badge.disabled'])).toBeTruthy()
    expect(screen.getByLabelText(en['rule.field.text']).hasAttribute('disabled')).toBe(true)
  })

  it('offers the interpolation switch on a text rule', () => {
    const actions = renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'prepend', text: 'a' }),
    })
    fireEvent.click(screen.getByLabelText(en['rule.field.interpolate']))
    expect(actions.patchRule).toHaveBeenCalledWith(expect.any(String), {
      kind: 'prepend', text: 'a', interpolate: true,
    })
  })

  it('discards a draft, refreshes the preview, and says an empty stack is empty', () => {
    const actions = renderSection({ selectedId: 'shout', draft: draftOf() })
    expect(screen.getByText(en.rulesEmpty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect(actions.discard).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText(en['preview.refresh']))
    expect(actions.refreshPreview).toHaveBeenCalledOnce()
  })

  it('reports a refused save and a refused roster read', () => {
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'append', text: 'a' }),
      saveError: 'stale',
      error: 'offline',
      saving: true,
    })
    expect(screen.getByText(translate('error', { message: 'stale' }))).toBeTruthy()
    expect(screen.getByText(translate('error', { message: 'offline' }))).toBeTruthy()
    expect(screen.getByText(en.saving)).toBeTruthy()
  })

  it('says the roster is empty when the deployment stores nothing yet', () => {
    const actions = renderSection({ rows: [] })
    expect(screen.getByText(en.rosterEmpty)).toBeTruthy()
    fireEvent.click(screen.getByText(en.newPreset))
    expect(actions.beginCreate).toHaveBeenCalledOnce()
  })

  it('edits the create dialog and confirms it', () => {
    const actions = renderSection({ create: { id: 'terse', name: '', saving: false, error: 'taken' } })
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(en.presetId), { target: { value: 'terser' } })
    expect(actions.patchCreate).toHaveBeenCalledWith({ id: 'terser' })
    fireEvent.change(dialog.getByLabelText(en.displayName), { target: { value: 'Terser' } })
    expect(actions.patchCreate).toHaveBeenCalledWith({ name: 'Terser' })
    expect(screen.getByText(translate('error', { message: 'taken' }))).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: en.create }))
  })

  it('keeps editing when the unsaved question is dismissed', () => {
    const actions = renderSection({ pendingSwitch: 'other' })
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: en.unsavedKeep })[0]!)
    expect(actions.cancelSwitch).toHaveBeenCalled()
  })

  it('cancels a delete from every affordance the dialog offers', () => {
    const actions = renderSection({ pendingDelete: 'shout' })
    const buttons = within(screen.getByRole('dialog')).getAllByRole('button', { name: en.cancel })
    expect(buttons.length).toBeGreaterThan(1)
    for (const button of buttons) fireEvent.click(button)
    expect(actions.confirmDelete).toHaveBeenCalledTimes(buttons.length)
    expect(actions.confirmDelete).toHaveBeenLastCalledWith(null)
  })
})

describe('closing menus and dialogs', () => {
  it('closes the switcher menu without choosing', () => {
    const { select } = renderSeat()
    fireEvent.click(screen.getByRole('button', { name: en['seat.label'] }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(select).not.toHaveBeenCalled()
  })

  it('closes the add-rule menu without adding', () => {
    const actions = renderSection({ selectedId: 'shout', draft: draftOf({ kind: 'append', text: 'a' }) })
    fireEvent.click(screen.getByText(en.addRule))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(actions.addRule).not.toHaveBeenCalled()
  })

  it('closes the create dialog from its own close affordance', () => {
    const actions = renderSection({ create: { id: '', name: '', saving: true, error: null } })
    expect(screen.getByText(en.creating)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(actions.cancelCreate).toHaveBeenCalled()
  })

  it('closes the delete dialog from its own close affordance', () => {
    const actions = renderSection({ pendingDelete: 'shout', deleting: true })
    expect(screen.getByText(en.deleting)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(actions.confirmDelete).toHaveBeenCalledWith(null)
  })

  it('moves a rule later from its own card', () => {
    const actions = renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'append', text: 'a' }, { kind: 'append', text: 'b' }),
    })
    const cards = screen.getAllByRole('listitem').filter(item => item.getAttribute('aria-label') !== null)
    fireEvent.click(within(cards[0]!).getByRole('button', { name: en['rule.moveDown'] }))
    expect(actions.moveRule).toHaveBeenCalledWith(expect.any(String), 1)
  })

  it('marks a protected section and locates a warning with no rule of its own', () => {
    render(
      <PromptPresetPreview
        preview={{
          ...SECTION_READY.preview,
          sections: [{ name: 'tools:ptc-only', text: 'ptc', protectedSection: true }],
          warnings: [{ code: 'empty-prompt' }],
        }}
        hasSession
        onRefresh={vi.fn()}
        t={translate as never}
      />,
    )
    expect(screen.getByText(en['preview.tag.protected'])).toBeTruthy()
    expect(screen.getByText(en['preview.warn.emptyPrompt'])).toBeTruthy()
  })
})

describe('reporting what is wrong', () => {
  it('says what a text rule is missing, right under the field', () => {
    renderSection({ selectedId: 'shout', draft: draftOf({ kind: 'append', text: '' }) })
    const alerts = screen.getAllByRole('alert').map(node => node.textContent)
    expect(alerts).toContain(en['rule.error.textRequired'])
  })

  it('reports a failed preview even when the Host named no reason', () => {
    render(
      <PromptPresetPreview
        preview={{ ...SECTION_READY.preview, status: 'error', error: null }}
        hasSession
        onRefresh={vi.fn()}
        t={translate as never}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(translate('preview.error', { message: '' }))
  })
})

describe('the insert rule card', () => {
  it('edits its anchor and its text, trimming the anchor as typed', () => {
    const actions = renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'insert', after: 'harness:identity', text: 'HERE.' }),
    })
    const card = screen.getAllByRole('listitem').find(item => item.getAttribute('aria-label') !== null)!

    fireEvent.change(within(card).getByLabelText(en['rule.field.after']), {
      target: { value: '  tool:bash  ' },
    })
    expect(actions.patchRule).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 'insert', after: 'tool:bash' }),
    )

    fireEvent.change(within(card).getByLabelText(en['rule.field.text']), { target: { value: 'NEW.' } })
    expect(actions.patchRule).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 'insert', text: 'NEW.' }),
    )
  })

  it('opts into interpolation from the card', () => {
    const actions = renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'insert', after: 'harness:identity', text: 'On {{model}}.' }),
    })
    const card = screen.getAllByRole('listitem').find(item => item.getAttribute('aria-label') !== null)!

    fireEvent.click(within(card).getByLabelText(en['rule.field.interpolate']))
    expect(actions.patchRule).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 'insert', interpolate: true }),
    )
  })

  it('says which of the two fields is missing', () => {
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'insert', after: '', text: 'HERE.' }),
    })
    expect(screen.getAllByRole('alert').map(node => node.textContent))
      .toContain(en['rule.error.anchorRequired'])

    cleanup()
    renderSection({
      selectedId: 'shout',
      draft: draftOf({ kind: 'insert', after: 'harness:identity', text: '' }),
    })
    expect(screen.getAllByRole('alert').map(node => node.textContent))
      .toContain(en['rule.error.textRequired'])
  })
})
