// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsSecretField, SettingsSwitchField, SettingsTextAreaField, SettingsValueField } from '../src/client/settings-form/fields.tsx'

afterEach(cleanup)

const frame = {
  id: 'field',
  label: 'Command timeout',
  hint: 'How long one command may run.',
  overriddenLabel: 'Overridden',
  resetLabel: 'Reset to default',
  invalidLabel: 'Enter a number.',
  disabled: false,
  overridden: false,
  invalid: false,
}

describe('SettingsValueField', () => {
  it('stages every keystroke without writing', () => {
    const onEdit = vi.fn()
    render(<SettingsValueField {...frame} text="60000" onEdit={onEdit} onReset={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Command timeout'), { target: { value: '9000' } })

    expect(onEdit).toHaveBeenCalledWith('9000')
  })

  it('renders the staged text it is given rather than a draft of its own', () => {
    const { rerender } = render(<SettingsValueField {...frame} text="60000" onEdit={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByLabelText('Command timeout')).toHaveProperty('value', '60000')

    rerender(<SettingsValueField {...frame} text="9000" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Command timeout')).toHaveProperty('value', '9000')
  })

  it('offers the reset only while an override would stand', () => {
    const onReset = vi.fn()
    const { rerender } = render(<SettingsValueField {...frame} text="9000" onEdit={vi.fn()} onReset={onReset} />)
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull()

    rerender(<SettingsValueField {...frame} overridden text="9000" onEdit={vi.fn()} onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))

    expect(screen.getByText('Overridden')).toBeTruthy()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('replaces the hint with the reason an invalid draft cannot be saved', () => {
    render(<SettingsValueField {...frame} invalid text="soon" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByText('Enter a number.')).toBeTruthy()
    expect(screen.queryByText('How long one command may run.')).toBeNull()
    expect(screen.getByLabelText('Command timeout').getAttribute('aria-invalid')).toBe('true')
  })

  it('hints a numeric keypad and renders a placeholder when asked', () => {
    render(
      <SettingsValueField
        {...frame}
        numeric
        placeholder="https://api.deepseek.com"
        text=""
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Command timeout')

    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input).toHaveProperty('placeholder', 'https://api.deepseek.com')
  })

  it('disables the control and its reset while the document is read-only', () => {
    render(<SettingsValueField {...frame} disabled overridden text="9000" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Command timeout')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Reset to default' })).toHaveProperty('disabled', true)
  })
})

describe('SettingsSecretField', () => {
  const secret = {
    id: 'key',
    label: 'API key',
    hint: 'Stored outside the settings file.',
    disabled: false,
  }

  it('stages the draft and never renders it', () => {
    const onEdit = vi.fn()
    render(
      <SettingsSecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={onEdit}
      />,
    )
    const input = screen.getByLabelText('API key')

    fireEvent.change(input, { target: { value: 'ds-secret' } })

    expect(onEdit).toHaveBeenCalledWith('ds-secret')
    expect(input).toHaveProperty('type', 'password')
  })

  it('reports the configured state the Host holds', () => {
    const { rerender } = render(
      <SettingsSecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText('No key is configured.')).toBeTruthy()

    rerender(
      <SettingsSecretField
        {...secret}
        text="ds-secret"
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByText('A key is configured.')).toBeTruthy()
    expect(screen.getByLabelText('API key')).toHaveProperty('value', 'ds-secret')
  })

  it('disables the control when it is told to', () => {
    render(
      <SettingsSecretField
        {...secret}
        disabled
        text=""
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('API key')).toHaveProperty('disabled', true)
  })
})

/** The shared frame without its hint, for fields whose hint is optional. */
const { hint: _hint, ...hintless } = frame

describe('SettingsSwitchField', () => {
  const switchFrame = { ...hintless, label: 'Send the notice' }

  it('stages the toggled value as draft text', () => {
    const onEdit = vi.fn()
    const { rerender } = render(<SettingsSwitchField {...switchFrame} text="true" onEdit={onEdit} onReset={vi.fn()} />)
    const control = screen.getByRole('switch', { name: 'Send the notice' })
    expect(control.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(control)
    expect(onEdit).toHaveBeenLastCalledWith('false')

    rerender(<SettingsSwitchField {...switchFrame} text="false" onEdit={onEdit} onReset={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Send the notice' }))
    expect(onEdit).toHaveBeenLastCalledWith('true')
  })

  it('shows the hint, the override, and the reset when given them', () => {
    const onReset = vi.fn()
    const { rerender } = render(<SettingsSwitchField {...switchFrame} text="true" onEdit={vi.fn()} onReset={onReset} />)
    expect(screen.queryByText('How long one command may run.')).toBeNull()

    rerender(<SettingsSwitchField {...switchFrame} overridden hint="Shown below." text="true" onEdit={vi.fn()} onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(screen.getByText('Shown below.')).toBeTruthy()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('disables the switch with the form', () => {
    render(<SettingsSwitchField {...switchFrame} disabled text="true" onEdit={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Send the notice' })).toHaveProperty('disabled', true)
  })
})

describe('SettingsTextAreaField', () => {
  const areaFrame = { ...hintless, label: 'Replacement text' }

  it('stages multi-line text and renders what it is given', () => {
    const onEdit = vi.fn()
    render(<SettingsTextAreaField {...areaFrame} text="one" placeholder="Keep the original" onEdit={onEdit} onReset={vi.fn()} />)
    const area = screen.getByLabelText('Replacement text')
    expect(area.tagName).toBe('TEXTAREA')
    expect(area).toHaveProperty('value', 'one')
    expect(area.getAttribute('placeholder')).toBe('Keep the original')
    expect(area.getAttribute('rows')).toBe('3')
    fireEvent.change(area, { target: { value: 'one\ntwo' } })
    expect(onEdit).toHaveBeenCalledWith('one\ntwo')
  })

  it('describes itself with the hint, or with the invalid reason instead', () => {
    const { rerender } = render(<SettingsTextAreaField {...areaFrame} rows={6} text="" onEdit={vi.fn()} onReset={vi.fn()} />)
    const area = screen.getByLabelText('Replacement text')
    expect(area.getAttribute('rows')).toBe('6')
    expect(area.getAttribute('placeholder')).toBe('')
    expect(area.getAttribute('aria-describedby')).toBeNull()

    rerender(<SettingsTextAreaField {...areaFrame} hint="Use {{text}}." text="" onEdit={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByText('Use {{text}}.')).toBeTruthy()
    expect(screen.getByLabelText('Replacement text').getAttribute('aria-describedby')).toBe('field-message')

    rerender(<SettingsTextAreaField {...areaFrame} invalid hint="Use {{text}}." text="" onEdit={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByText('Enter a number.')).toBeTruthy()
    expect(screen.getByLabelText('Replacement text').getAttribute('aria-invalid')).toBe('true')
  })
})
