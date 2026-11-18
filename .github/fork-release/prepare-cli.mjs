/** Finish the deployed CLI using the staging rules from the commit being packaged. */
import { copyFile, cp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const stage = process.argv[2]
const sourceModule = name => import(pathToFileURL(resolve('scripts', name)).href)
const { materializeStagedLinks, deduplicateStagedWorkspacePackages } = await sourceModule('build-exe-for-python-sdk-staging.ts')
const { verifyStagedDependencies } = await sourceModule('executable-packaging.ts')
await materializeStagedLinks(stage)
await deduplicateStagedWorkspacePackages(stage, stage)
await verifyStagedDependencies(stage)

const release = JSON.parse(process.env.FORK_RELEASE)
const runtimeVersion = join(stage, 'node_modules/@deepseek-ai/dsh-app-boot/package.json')
const manifest = JSON.parse(await readFile(runtimeVersion, 'utf8'))
manifest.version = release.version
await writeFile(runtimeVersion, JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(stage, 'fork-release.json'), JSON.stringify({ schemaVersion: 1, ...release }, null, 2) + '\n')

const windows = process.platform === 'win32'
const runtime = join(stage, 'runtime')
const bin = join(runtime, 'bin')
const { downloadNodeRuntime } = await sourceModule('primary-runtime/prepare.ts')
await downloadNodeRuntime(process.argv[3], runtime, join(dirname(stage), 'downloads'))
await cp(resolve('apps/desktop/node_modules/pnpm'), join(runtime, 'pnpm'), { recursive: true, dereference: true })
await copyFile(resolve('LICENSE'), join(stage, 'LICENSE'))
if (windows) {
  await writeFile(join(stage, 'dsh.cmd'), '@echo off\r\nsetlocal\r\nset "PATH=%~dp0runtime\\bin;%PATH%"\r\n"%~dp0runtime\\bin\\node.exe" "%~dp0node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*\r\n')
  await writeFile(join(bin, 'pnpm.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0..\\pnpm\\bin\\pnpm.mjs" %*\r\n')
} else {
  await writeFile(join(stage, 'dsh'), '#!/bin/sh\nroot=$(CDPATH= cd -P "$(dirname "$0")" && pwd) || exit 1\nexport PATH="$root/runtime/bin:$PATH"\nexec "$root/runtime/bin/node" "$root/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"\n', { mode: 0o755 })
  await writeFile(join(bin, 'pnpm'), '#!/bin/sh\nbin=$(CDPATH= cd -P "$(dirname "$0")" && pwd) || exit 1\nexec "$bin/node" "$bin/../pnpm/bin/pnpm.mjs" "$@"\n', { mode: 0o755 })
}
