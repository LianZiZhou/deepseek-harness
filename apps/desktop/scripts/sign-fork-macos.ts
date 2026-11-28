/** Sign an isolated Apple Silicon release from materialized application files. */
import { execFileSync } from 'node:child_process'
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { build, Platform, Arch, type Configuration } from 'electron-builder'
import { createElectronBuilderConfig } from './electron-builder-config.mjs'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { validateDesktopBuildVersion } from './desktop-build-version.mjs'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from './desktop-package-environment.mjs'
import { resolveDesktopAppId, resolveMacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { signForkCuaApplications, verifyForkCuaApplications } from './fork-macos-cua.ts'
import { resolveMacOSAppUpdateFeed, writeMacOSAppUpdateConfig } from './macos-app-update-config.mjs'
import { withMacOSSigningKeychain } from './macos-signing-keychain.mjs'
import { signMacOSRuntime } from './macos-runtime.ts'
import { packageMacOSArtifacts, type DesktopPrepackagedArtifact } from './package-macos.ts'
import { verifyMacOSNotarizedApplication } from './verify-macos-signature.mjs'
import { packagingErrorDetails } from './packaging-step.mjs'
import { verifyRuntimeArchive } from './verify-runtime-archive.ts'
import { verifyDesktopRuntime, writeDesktopRuntimeAsync, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

const appRoot = resolve(import.meta.dirname, '..')
const target = { platform: 'darwin', arch: 'arm64' } as const
const cuaProvider = join('node_modules', '@deepseek-ai', 'dsh-cua-macos')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sourceManifest(commit: string, path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(execFileSync('git', ['show', `${commit}:${path}`], { cwd: appRoot, encoding: 'utf8' }))
  if (!isRecord(value)) throw new Error(`fork macOS signing: invalid source manifest ${path}`)
  return value
}

/**
 * Verify which release-family manifests the packaging checkout aligned.
 * @param value - version alignment record from the verified packaging checkout.
 * @param commit - selected release commit.
 * @param version - DSH release-family version at the selected commit.
 * @param readManifest - reads a manifest from the selected commit.
 * @returns whether the packaging checkout had approved version edits.
 */
export function validateForkMacOSCheckoutAlignment(
  value: unknown, commit: string, version: string, readManifest: (path: string) => Record<string, unknown>,
): boolean {
  if (!isRecord(value) || value.commit !== commit || !Array.isArray(value.manifests)) {
    throw new Error('fork macOS signing: invalid checkout alignment record')
  }
  const manifests: readonly unknown[] = value.manifests
  const seen = new Set<string>()
  for (const path of manifests) {
    if (typeof path !== 'string' || !/^(?:apps\/[a-z0-9-]+|packages\/[a-z0-9-]+\/[a-z0-9-]+)\/package\.json$/u.test(path)
      || seen.has(path)) {
      throw new Error('fork macOS signing: invalid aligned manifest path')
    }
    seen.add(path)
    const original = readManifest(path)
    if (typeof original.name !== 'string' || !original.name.startsWith('@deepseek-ai/') || original.private === true
      || typeof original.version !== 'string' || original.version === version) {
      throw new Error(`fork macOS signing: unexpected aligned manifest ${path}`)
    }
  }
  return seen.size > 0
}

async function verifyUpdateZip(archive: string, shipsCua: boolean, environment: NodeJS.ProcessEnv): Promise<void> {
  const directory = await mkdtemp(join(dirname(archive), 'verify-zip-'))
  try {
    execFileSync('/usr/bin/ditto', ['-x', '-k', archive, directory])
    const app = join(directory, 'DeepSeek Harness.app')
    verifyMacOSNotarizedApplication(app, resolveMacOSSigningEnvironment(environment))
    if (shipsCua) verifyForkCuaApplications(join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'dsh', cuaProvider), environment)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Assemble the verified inputs without running package scripts or native binaries from the release checkout.
 * @param paths Materialized inputs with dsh under the shell app directory, and signing output paths.
 * @param descriptor Runtime inventory after native signing.
 * @param buildVersion Version offered by the selected release channel.
 * @param electronVersion Version of the bundled Electron distribution.
 * @param environment Builder settings with release identity, channel, and notarization configuration.
 * @returns Electron-builder configuration for the signed app and its distribution artifacts.
 */
export function createForkMacOSBuilderConfig(
  paths: ReturnType<typeof desktopTargetBuildPaths>, descriptor: DesktopRuntimeDescriptor,
  buildVersion: string, electronVersion: string, environment: NodeJS.ProcessEnv,
): Configuration {
  const shell = dirname(paths.dsh)
  const config = createElectronBuilderConfig(environment, 'darwin', target.arch, paths.dsh)
  return {
    appId: config.appId, productName: 'DeepSeek Harness', copyright: config.copyright, artifactName: config.artifactName,
    protocols: config.protocols.map(({ name, schemes }) => ({ name, schemes: [...schemes] })),
    electronVersion, electronDist: paths.electron, electronFuses: { runAsNode: true },
    directories: { output: environment.DSH_DESKTOP_UNSIGNED === '1' ? paths.unsignedArtifacts : paths.artifacts, app: shell },
    beforeBuild: async () => false,
    beforePack: config.beforePack,
    extraMetadata: { ...config.extraMetadata, version: validateDesktopBuildVersion(buildVersion, descriptor.release.version) },
    asar: true, asarUnpack: [...config.asarUnpack],
    extraResources: config.extraResources.map(resource => resource.to === 'runtime' ? { ...resource, from: paths.runtime } : resource),
    files: [
      ...config.files.map(file => typeof file === 'string' ? file : { ...file, filter: [...file.filter] }),
      { from: join(shell, 'node_modules'), to: 'node_modules', filter: ['**/*'] },
    ],
    mac: { ...config.mac, identity: config.mac.identity ?? null, notarize: false, signIgnore: [...config.mac.signIgnore] },
    dmg: config.dmg,
    publish: config.publish && [...config.publish],
    async afterPack(context) {
      const resources = context.packager.getResourcesDir(context.appOutDir)
      if (config.publish !== null) {
        await writeMacOSAppUpdateConfig(resources, resolveMacOSAppUpdateFeed(config.publish), context.packager.appInfo.updaterCacheDirName)
      }
      await verifyRuntimeArchive(join(resources, 'app.asar'), descriptor)
    },
    afterSign: config.afterSign,
    artifactBuildCompleted: config.artifactBuildCompleted,
  }
}

async function signForkMacOS(output: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const release: unknown = JSON.parse(process.env.FORK_RELEASE ?? '')
  if (!isRecord(release) || typeof release.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u.test(release.version)
    || typeof release.commit !== 'string' || !/^[a-f0-9]{40}$/u.test(release.commit) || release.channel !== environment.DSH_DESKTOP_UPDATE_CHANNEL) {
    throw new Error('fork macOS signing: invalid release identity')
  }
  const { version, commit } = release
  const inputs = desktopTargetBuildPaths('mac-arm64', environment)
  const shell = join(inputs.root, 'shell')
  const paths = { ...inputs, dsh: join(shell, 'dsh') }
  const source = sourceManifest(commit, 'apps/desktop/package.json')
  if (typeof source.version !== 'string') throw new Error('fork macOS signing: missing source product version')
  const alignmentPath = join(shell, 'checkout-alignment.json')
  if (!(await lstat(alignmentPath)).isFile()) throw new Error('fork macOS signing: missing regular checkout alignment record')
  const alignment: unknown = JSON.parse(await readFile(alignmentPath, 'utf8'))
  const aligned = validateForkMacOSCheckoutAlignment(alignment, commit, source.version, path => sourceManifest(commit, path))
  const shellManifest = join(shell, 'package.json')
  if (!(await lstat(shellManifest)).isFile()) throw new Error('fork macOS signing: missing regular shell manifest')
  const manifest: unknown = JSON.parse(await readFile(shellManifest, 'utf8'))
  if (!isRecord(manifest) || manifest.name !== '@deepseek-ai/dsh-desktop' || manifest.main !== 'lib/main.js'
    || manifest.version !== version || manifest.dshBuildCommit !== commit || manifest.dshBuildDirty !== aligned) {
    throw new Error('fork macOS signing: unsigned shell does not match the selected release')
  }
  const cli = sourceManifest(commit, 'apps/cli/package.json')
  if (!isRecord(cli.dependencies)) throw new Error('fork macOS signing: missing CLI dependencies')
  const shipsCua = '@deepseek-ai/dsh-cua-bundle' in cli.dependencies
  // Electron-builder matches asarUnpack against source paths relative to the app directory.
  await rename(inputs.dsh, paths.dsh)
  const descriptor = await verifyDesktopRuntime(paths.dsh, source.version, target)
  const electronVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString',
    join(paths.electron, 'Electron.app/Contents/Info.plist')], { encoding: 'utf8' }).trim()
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(electronVersion)) throw new Error('fork macOS signing: invalid prepared Electron version')

  // electron-builder treats its app manifest as configuration; carry only the runtime fields.
  const sanitized = join(shell, 'packaging-package.json')
  await writeFile(sanitized, JSON.stringify({
    name: '@deepseek-ai/dsh-desktop', version, main: 'lib/main.js', type: 'module', private: true,
    description: 'DeepSeek Harness Desktop', license: 'MIT', author: { name: 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.' },
  }), { flag: 'wx' })
  await rename(sanitized, shellManifest)
  await rm(alignmentPath)

  const identity = resolveMacOSSigningEnvironment(environment)
  const appId = resolveDesktopAppId(environment)
  await withMacOSSigningKeychain(environment, async (selected) => {
    const previous = process.env.CSC_KEYCHAIN
    process.env.CSC_KEYCHAIN = selected.CSC_KEYCHAIN
    try {
      if (shipsCua) await signForkCuaApplications(join(paths.dsh, cuaProvider), selected)
      await signMacOSRuntime(paths.dsh, appId, identity, target.arch)
      await signMacOSRuntime(join(paths.runtime, 'primary-runtime'), appId, identity, target.arch, undefined, 'primary')
      const sharedNames = descriptor.sharedPackages.map(entry => entry.name)
      const sealed = await writeDesktopRuntimeAsync(paths.dsh, descriptor.release, sharedNames, target)
      const builderEnv = {
        ...selected, DSH_DESKTOP_UNSIGNED: '0', DSH_DESKTOP_BUILD_COMMIT: commit, DSH_DESKTOP_BUILD_DIRTY: '0',
      }
      const buildTarget = async (artifact?: DesktopPrepackagedArtifact): Promise<void> => {
        // electron-builder normalizes file lists in place, including during prepackaged builds.
        const config = createForkMacOSBuilderConfig(paths, sealed, version, electronVersion, builderEnv)
        await build({
          projectDir: appRoot,
          config: { ...config, directories: { ...config.directories, output: artifact?.output ?? paths.artifacts } },
          targets: Platform.MAC.createTarget([artifact?.format ?? 'dir'], Arch.arm64),
          prepackaged: artifact?.appPath ?? null,
          publish: 'never',
        })
      }
      await buildTarget()
      await packageMacOSArtifacts({ arch: target.arch, version, artifactsRoot: paths.artifacts, environment: builderEnv }, buildTarget)
      await verifyUpdateZip(join(paths.artifacts, `deepseek-harness-${version}-mac-arm64.zip`), shipsCua, builderEnv)
      for (const extension of ['dmg', 'zip', 'zip.blockmap']) {
        await rename(join(paths.artifacts, `deepseek-harness-${version}-mac-arm64.${extension}`),
          join(output, `dsh-desktop-mac-arm64.${extension}`))
      }
    } finally {
      if (previous === undefined) delete process.env.CSC_KEYCHAIN
      else process.env.CSC_KEYCHAIN = previous
    }
  })
}

async function main(): Promise<void> {
  const environment = loadDesktopPackageEnvironment('darwin')
  try {
    const output = process.argv[2]
    if (!output || process.platform !== target.platform || process.arch !== target.arch
      || environment.DSH_PACKAGING_PRESET !== 'fork' || environment.DSH_DESKTOP_AUTO_UPDATE_ENV !== 'fork') {
      throw new Error('fork macOS signing: expected an Apple Silicon runner, the fork signing preset, and an output directory')
    }
    validateDesktopPackageEnvironment(environment, target)
    await signForkMacOS(resolve(output), environment)
  } catch (error) {
    const secrets = Object.entries(environment).filter(([name]) => /KEY|SECRET|TOKEN|PASSWORD|APPLE_ID/iu.test(name))
      .map(([, value]) => value ?? '')
    process.stderr.write(`${packagingErrorDetails(error, secrets)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
