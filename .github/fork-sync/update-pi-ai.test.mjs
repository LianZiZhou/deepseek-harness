import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { updateSettings, verifyPatch, verifyResolution } from './update-pi-ai.mjs'

const cli = fileURLToPath(new URL('./update-pi-ai.mjs', import.meta.url))
const pkg = '@earendil-works/pi-ai'
const adapter = 'packages/llm/llm-pi-ai'
const oar = 'packages/experimental/subagent-oar'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-ai-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('equal and older versions exit before any installation or modification', t => {
  const root = fixture(t)
  mkdirSync(join(root, adapter), { recursive: true })
  const path = join(root, adapter, 'package.json')
  const original = JSON.stringify({ dependencies: { [pkg]: '^1.10.0' } })
  writeFileSync(path, original)
  for (const target of ['1.10.0', '1.9.99', '0.99.99']) {
    assert.match(execFileSync(process.execPath, [cli, target], { cwd: root, env: { PATH: '' }, encoding: 'utf8' }), /Skipping/u)
    assert.equal(readFileSync(path, 'utf8'), original)
  }
  for (const target of ['1.11.0-rc.1', '^1.11.0', 'latest', '01.11.0', '1.11.0+build']) {
    const result = spawnSync(process.execPath, [cli, target], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /exact stable version/u)
  }
})

test('carries every hunk, distinguishes manual retirement from drift and preserves the original bytes', t => {
  const root = fixture(t)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  const unpacked = join(root, 'package')
  mkdirSync(unpacked)
  const patch = join(root, 'fix.patch')
  const hunk = file => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-before\n+after\n`
  const bytes = hunk('capture.js') + hunk('replay.js')
  writeFileSync(patch, bytes)
  for (const file of ['capture.js', 'replay.js']) writeFileSync(join(unpacked, file), 'before\n')
  verifyPatch(unpacked, patch)
  writeFileSync(join(unpacked, 'capture.js'), 'after\n')
  assert.throws(() => verifyPatch(unpacked, patch), /Patch drift/u)
  writeFileSync(join(unpacked, 'replay.js'), 'after\n')
  assert.throws(() => verifyPatch(unpacked, patch), /Retire the patch manually.*Desktop.*OAR/u)
  writeFileSync(join(unpacked, 'replay.js'), 'other implementation\n')
  assert.throws(() => verifyPatch(unpacked, patch), /Patch drift/u)
  assert.equal(readFileSync(patch, 'utf8'), bytes)
})

test('reuses the documented patch path and advances only the adapter release-age and Desktop pins', () => {
  const patch = 'patches/@earendil-works__pi-ai@1.5.0.patch'
  const legacy = `  '${pkg}@1.3.0': patches/@earendil-works__pi-ai@1.3.0.patch\n`
  const workspace = "minimumReleaseAgeExclude:\n  - 'unrelated@1.5.0'\n"
    + [pkg, '@earendil-works/pi-schema', '@earendil-works/pi-telemetry'].map(name => `  - '${name}@1.5.0'\n`).join('')
    + `patchedDependencies:\n${legacy}  '${pkg}@1.5.0': ${patch}\n`
  const policy = `  '${pkg}@1.3.0': { scope: 'workspace-only' },\n  '${pkg}@1.5.0': { scope: 'shared', reason: 'Replay.' },\n`
    + `  '${pkg}@^1.5.0': '1.5.0',\n`
  const update = { current: '1.5.0', target: '1.6.0', patch }
  const carried = updateSettings(workspace, policy, update)
  assert.ok(carried.workspace.includes(`  '${pkg}@1.6.0': ${patch}\n`))
  assert.ok(carried.workspace.includes(legacy))
  assert.ok(carried.workspace.includes("'unrelated@1.5.0'"))
  assert.ok(carried.workspace.includes("'@earendil-works/pi-schema@1.6.0'"))
  assert.ok(carried.workspace.includes("'@earendil-works/pi-telemetry@1.6.0'"))
  assert.ok(carried.policy.includes(`'${pkg}@^1.6.0': '1.6.0'`))
  assert.ok(carried.policy.includes(`'${pkg}@1.6.0': { scope: 'shared'`))
  assert.ok(carried.policy.includes(`'${pkg}@1.3.0': { scope: 'workspace-only'`))
  assert.throws(() => updateSettings(workspace.replace('pi-schema@1.5.0', 'pi-schema@1.2.0'), policy, update), /pi-schema/u)
})

function lock(version, hash) {
  const spec = `${pkg}@${version}`
  const ref = version + (hash ? `(patch_hash=${hash})` : '') + '(shared@1.0.0)'
  const oarRef = '1.3.0(patch_hash=oar)'
  return {
    settings: { autoInstallPeers: true },
    patchedDependencies: { [`${pkg}@1.3.0`]: 'oar', ...hash && { [spec]: hash } },
    importers: {
      [adapter]: { dependencies: { [pkg]: { specifier: `^${version}`, version: ref } } },
      [oar]: { dependencies: { [pkg]: { specifier: '^1.3.0', version: oarRef } } },
    },
    packages: {
      [spec]: { resolution: { integrity: version } }, [`${pkg}@1.3.0`]: {},
      [`private-sdk@${version}`]: {}, 'shared@1.0.0': {},
    },
    snapshots: {
      [`${pkg}@${ref}`]: { dependencies: { 'private-sdk': version }, optionalDependencies: { shared: '1.0.0' } },
      [`private-sdk@${version}`]: {}, [`${pkg}@${oarRef}`]: { dependencies: { shared: '1.0.0' } },
      'shared@1.0.0': {},
    },
  }
}

function verify(candidate) {
  verifyResolution(lock('1.5.0', 'carry'), candidate, {
    current: '1.5.0', target: '1.6.0', hash: 'carry', integrity: '1.6.0',
  })
}

test('allows the new tarball and changes to its private dependencies', () => {
  verify(lock('1.6.0', 'carry'))
})

test('rejects a different tarball, version or patch', () => {
  const candidate = lock('1.6.0', 'carry')
  candidate.packages[`${pkg}@1.6.0`].resolution.integrity = 'other'
  assert.throws(() => verify(candidate), /tarball/u)
  assert.throws(() => verify(lock('1.6.0', 'unexpected')), /workspace patch policy/u)
  const newer = lock('1.6.0', 'carry')
  newer.importers[adapter].dependencies[pkg].version = '1.6.1'
  assert.throws(() => verify(newer), /adapter to resolve/u)
})

test('rejects a moved second importer, changed shared transitive or unrelated lock entry', () => {
  const cases = [
    [candidate => { candidate.importers[oar].dependencies[pkg].version = '1.6.0' }, /importers.*subagent-oar/u],
    [candidate => { candidate.snapshots[`${pkg}@1.3.0(patch_hash=oar)`].dependencies['private-sdk'] = '1.6.0' }, /Unrelated lockfile change/u],
    [candidate => { candidate.packages['shared@1.0.0'].resolution = { integrity: 'other' } }, /packages.*shared/u],
    [candidate => { candidate.patchedDependencies[`${pkg}@1.3.0`] = 'other' }, /patchedDependencies/u],
    [candidate => { candidate.snapshots['unrelated@1.0.0'] = {} }, /snapshots.*unrelated/u],
  ]
  for (const [change, expected] of cases) {
    const candidate = lock('1.6.0', 'carry')
    change(candidate)
    assert.throws(() => verify(candidate), expected)
  }
})
