/** Upgrade the workspace adapter from an exact stable npm release. Run from the repository root. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const pkg = '@earendil-works/pi-ai'
const companions = ['@earendil-works/pi-schema', '@earendil-works/pi-telemetry']
const adapter = 'packages/llm/llm-pi-ai'
const manifestPath = `${adapter}/package.json`
const workspacePath = 'pnpm-workspace.yaml'
const lockPath = 'pnpm-lock.yaml'
const policyPath = 'apps/desktop/scripts/runtime-patch-policy.ts'
const generated = [
  `${adapter}/src/provider-data.generated.ts`, 'THIRD_PARTY_NOTICES.md',
  'docs/config-catalog.md', 'docs/config-catalog.zh.md', 'docs/config-catalog.i18n.yaml',
]

function stableParts(version) {
  if (typeof version !== 'string' || !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/u.test(version)) {
    throw new Error(`Expected an exact stable version, received ${JSON.stringify(version)}`)
  }
  return version.split('.').map(BigInt)
}

function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error(`Expected exactly one occurrence of ${JSON.stringify(before)}`)
  }
  return source.replace(before, () => after)
}

/** Require every hunk to apply to the unpacked, unmodified npm release. */
export function verifyPatch(directory, patch) {
  // Isolate git apply even when the temporary directory is inside a checkout.
  execFileSync('git', ['init', '--quiet'], { cwd: directory })
  const check = (...flags) => {
    const result = spawnSync('git', ['apply', '--check', ...flags, resolve(patch)], { cwd: directory, encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || 'git apply failed')
    return result.status === 0
  }
  const forward = check()
  const reverse = check('--reverse')
  if (reverse && !forward) {
    throw new Error(`The release already contains ${patch}. Retire the patch manually after reviewing Desktop's workspace-only pi-ai rule for OAR.`)
  }
  if (!forward || reverse) throw new Error(`Patch drift in ${patch}. Review the hunks against the published release.`)
}

/** Update only the adapter's exact release-age exclusions, patch registration and Desktop override. */
export function updateSettings(workspace, policy, { current, target, patch }) {
  const oldSpec = `${pkg}@${current}`
  const newSpec = `${pkg}@${target}`
  for (const name of [pkg, ...companions]) {
    workspace = replaceOnce(workspace, `  - '${name}@${current}'\n`, `  - '${name}@${target}'\n`)
  }
  workspace = replaceOnce(workspace, `  '${oldSpec}': ${patch}\n`, `  '${newSpec}': ${patch}\n`)
  policy = replaceOnce(policy, `  '${oldSpec}': { scope: 'shared',`, `  '${newSpec}': { scope: 'shared',`)
  policy = replaceOnce(policy, `'${pkg}@^${current}': '${current}'`, `'${pkg}@^${target}': '${target}'`)
  policy = policy.replace(`// The provider declares ^${current}; its patch is qualified against ${current}.`,
    '// Pin Desktop to the workspace adapter\'s reviewed pi-ai release.')
  return { workspace, policy }
}

function packageSnapshot(lock, version, hash) {
  const entry = lock.importers[adapter].dependencies[pkg]
  if (entry.specifier !== `^${version}` || entry.version.split('(')[0] !== version ||
      lock.patchedDependencies?.[`${pkg}@${version}`] !== hash ||
      entry.version.match(/^[^(]+\(patch_hash=([^()]+)\)/u)?.[1] !== hash) {
    throw new Error(`Expected the adapter to resolve ${pkg}@${version} with its workspace patch policy`)
  }
  const id = `${pkg}@${entry.version}`
  if (!Object.hasOwn(lock.snapshots, id)) throw new Error(`Missing lockfile snapshot ${id}`)
  return id
}

function closure(lock, roots) {
  const found = new Set(roots)
  for (const id of found) {
    const node = lock.snapshots[id]
    for (const [name, ref] of Object.entries({ ...node.dependencies, ...node.optionalDependencies })) {
      const child = Object.hasOwn(lock.snapshots, ref) ? ref : `${name}@${ref}`
      if (Object.hasOwn(lock.snapshots, child)) found.add(child)
    }
  }
  return found
}

/** Keep every lock entry except packages reached exclusively through the adapter's pi-ai edge. */
function independentPins(lock, version, hash) {
  const id = packageSnapshot(lock, version, hash)
  delete lock.importers[adapter].dependencies[pkg]
  delete lock.patchedDependencies[`${pkg}@${version}`]
  const roots = []
  for (const importer of Object.values(lock.importers)) {
    for (const [name, entry] of Object.entries({ ...importer.dependencies, ...importer.devDependencies, ...importer.optionalDependencies })) {
      const key = Object.hasOwn(lock.snapshots, entry.version) ? entry.version : `${name}@${entry.version}`
      if (Object.hasOwn(lock.snapshots, key)) roots.push(key)
    }
  }
  const shared = closure(lock, roots)
  const sharedPackages = new Set(Array.from(shared, key => key.split('(')[0]))
  for (const key of closure(lock, [id])) {
    if (!shared.has(key)) delete lock.snapshots[key]
    const base = key.split('(')[0]
    if (!sharedPackages.has(base)) delete lock.packages[base]
  }
}

/** Consume two parsed lockfiles and reject changes outside the upgraded package's dependencies. */
export function verifyResolution(before, after, { current, target, hash, integrity }) {
  const release = after.packages[`${pkg}@${target}`]
  if (release?.resolution?.integrity !== integrity) throw new Error(`Resolved tarball differs from npm pack for ${pkg}@${target}`)
  independentPins(before, current, hash)
  independentPins(after, target, hash)
  for (const section of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isDeepStrictEqual(before[section], after[section])) continue
    const changed = [...new Set([...Object.keys(before[section] ?? {}), ...Object.keys(after[section] ?? {})])]
      .find(key => !isDeepStrictEqual(before[section]?.[key], after[section]?.[key]))
    throw new Error(`Unrelated lockfile change in ${section}${changed ? ` / ${changed}` : ''}`)
  }
}

function runPnpm(...args) {
  execFileSync('pnpm', args, { stdio: 'inherit', env: { ...process.env, CI: 'true' } })
}

function update(target) {
  const requested = stableParts(target)
  const manifest = readFileSync(manifestPath, 'utf8')
  const range = JSON.parse(manifest).dependencies[pkg]
  if (!range?.startsWith('^')) throw new Error(`Expected a caret dependency on ${pkg} in ${manifestPath}`)
  const current = range.slice(1)
  const installed = stableParts(current)
  const first = requested.findIndex((part, index) => part !== installed[index])
  if (first === -1 || requested[first] < installed[first]) {
    console.log(`Skipping ${pkg}@${target}. The adapter already requires ^${current}.`)
    return
  }

  const files = new Map([manifestPath, workspacePath, lockPath, policyPath, ...generated].map(path => [path, readFileSync(path, 'utf8')]))
  const temp = mkdtempSync(join(tmpdir(), 'dsh-pi-ai-'))
  let writing = false
  try {
    const archive = execFileSync('npm', ['pack', '--ignore-scripts', '--silent', '--registry=https://registry.npmjs.org',
      `${pkg}@${target}`], { cwd: temp, encoding: 'utf8' }).trim()
    const integrity = 'sha512-' + createHash('sha512').update(readFileSync(join(temp, archive))).digest('base64')
    execFileSync('tar', ['-xzf', archive], { cwd: temp })
    const unpacked = join(temp, 'package')
    const release = JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8'))
    if (release.name !== pkg || release.version !== target) throw new Error('npm pack returned a different package or version')
    const siblings = Object.keys(release.dependencies).filter(name => name.startsWith('@earendil-works/')).sort()
    if (!isDeepStrictEqual(siblings, companions) || companions.some(name => release.dependencies[name] !== target)) {
      throw new Error(`Review the release-age exclusions for ${pkg}@${target}: ${JSON.stringify(release.dependencies)}`)
    }

    const patches = JSON.parse(execFileSync('pnpm', ['config', 'get', 'patchedDependencies', '--json'], { encoding: 'utf8' }))
    const patch = patches?.[`${pkg}@${current}`]
    if (!patch) throw new Error(`Missing workspace patch for ${pkg}@${current}. Review its Desktop patch policy.`)
    verifyPatch(unpacked, patch)
    const hash = createHash('sha256').update(readFileSync(patch)).digest('hex')
    const { workspace, policy } = updateSettings(files.get(workspacePath), files.get(policyPath), {
      current, target, patch: relative(process.cwd(), patch),
    })
    const nextManifest = replaceOnce(manifest, `"${pkg}": "^${current}"`, `"${pkg}": "^${target}"`)
    console.log(`Updating ${pkg} from ${current} to ${target} with ${relative(process.cwd(), patch)}.`)
    writing = true
    writeFileSync(manifestPath, nextManifest)
    writeFileSync(workspacePath, workspace)
    writeFileSync(policyPath, policy)
    runPnpm('--filter', `./${adapter}`, 'install', '--lockfile-only', '--no-frozen-lockfile', '--config.resolution-mode=lowest-direct')
    runPnpm('install', '--frozen-lockfile')
    const yaml = createRequire(resolve('package.json'))('js-yaml')
    verifyResolution(yaml.load(files.get(lockPath)), yaml.load(readFileSync(lockPath, 'utf8')), { current, target, hash, integrity })
    if (readFileSync(workspacePath, 'utf8') !== workspace || readFileSync(manifestPath, 'utf8') !== nextManifest) {
      throw new Error('pnpm changed additional workspace settings or adapter requirements')
    }
    for (const script of ['gen-provider-data', 'gen-config-catalog', 'gen-third-party-notices']) runPnpm('run', script)
  } catch (error) {
    if (writing) for (const [path, contents] of files) writeFileSync(path, contents)
    throw error
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  if (process.argv.length !== 3) throw new Error('Usage: node .github/fork-sync/update-pi-ai.mjs VERSION')
  update(process.argv[2])
}
