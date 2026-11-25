import { describe, expect, it, vi } from 'vitest'

vi.mock('@earendil-works/pi-ai/providers/all', async (importOriginal) => {
  const models = {
    reseller: [{ type: 'chat', id: 'fixture-4.8', reasoning: true }],
    anthropic: [{ type: 'chat', id: 'fixture-4-8', reasoning: true }],
    'classifier-provider': [{ type: 'classifier', id: 'classifier-model', reasoning: false }],
    'uncataloged-provider': [],
  }
  return {
    ...await importOriginal<typeof import('@earendil-works/pi-ai/providers/all')>(),
    builtinProviders: () => Object.keys(models).map(id => ({ id })),
    getBuiltinModels: (provider: keyof typeof models) => models[provider].filter(model => model.type === 'chat'),
    getAllBuiltinModels: (provider: keyof typeof models) => models[provider],
  }
})

import { catalogModels, catalogProvider, catalogProviderIds, catalogReasoningFor } from '../src/catalog.ts'

describe('catalog provider ids', () => {
  it('drops a provider that lists only non-chat models and keeps one that lists none', () => {
    expect(catalogProviderIds()).toEqual(['reseller', 'anthropic', 'uncataloged-provider'])
  })

  it('answers no catalog provider or models for the provider it drops', () => {
    expect(catalogProvider('classifier-provider')).toBeUndefined()
    expect(catalogModels('classifier-provider').size).toBe(0)
    expect(catalogProvider('uncataloged-provider')).toEqual({ id: 'uncataloged-provider' })
    expect([...catalogModels('anthropic').keys()]).toEqual(['fixture-4-8'])
  })

  it('prefers the model maker even when a reseller matches the requested spelling exactly', () => {
    expect(catalogReasoningFor('fixture-4.8', 'openai-completions')).toMatchObject({
      provider: 'anthropic', model: { id: 'fixture-4-8' },
    })
  })
})
