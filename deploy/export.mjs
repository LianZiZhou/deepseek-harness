#!/usr/bin/env node
/**
 * Snapshot this machine's DSH home into `deploy/` so the checkout can rebuild
 * it elsewhere.
 *
 * Only the composition is copied: which plugins the profile mounts, which rows
 * it disables, and the user settings document. Credentials are never read —
 * `.credentials.yaml` holds them, every provider in `settings.yaml` names its
 * key through `apiKeyEnv` rather than carrying one, and the restore side asks
 * for both by hand. Sessions, attachments, logs and market caches are private
 * runtime state, not composition, so they stay where they are.
 *
 * Run it again whenever the plugin chain changes; the output is meant to be
 * reviewed in `git diff` before it is committed.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')

/** Files that describe a profile's composition, relative to the profile directory. */
const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']

/**
 * Patterns that must never appear in an exported file.
 *
 * A snapshot is destined for a git remote, so this refuses rather than warns:
 * a secret noticed after the push has already leaked, and rewriting history is
 * a far worse afternoon than re-running this script.
 */
const FORBIDDEN = [
  { name: 'an inline API key', pattern: /\b(api[_-]?key|secret|password|passwd)\s*:\s*\S/i },
  { name: 'an OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{16,}/ },
  { name: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'a bearer token', pattern: /\bbearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: 'a URL carrying credentials', pattern: /https?:\/\/[^\s/]*:[^\s/]*@/ },
]

/**
 * Refuse a file that carries something a public remote must never see.
 * @param label - the path as the report should name it.
 * @param text - the file's contents.
 * @throws when any forbidden pattern matches.
 */
function assertNoSecrets(label, text) {
  for (const { name, pattern } of FORBIDDEN) {
    const found = pattern.exec(text)
    if (found === null) continue
    const line = text.slice(0, found.index).split('\n').length
    throw new Error(
      `deploy/export: refusing to snapshot ${label}: line ${String(line)} looks like ${name}. `
      + 'Move it into $DSH_HOME/.credentials.yaml or an environment variable, then run this again.',
    )
  }
}

/**
 * Copy one file into the snapshot after checking it.
 * @param from - absolute source path.
 * @param to - absolute destination path.
 * @param label - the path as the report should name it.
 * @returns whether the file existed and was copied.
 */
function snapshot(from, to, label) {
  if (!existsSync(from)) return false
  assertNoSecrets(label, readFileSync(from, 'utf8'))
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
  return true
}

const profiles = process.argv.slice(2).filter(argument => !argument.startsWith('-'))
const wanted = profiles.length > 0 ? profiles : ['web']
const copied = []

rmSync(join(HERE, 'profile'), { recursive: true, force: true })
for (const profile of wanted) {
  const source = join(HOME, 'profiles', profile)
  if (!existsSync(source)) {
    throw new Error(`deploy/export: ${HOME}/profiles/${profile} does not exist; pass the profile names to snapshot.`)
  }
  for (const file of PROFILE_FILES) {
    const label = `profiles/${profile}/${file}`
    if (snapshot(join(source, file), join(HERE, 'profile', profile, file), label)) copied.push(label)
  }
}

if (snapshot(join(HOME, 'settings.yaml'), join(HERE, 'settings.yaml'), 'settings.yaml')) {
  copied.push('settings.yaml')
}

writeFileSync(
  join(HERE, 'snapshot.json'),
  `${JSON.stringify({ profiles: wanted, files: copied, takenAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
)

console.log(`deploy/export: snapshotted ${String(copied.length)} file(s) from ${HOME}`)
for (const file of copied) console.log(`  ${file}`)
console.log('Review `git diff deploy/` before committing — this is what a redeploy will restore.')
