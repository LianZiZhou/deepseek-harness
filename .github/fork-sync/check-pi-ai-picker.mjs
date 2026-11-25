/** Check the provider options recorded by the Models and onboarding browser scenarios. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogProviderIds } from '../../packages/llm/llm-pi-ai/src/catalog.ts'

const options = [...catalogProviderIds()].sort()
for (const name of ['models-settings/empty', 'models-settings/native-keyless', 'onboarding-usable-provider/dismissed']) {
  const path = `apps/web/tests/expected/${name}.expected.md`
  const snapshot = readFileSync(path, 'utf8')
  const recorded = Array.from(snapshot.matchAll(/^ +- option "([^"]+)"/gm), match => match[1])
  assert.deepEqual(recorded, options, `Provider options changed. Refresh ${path} with its Web scenario.`)
}
