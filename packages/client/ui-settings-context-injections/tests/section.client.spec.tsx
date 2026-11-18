// @vitest-environment jsdom
/** The page as the Settings shell renders it: groups, switches, folded text, and the shared save. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { ContextInjectionsSection, type ContextInjectionsSectionProps } from '../src/client/ContextInjectionsSection.tsx'
import type { ContextInjectionsRowState, ContextInjectionsState } from '../src/client/controller.ts'
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
    text: field(''),
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

  it('folds an empty replacement text until asked for it', () => {
    const actions = renderPage()
    const row = rowOf('timeContext')
    expect(within(row).queryByLabelText(en.textLabel)).toBeNull()

    fireEvent.click(within(row).getByRole('button', { name: en.editText }))
    fireEvent.change(within(row).getByLabelText(en.textLabel), { target: { value: 'Now: {{text}}' } })
    expect(actions.edit).toHaveBeenCalledWith('timeContextText', 'Now: {{text}}')

    fireEvent.click(within(row).getByRole('button', { name: en.hideText }))
    expect(within(row).queryByLabelText(en.textLabel)).toBeNull()
  })

  it('opens a row that carries a replacement text and offers its reset', () => {
    const actions = renderPage({ rows: rows({ approvalPolicy: { text: field('Policy: {{text}}', { overridden: true }) } }) })
    const row = rowOf('approvalPolicy')

    expect(within(row).getByLabelText(en.textLabel)).toHaveProperty('value', 'Policy: {{text}}')
    expect(within(row).queryByRole('button', { name: en.editText })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('approvalPolicyText')
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
