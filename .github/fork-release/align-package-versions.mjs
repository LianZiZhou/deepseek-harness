/** Align the DSH release family in the selected packaging checkout. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const root = process.cwd()
const { releaseFamily } = await import(pathToFileURL(join(root, 'scripts/release/families.ts')).href)
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (typeof version !== 'string' || version.length === 0) {
  throw new Error('The packaging checkout is missing its root package version')
}

const family = releaseFamily('dsh')
const members = family.members(root)
if (process.argv[2] === '--verify-checkout') {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const commit = git('rev-parse', 'HEAD').trim()
  const release = JSON.parse(process.env.FORK_RELEASE ?? '')
  if (release.commit !== commit) throw new Error('The packaging checkout does not match the selected release commit')
  if (members.some(member => member.version !== version)) throw new Error('The DSH release family is not aligned')
  if (git('ls-files', '--others', '--exclude-standard', '-z') !== '') {
    throw new Error('The packaging checkout contains untracked files')
  }
  if (git('diff', '--summary', 'HEAD', '--').trim() !== '') {
    throw new Error('The packaging checkout contains file or mode changes')
  }
  const manifests = git('diff', '--name-only', '--no-renames', '-z', 'HEAD', '--').split('\0').filter(Boolean)
  const manifestByPath = new Map(members.map(member => [`${member.directory}/package.json`, member.manifest]))
  for (const path of manifests) {
    const manifest = manifestByPath.get(path)
    if (manifest === undefined) throw new Error(`Unexpected change in the packaging checkout: ${path}`)
    const original = JSON.parse(git('show', `${commit}:${path}`))
    if (original.version === version || !isDeepStrictEqual(manifest, { ...original, version })) {
      throw new Error(`Expected a version-only change in the packaging checkout: ${path}`)
    }
  }
  console.log(JSON.stringify({ commit, manifests }))
} else if (process.argv[2] === undefined) {
  for (const member of members) {
    if (member.version === version) continue
    const path = join(root, member.directory, 'package.json')
    writeFileSync(path, `${JSON.stringify({ ...member.manifest, version }, null, 2)}\n`)
    console.log(`Set ${member.name} to ${version}`)
  }
  family.verifyVersions(family.members(root))
} else {
  throw new Error('Usage: align-package-versions.mjs [--verify-checkout]')
}
