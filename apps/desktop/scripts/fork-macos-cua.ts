/** Sign the fork updater's staged Computer Use applications in the parent's temporary keychain. */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { CUA_ARCHITECTURES, CUA_APPLICATION, readCuaApplication, sealCuaApplication } from '../../../scripts/cua-helper/payload.ts'
import { resolveMacOSNotarizationEnvironment, resolveMacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { notarizeMacOS } from './notarize-macos.mjs'
import { verifyMacOSNotarizedApplication, verifyMacOSRuntimeCode } from './verify-macos-signature.mjs'

const executable = 'dsh-cua-native'
const releaseId = 'com.deepseek.harness.computer-use'

function applications(providerRoot: string) {
  const root = resolve(providerRoot)
  const bin = join(root, 'native/bin')
  for (const path of [root, join(root, 'native'), bin]) {
    if (!lstatSync(path).isDirectory()) throw new Error(`Expected a physical CUA directory at ${path}`)
  }
  const architectures = readdirSync(bin).sort()
  if (architectures.join(',') !== CUA_ARCHITECTURES.map(arch => `darwin-${arch}`).join(',')) {
    throw new Error(`Unexpected CUA architecture directories at ${bin}`)
  }
  return CUA_ARCHITECTURES.map((arch) => {
    const name = `darwin-${arch}`
    const { application } = readCuaApplication(join(bin, name))
    const plist = join(application, 'Contents/Info.plist')
    for (const [key, value] of [['CFBundleIdentifier', releaseId], ['CFBundleExecutable', executable]] as const) {
      const actual = execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-n', '-o', '-', plist], { encoding: 'utf8' })
      if (actual !== value) throw new Error(`CUA ${name} requires ${key}=${value}`)
    }
    const binary = join(application, 'Contents/MacOS', executable)
    const slice = execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' }).trim()
    if (slice !== (arch === 'x64' ? 'x86_64' : 'arm64')) throw new Error(`CUA ${name} has Mach-O architecture ${slice}`)
    return { name, application }
  })
}

/**
 * Verify the installed provider's physical receipts, executable slices, Developer ID and stapled tickets.
 * @param providerRoot Physical provider package path inside the staged tree or extracted archive.
 * @param environment Public macOS signing identity and team.
 */
export function verifyForkCuaApplications(providerRoot: string, environment: NodeJS.ProcessEnv): void {
  const signing = resolveMacOSSigningEnvironment(environment)
  for (const { application } of applications(providerRoot)) verifyMacOSNotarizedApplication(application, signing)
}

/**
 * Replace both staged generations after Apple accepts both applications.
 * @param providerRoot Physical provider package in the exclusive release staging directory.
 * @param environment Child environment supplied by withMacOSSigningKeychain, including notarization settings.
 * @returns Resolves after both stapled applications are selected by their final content digests.
 */
export async function signForkCuaApplications(providerRoot: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const keychain = environment.CSC_KEYCHAIN
  if (!keychain || !isAbsolute(keychain)) throw new Error('CUA signing requires the temporary CSC_KEYCHAIN path')
  const signing = resolveMacOSSigningEnvironment(environment)
  const notary = resolveMacOSNotarizationEnvironment(environment)
  const inputs = applications(providerRoot)
  const native = resolve(providerRoot, 'native')
  const work = mkdtempSync(join(native, '.sign-cua-'))
  const signed = join(work, 'signed')
  const original = join(work, 'original')
  const bin = join(native, 'bin')
  try {
    for (const { name, application } of inputs) {
      const directory = join(signed, name)
      const copy = join(directory, 'staged', CUA_APPLICATION)
      cpSync(application, copy, { recursive: true })
      execFileSync('/usr/bin/codesign', ['--force', '--sign', `Developer ID Application: ${signing.signingIdentity}`,
        '--keychain', keychain, '--identifier', releaseId, '--options', 'runtime', '--timestamp', copy])
      verifyMacOSRuntimeCode(copy, signing)
      await notarizeMacOS({ appPath: copy, ...notary })
      verifyMacOSNotarizedApplication(copy, signing)
      sealCuaApplication(directory, copy)
    }
    renameSync(bin, original)
    try { renameSync(signed, bin) } catch (error) {
      renameSync(original, bin)
      throw error
    }
    rmSync(original, { recursive: true })
  } finally {
    // Preserve the input generations if the filesystem also rejected rollback.
    if (!existsSync(original)) rmSync(work, { recursive: true, force: true })
  }
}
