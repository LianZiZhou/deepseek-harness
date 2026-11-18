/** The page's staged form: one switch and one text per row, and the rows the Host table defines. */
import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { Config } from '@deepseek-ai/dsh-context-injections'
import { CONTEXT_INJECTION_ROWS, isSwitchable } from '@deepseek-ai/dsh-context-injections/src/rows.ts'
import { ContextInjectionsController, enabledField, textField, type ContextInjectionsSettings } from '../src/client/controller.ts'
import { CONTEXT_INJECTIONS_NS, PAGE_ROWS } from '../src/client/rows.ts'

/** The section a Host serves with every field at its default, plus `overrides`. */
function section(overrides: Record<string, boolean | string> = {}): ContextInjectionsSettings {
  const resolved: Record<string, { get: () => boolean | string }> = Config({})
  const defaults = Object.fromEntries(Object.entries(resolved).map(([field, value]) => [field, value.get()]))
  return { ...defaults, ...overrides }
}

describe('page rows', () => {
  it('match the Host row table in order, group, and switchability', () => {
    expect(PAGE_ROWS.map(row => [row.id, row.group === 'notice' ? 'message' : 'section', row.switchable]))
      .toEqual(CONTEXT_INJECTION_ROWS.map(row => [row.id, row.target, isSwitchable(row)]))
  })

  it('edit the namespace the shipped bundle mounts the Host row under', () => {
    expect(CONTEXT_INJECTIONS_NS).toBe('context-injections')
  })
})

describe('ContextInjectionsController', () => {
  it('projects a switch and a text per row, and only a text for a section always stated', () => {
    const host = stubConfigForm<ContextInjectionsSettings>()
    const controller = new ContextInjectionsController(host.scope)
    host.publish({ status: 'ready', writable: true, value: section({ modelSwitchEnabled: false }), base: section({ modelSwitchEnabled: false }), user: {} })

    const { rows } = controller.inject().hooks.contextInjections.getSnapshot()
    expect(rows.map(row => row.id)).toEqual(PAGE_ROWS.map(row => row.id))
    expect(rows[0]).toEqual({
      id: 'modelSwitch',
      enabled: { text: 'false', overridden: false, invalid: false },
      text: { text: '', overridden: false, invalid: false },
    })
    expect(rows.find(row => row.id === 'workingDirectory')).toEqual({ id: 'workingDirectory', text: { text: '', overridden: false, invalid: false } })
    controller.dispose()
  })

  it('saves a toggle and a replacement text as one mutation', async () => {
    const host = stubConfigForm<ContextInjectionsSettings>()
    host.mutate.mockImplementation((_ops: readonly SettingsPathOpView[]) => Promise.resolve(true))
    const controller = new ContextInjectionsController(host.scope)
    host.publish({ status: 'ready', writable: true, value: section(), base: section(), user: {} })
    const face = controller.inject()

    face.edit(enabledField('timeContext'), 'false')
    face.edit(textField('sandboxPolicy'), 'Policy: {{text}}')
    face.save()

    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['timeContextEnabled'], value: false },
        { op: 'set', path: ['sandboxPolicyText'], value: 'Policy: {{text}}' },
      ], undefined)
    })
  })
})
