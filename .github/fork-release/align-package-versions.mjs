/** Align the DSH release family in the selected packaging checkout. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const { releaseFamily } = await import(pathToFileURL(join(root, 'scripts/release/families.ts')).href)
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (typeof version !== 'string' || version.length === 0) {
  throw new Error('The packaging checkout is missing its root package version')
}

const family = releaseFamily('dsh')
for (const member of family.members(root)) {
  if (member.version === version) continue
  const path = join(root, member.directory, 'package.json')
  writeFileSync(path, `${JSON.stringify({ ...member.manifest, version }, null, 2)}\n`)
  console.log(`Set ${member.name} to ${version}`)
}
family.verifyVersions(family.members(root))
