/** The page's staged form: one switch per row and one template per shape, and the rows the Host table defines. */
import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { Config } from '@deepseek-ai/dsh-context-injections'
import { CONTEXT_INJECTION_ROWS, isSwitchable, shippedTemplate, type ContextInjectionRow } from '@deepseek-ai/dsh-context-injections/src/rows.ts'
import { compileTemplate } from '@deepseek-ai/dsh-context-injections/src/template.ts'
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

  it('list each Host shape with its label key and the variables its template fills in', () => {
    const rows: readonly ContextInjectionRow[] = CONTEXT_INJECTION_ROWS
    expect(PAGE_ROWS.map(row => [row.id, row.variants.map(variant => [variant.id, variant.label, variant.variables])]))
      .toEqual(rows.map(row => [row.id, row.variants.map(variant => [
        variant.id,
        variant.id === '' ? undefined : `${row.id}.${variant.id}`,
        compileTemplate(variant.template).variables,
      ])]))
  })

  it('edit the namespace the shipped bundle mounts the Host row under', () => {
    expect(CONTEXT_INJECTIONS_NS).toBe('context-injections')
  })
})

describe('ContextInjectionsController', () => {
  it('projects a switch per row and a prefilled template per shape, and no switch for a section always stated', () => {
    const host = stubConfigForm<ContextInjectionsSettings>()
    const controller = new ContextInjectionsController(host.scope)
    host.publish({ status: 'ready', writable: true, value: section({ modelSwitchEnabled: false }), base: section({ modelSwitchEnabled: false }), user: {} })

    const { rows } = controller.inject().hooks.contextInjections.getSnapshot()
    expect(rows.map(row => row.id)).toEqual(PAGE_ROWS.map(row => row.id))
    expect(rows[0]).toEqual({
      id: 'modelSwitch',
      enabled: { text: 'false', overridden: false, invalid: false },
      variants: [{
        shape: PAGE_ROWS[0]?.variants[0],
        field: 'modelSwitchText',
        text: { text: shippedTemplate('modelSwitch'), overridden: false, invalid: false },
      }],
    })
    expect(rows.find(row => row.id === 'workingDirectory')).toEqual({
      id: 'workingDirectory',
      variants: [{
        shape: { id: '', variables: ['cwd'] },
        field: 'workingDirectoryText',
        text: { text: 'Current working directory: {{cwd}}.', overridden: false, invalid: false },
      }],
    })
    expect(rows.find(row => row.id === 'sandboxPolicy')?.variants.map(variant => variant.field)).toEqual([
      'sandboxPolicyReadOnlyText', 'sandboxPolicyWorkspaceWriteText', 'sandboxPolicyWorkspaceWriteRootsText', 'sandboxPolicyFullAccessText',
    ])
    controller.dispose()
  })

  it('saves a toggle and an edited template as one mutation', async () => {
    const host = stubConfigForm<ContextInjectionsSettings>()
    host.mutate.mockImplementation((_ops: readonly SettingsPathOpView[]) => Promise.resolve(true))
    const controller = new ContextInjectionsController(host.scope)
    host.publish({ status: 'ready', writable: true, value: section(), base: section(), user: {} })
    const face = controller.inject()

    face.edit(enabledField('timeContext'), 'false')
    face.edit(textField('sandboxPolicy', 'fullAccess'), 'Policy: {{text}}')
    face.save()

    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['timeContextEnabled'], value: false },
        { op: 'set', path: ['sandboxPolicyFullAccessText'], value: 'Policy: {{text}}' },
      ], undefined)
    })
  })
})
