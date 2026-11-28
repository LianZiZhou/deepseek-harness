// @vitest-environment jsdom
/** The page as the Settings shell renders it: groups, switches, folded templates, and the shared save. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives/client'
import { ContextInjectionsSection, type ContextInjectionsSectionProps } from '../src/client/ContextInjectionsSection.tsx'
import { textField, type ContextInjectionsRowState, type ContextInjectionsState } from '../src/client/controller.ts'
import { en, type ContextInjectionsLocaleKey } from '../src/client/locales.ts'
import { PAGE_ROWS } from '../src/client/rows.ts'

afterEach(cleanup)

const t = (key: ContextInjectionsLocaleKey) => en[key]

const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function rows(overrides: Partial<Record<string, Partial<ContextInjectionsRowState>>> = {}): ContextInjectionsRowState[] {
  return PAGE_ROWS.map(row => ({
    id: row.id,
    ...row.switchable ? { enabled: field('true') } : {},
    variants: row.variants.map(shape => ({
      shape,
      field: textField(row.id, shape.id),
      text: field(`template of ${row.id}/${shape.id}`),
    })),
    ...overrides[row.id],
  }))
}

function renderPage(state: Partial<ContextInjectionsState> = {}) {
  const store = createSnapshotStore<ContextInjectionsState>({ ...settled, rows: rows(), ...state })
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const props = { ...actions, t, useContextInjections: bindSnapshotSelector(store) } as ContextInjectionsSectionProps
  render(<ContextInjectionsSection {...props} />)
  return actions
}

function rowOf(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-row="${id}"]`)!
}

describe('ContextInjectionsSection', () => {
  it('lists every row under its group with its own copy', () => {
    renderPage()

    const notices = screen.getByRole('region', { name: en.noticesHeading })
    const context = screen.getByRole('region', { name: en.contextHeading })
    expect(within(notices).getByRole('switch', { name: en['row.modelSwitch'] })).toBeTruthy()
    expect(within(notices).getByText(en['row.timeContext.hint'])).toBeTruthy()
    expect(within(context).getByRole('switch', { name: en['row.sandboxPolicy'] })).toBeTruthy()
    expect(within(context).queryByRole('switch', { name: en['row.workingDirectory'] })).toBeNull()
    expect(within(context).getByText(`${en['row.workingDirectory.hint']} ${en.alwaysStated}`)).toBeTruthy()
  })

  it('stages a toggle and a reset under the row\'s own fields', () => {
    const actions = renderPage({ rows: rows({ modelSwitch: { enabled: field('false', { overridden: true }) } }) })

    fireEvent.click(screen.getByRole('switch', { name: en['row.modelSwitch'] }))
    fireEvent.click(within(rowOf('modelSwitch')).getByRole('button', { name: en.reset }))

    expect(actions.edit).toHaveBeenCalledWith('modelSwitchEnabled', 'true')
    expect(actions.resetField).toHaveBeenCalledWith('modelSwitchEnabled')
  })

  it('folds the templates until asked, prefilled, labelled per shape, with their variables', () => {
    const actions = renderPage()
    const row = rowOf('timeContext')
    expect(within(row).queryByLabelText(en['variant.timeContext.known'])).toBeNull()

    fireEvent.click(within(row).getByRole('button', { name: en.editText }))
    const known = within(row).getByLabelText(en['variant.timeContext.known'])
    expect(known).toHaveProperty('value', 'template of timeContext/known')
    expect(within(row).getByLabelText(en['variant.timeContext.unclear'])).toBeTruthy()
    expect(within(row).getAllByText(
      `${en.variablesLabel} {{turn}} {{step}} {{time}} {{zone}} {{baseline}} {{elapsed}} {{text}}. ${en.textHint}`,
    )).toHaveLength(2)
    fireEvent.change(known, { target: { value: 'Now: {{time}}' } })
    expect(actions.edit).toHaveBeenCalledWith('timeContextKnownText', 'Now: {{time}}')

    fireEvent.click(within(row).getByRole('button', { name: en.hideText }))
    expect(within(row).queryByLabelText(en['variant.timeContext.known'])).toBeNull()
  })

  it('labels the only shape of a row as its template and sizes the box to it', () => {
    renderPage({
      rows: rows({
        modelSwitch: {
          variants: [{ shape: { id: '', variables: ['from', 'to'] }, field: 'modelSwitchText', text: field('a\nb\nc\nd\ne') }],
        },
      }),
    })
    const row = rowOf('modelSwitch')
    fireEvent.click(within(row).getByRole('button', { name: en.editText }))

    expect(within(row).getByLabelText(en.textLabel)).toHaveProperty('rows', 6)
    expect(within(row).getByText(`${en.variablesLabel} {{from}} {{to}} {{text}}. ${en.textHint}`)).toBeTruthy()
  })

  it('opens a row with an edited template and offers the reset of that template', () => {
    const page = PAGE_ROWS.find(entry => entry.id === 'approvalPolicy')
    const actions = renderPage({
      rows: rows({
        approvalPolicy: {
          variants: (page?.variants ?? []).map(shape => ({
            shape,
            field: textField('approvalPolicy', shape.id),
            text: shape.id === 'never' ? field('Never: {{text}}', { overridden: true }) : field('ask template'),
          })),
        },
      }),
    })
    const row = rowOf('approvalPolicy')

    expect(within(row).getByLabelText(en['variant.approvalPolicy.never'])).toHaveProperty('value', 'Never: {{text}}')
    expect(within(row).queryByRole('button', { name: en.editText })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('approvalPolicyNeverText')
  })

  it('saves through the shared form and disables every control while read-only', () => {
    const actions = renderPage({ dirty: true })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(actions.save).toHaveBeenCalledOnce()
    cleanup()

    renderPage({ writable: false })
    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    expect(screen.getByRole('switch', { name: en['row.modelSwitch'] })).toHaveProperty('disabled', true)
  })
})
