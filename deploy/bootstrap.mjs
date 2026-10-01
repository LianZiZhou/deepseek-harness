#!/usr/bin/env node
/**
 * Rebuild this checkout's DSH home on a fresh machine from the snapshot in
 * `deploy/`.
 *
 * It restores composition only — the profile's plugin list, its disabled rows,
 * the home-level patch shared by every profile, and the user settings document — then installs the plugins and prints what
 * still has to be supplied by hand. Credentials are deliberately absent from
 * the snapshot, so the run ends with a checklist rather than a working login.
 *
 * Existing files are never overwritten without `--force`: a machine that
 * already has a profile is the case where a silent overwrite costs the most.
 */

import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOME = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
const force = process.argv.includes('--force')

/**
 * Credentials the snapshot cannot carry, named so a restore can ask for them.
 *
 * The environment variables are read from the snapshot itself rather than
 * listed here: a provider added on the source machine names a new variable,
 * and a hand-kept list is exactly the thing that forgets it.
 * @returns each credential to supply and why it is needed.
 */
function credentials() {
  const names = new Set()
  const patches = [
    ...manifest.profiles.map(profile => join(HERE, 'profile', profile, 'cordis.patch.yml')),
    join(HERE, 'cordis.patch.yml'),
  ]
  for (const patch of patches) {
    if (!existsSync(patch)) continue
    for (const match of readFileSync(patch, 'utf8').matchAll(/apiKeyEnv:\s*['"]?([A-Za-z_][A-Za-z0-9_]*)/g)) {
      names.add(match[1])
    }
  }
  return [
    ['$DSH_HOME/.credentials.yaml', 'provider keys and OAuth records, and the browser-session secret'],
    ...[...names].sort().map(name => [name, 'named as apiKeyEnv by a provider in the profile patch']),
  ]
}

/**
 * Restore one snapshot file into the DSH home.
 * @param from - absolute path inside the snapshot.
 * @param to - absolute destination path.
 * @param label - the path as the report should name it.
 * @returns what happened, for the summary.
 */
function restore(from, to, label) {
  if (!existsSync(from)) return { label, state: 'absent' }
  if (existsSync(to) && !force) return { label, state: 'kept' }
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
  return { label, state: 'written' }
}

const manifestPath = join(HERE, 'snapshot.json')
if (!existsSync(manifestPath)) {
  throw new Error('deploy/bootstrap: no snapshot.json; run `node deploy/export.mjs` on the source machine first.')
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const results = []

for (const profile of manifest.profiles) {
  for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
    results.push(restore(
      join(HERE, 'profile', profile, file),
      join(HOME, 'profiles', profile, file),
      `profiles/${profile}/${file}`,
    ))
  }
}
results.push(restore(join(HERE, 'cordis.patch.yml'), join(HOME, 'cordis.patch.yml'), 'cordis.patch.yml'))
results.push(restore(join(HERE, 'settings.yaml'), join(HOME, 'settings.yaml'), 'settings.yaml'))

for (const { label, state } of results) console.log(`  ${state.padEnd(7)} ${label}`)
const kept = results.filter(result => result.state === 'kept')
if (kept.length > 0) console.log(`\n${String(kept.length)} file(s) already existed and were kept; pass --force to overwrite.`)

// The plugin chain is npm and git dependencies, so it is fetched rather than
// carried: the snapshot pins versions through the profile's package.json.
for (const profile of manifest.profiles) {
  console.log(`\ndeploy/bootstrap: installing the ${profile} plugin chain`)
  const installed = spawnSync(
    process.execPath,
    [join(ROOT, 'apps/cli/lib/bin.js'), 'plugin', '--profile', profile, 'install'],
    { stdio: 'inherit', cwd: ROOT },
  )
  if (installed.status !== 0) {
    console.error(`deploy/bootstrap: plugin install failed for ${profile}; fix it and re-run.`)
    process.exitCode = 1
  }
}

console.log('\nStill to supply by hand — the snapshot carries no credentials:')
for (const [name, why] of credentials()) console.log(`  ${name}  (${why})`)
console.log(`\nThen: node apps/cli/lib/bin.js web   (DSH_HOME=${HOME})`)
