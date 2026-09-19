import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope, ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { Config, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

async function mount(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, config)
  return ctx
}

async function mintScope(ctx: Context, name: string): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name }) },
    { inject: ['systemPrompt'] }))
  return scope
}

function scopeKeyOf(scope: Scope): ScopeKey {
  return scopeOf(scope.ctx)!
}

/** Replace every section with one named contribution, keeping the rest intact. */
function onlySection(name: string, text: string) {
  return (assembly: PromptAssembly): PromptAssembly => ({ ...assembly, sections: [{ name, text }] })
}

describe('systemPrompt.finalize()', () => {
  it('returns exactly what the finalizer produced', async () => {
    const ctx = await mount({ includeHarnessIdentity: true })
    ctx.systemPrompt.finalize(onlySection('final', 'only this'))

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections).toEqual([{ name: 'final', text: 'only this' }])
    expect(renderPrompt(assembly)).toBe('only this')
  })

  it('runs after the assembly waterfall, so it sees every listener contribution', async () => {
    const ctx = await mount()
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      result.sections.push({ name: 'listener:extra', text: 'from the listener' })
      return result
    })
    const seen: string[][] = []
    ctx.systemPrompt.finalize((assembly) => {
      seen.push(assembly.sections.map(section => section.name))
      return assembly
    })

    await ctx.systemPrompt.assemble()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('listener:extra')
  })

  it('runs after a complete section is restored, and overrides it', async () => {
    const ctx = await mount({ includeHarnessIdentity: true })
    ctx.systemPrompt.section({ name: 'takeover', order: 1, text: 'complete prompt', complete: true })
    const seen: string[][] = []
    ctx.systemPrompt.finalize((assembly) => {
      seen.push(assembly.sections.map(section => section.name))
      return onlySection('final', 'the finalizer wins')(assembly)
    })

    const assembly = await ctx.systemPrompt.assemble()
    // The complete section was already the sole section when the override ran.
    expect(seen[0]).toEqual(['takeover'])
    expect(renderPrompt(assembly)).toBe('the finalizer wins')
  })

  it('runs after runtime-context suppression, and may still add contexts back', async () => {
    const ctx = await mount({ includeRuntimeContext: false })
    ctx.systemPrompt.context({ name: 'runtime:policy', order: 1, text: 'suppressed' })
    const seen: number[] = []
    ctx.systemPrompt.finalize((assembly) => {
      seen.push(assembly.contexts.length)
      return { ...assembly, contexts: [{ name: 'final:context', text: 'restored' }] }
    })

    const assembly = await ctx.systemPrompt.assemble()
    expect(seen).toEqual([0])
    expect(assembly.contexts).toEqual([{ name: 'final:context', text: 'restored' }])
  })

  it('receives the assembly context and awaits an asynchronous finalizer', async () => {
    const ctx = await mount()
    const signal = new AbortController().signal
    ctx.systemPrompt.finalize(async (assembly, context) => {
      await Promise.resolve()
      return { ...assembly, variables: { ...assembly.variables, preview: String(context.preview === true) } }
    })

    const assembly = await ctx.systemPrompt.assemble({ signal, preview: true })
    expect(assembly.variables['preview']).toBe('true')
  })

  it('refuses a second registration in the same layer until the first is disposed', async () => {
    const ctx = await mount()
    const dispose = ctx.systemPrompt.finalize(assembly => assembly)
    expect(() => ctx.systemPrompt.finalize(assembly => assembly))
      .toThrow(/global prompt finalizer is already registered/)

    dispose()
    expect(() => ctx.systemPrompt.finalize(assembly => assembly)).not.toThrow()
  })

  it('leaves the assembly untouched once the registration is disposed, and disposal is idempotent', async () => {
    const ctx = await mount({ includeHarnessIdentity: true })
    const dispose = ctx.systemPrompt.finalize(onlySection('final', 'overridden'))
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('overridden')

    dispose()
    dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble()))
      .toBe('You are an AI agent powered by DeepSeek Harness.')
  })

  it('emits system-prompt/change on registration and on disposal', async () => {
    const ctx = await mount()
    const changed = vi.fn()
    ctx.on('system-prompt/change', changed)

    const dispose = ctx.systemPrompt.finalize(assembly => assembly)
    expect(changed).toHaveBeenCalledTimes(1)
    dispose()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('refuses a second override in one scope with the diagnostic that scope owns', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'child')
    scope.ctx.systemPrompt.finalize(assembly => assembly)

    expect(() => scope.ctx.systemPrompt.finalize(assembly => assembly))
      .toThrow('a prompt finalizer is already registered in this scope')
    // The global layer is a separate layer, so it still admits one.
    expect(() => ctx.systemPrompt.finalize(assembly => assembly)).not.toThrow()
  })

  it('shadows the global override for its own scope only', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'child')
    ctx.systemPrompt.finalize(onlySection('final', 'global override'))
    scope.ctx.systemPrompt.finalize(onlySection('final', 'scoped override'))

    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeKeyOf(scope) })))
      .toBe('scoped override')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('global override')
  })

  it('lets a scope register its own override while a global one is live', async () => {
    const ctx = await mount({ includeHarnessIdentity: true })
    const scope = await mintScope(ctx, 'child')
    scope.ctx.systemPrompt.finalize(onlySection('final', 'scoped only'))

    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeKeyOf(scope) })))
      .toBe('scoped only')
    expect(renderPrompt(await ctx.systemPrompt.assemble()))
      .toBe('You are an AI agent powered by DeepSeek Harness.')
  })
})
