// @vitest-environment jsdom
/** Per-model reasoning efforts: inherit, disable, or declare levels and wire values. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelReasoningEfforts } from '../src/client/ModelReasoningEfforts.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** Render one row's control and return its change spy. */
function show(model: Record<string, unknown>, disabled = false) {
  const onChange = vi.fn()
  render(<ModelReasoningEfforts model={{ id: 'm', ...model }} position={3} disabled={disabled} t={key => en[key]} onChange={onChange} />)
  return onChange
}

/** The selected mode tab's label. */
function selectedMode(): string | null {
  return screen.getAllByRole('tab').find(tab => tab.getAttribute('aria-selected') === 'true')?.textContent ?? null
}

describe('reasoning effort declaration', () => {
  it('reads an absent field as Automatic and explains the name match', () => {
    const onChange = show({})
    expect(screen.getByRole('group', { name: `${en.reasoningEfforts} 3` })).toBeTruthy()
    expect(selectedMode()).toBe(en.reasoningAuto)
    expect(screen.getByText(en.reasoningAutoHint)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reads false as None', () => {
    show({ reasoningEfforts: false })
    expect(selectedMode()).toBe(en.reasoningNone)
    expect(screen.getByText(en.reasoningNoneHint)).toBeTruthy()
  })

  it('switches modes, keeping the row\'s other fields', () => {
    const onChange = show({ reasoningEfforts: false, contextWindow: 1000 })
    fireEvent.click(screen.getByRole('tab', { name: en.reasoningAuto }))
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm', contextWindow: 1000 })
    fireEvent.click(screen.getByRole('tab', { name: en.reasoningCustom }))
    expect(onChange).toHaveBeenLastCalledWith({
      id: 'm', contextWindow: 1000, reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    })
    cleanup()
    const fromAuto = show({})
    fireEvent.click(screen.getByRole('tab', { name: en.reasoningNone }))
    expect(fromAuto).toHaveBeenLastCalledWith({ id: 'm', reasoningEfforts: false })
  })

  it('toggles levels: off sends nothing, others send their own name', () => {
    const onChange = show({ reasoningEfforts: { high: 'high' } })
    expect(selectedMode()).toBe(en.reasoningCustom)
    fireEvent.click(screen.getByRole('checkbox', { name: en.reasoningLevelOff }))
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm', reasoningEfforts: { high: 'high', off: null } })
    fireEvent.click(screen.getByRole('checkbox', { name: en.reasoningLevelMax }))
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm', reasoningEfforts: { high: 'high', max: 'max' } })
    fireEvent.click(screen.getByRole('checkbox', { name: en.reasoningLevelHigh }))
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm', reasoningEfforts: {} })
  })

  it('edits a wire value, and an emptied one falls back to the level name', () => {
    const onChange = show({ reasoningEfforts: { off: 'none', high: 'deep', low: 'low' } })
    const high = screen.getByRole<HTMLInputElement>('textbox', { name: `${en.reasoningWire} high 3` })
    const low = screen.getByRole<HTMLInputElement>('textbox', { name: `${en.reasoningWire} low 3` })
    const off = screen.getByRole<HTMLInputElement>('textbox', { name: `${en.reasoningWire} off 3` })
    // A value equal to the level's own name shows as the placeholder.
    expect([high.value, low.value, off.value]).toEqual(['deep', '', 'none'])
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: `${en.reasoningWire} max 3` }).disabled).toBe(true)
    fireEvent.change(high, { target: { value: ' ultra ' } })
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm', reasoningEfforts: { off: 'none', high: 'ultra', low: 'low' } })
    fireEvent.change(high, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm', reasoningEfforts: { off: 'none', high: 'high', low: 'low' } })
    fireEvent.change(off, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm', reasoningEfforts: { off: null, high: 'deep', low: 'low' } })
  })

  it('warns before a save the Host would refuse', () => {
    show({ reasoningEfforts: { off: null } })
    expect(screen.getByRole('alert').textContent).toBe(en.reasoningNeedsLevel)
    cleanup()
    // A hand-written null reads as Custom with nothing declared, not as Automatic.
    show({ reasoningEfforts: null })
    expect(selectedMode()).toBe(en.reasoningCustom)
    expect(screen.getByRole('alert')).toBeTruthy()
    cleanup()
    show({ reasoningEfforts: { low: 'low' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables every control while read-only or saving', () => {
    show({ reasoningEfforts: { high: 'high' } }, true)
    for (const box of screen.getAllByRole<HTMLInputElement>('checkbox')) expect(box.disabled).toBe(true)
    for (const box of screen.getAllByRole<HTMLInputElement>('textbox')) expect(box.disabled).toBe(true)
  })
})
