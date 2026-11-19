/** Exercise physical Mach-O and plist checks with synthetic helpers and credential-free Apple responses. */
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { CUA_APPLICATION, CUA_ARCHITECTURES, readCuaApplication, sealCuaApplication } from '../../../scripts/cua-helper/payload.ts'
import { signForkCuaApplications, verifyForkCuaApplications } from '../scripts/fork-macos-cua.ts'
import { notarizeMacOS } from '../scripts/notarize-macos.mjs'
import { verifyMacOSNotarizedApplication, verifyMacOSRuntimeCode } from '../scripts/verify-macos-signature.mjs'

const codesign = vi.hoisted(() => vi.fn<(args: string[]) => void>())
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    execFileSync(command: string, args: string[], options?: ExecFileSyncOptions) {
      if (command === '/usr/bin/codesign' && !args.includes('-')) {
        codesign(args)
        return Buffer.alloc(0)
      }
      return original.execFileSync(command, args, options)
    },
  }
})
vi.mock('../scripts/notarize-macos.mjs', () => ({ notarizeMacOS: vi.fn() }))
vi.mock('../scripts/verify-macos-signature.mjs', () => ({
  verifyMacOSRuntimeCode: vi.fn(), verifyMacOSNotarizedApplication: vi.fn(),
}))

const environment = {
  CSC_KEYCHAIN: '/private/tmp/example/signing.keychain-db',
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_KEYCHAIN_PROFILE: 'test-profile',
}
const signer = { signingIdentity: environment.DSH_DESKTOP_MACOS_SIGNING_IDENTITY, teamId: environment.DSH_DESKTOP_MACOS_TEAM_ID }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fork-cua-test-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const provider = join(root, 'provider')
  const directories = CUA_ARCHITECTURES.map((arch) => {
    const directory = join(provider, 'native/bin', `darwin-${arch}`)
    const application = join(directory, 'input', CUA_APPLICATION)
    for (const name of ['MacOS', 'Resources']) mkdirSync(join(application, 'Contents', name), { recursive: true })
    const info = new URL('../../../packages/experimental/cua-macos/native/Info.plist', import.meta.url)
    cpSync(info, join(application, 'Contents/Info.plist'))
    writeFileSync(join(application, 'Contents/Resources/DSHComputerUse.icns'), 'icon')
    execFileSync('/usr/bin/clang', ['-target', `${arch === 'x64' ? 'x86_64' : arch}-apple-macos14`,
      '-x', 'c', '-', '-o', join(application, 'Contents/MacOS/dsh-cua-native')], { input: 'int main(void) { return 0; }' })
    execFileSync('/usr/bin/codesign', ['--sign', '-', '--options', 'runtime', '--timestamp=none', application])
    sealCuaApplication(directory, application)
    return directory
  })
  const receipts = () => directories.map(directory => readCuaApplication(directory))
  return { provider, root, directories, receipts }
}

afterEach(() => vi.resetAllMocks())

describe.skipIf(process.platform !== 'darwin')('fork updater Computer Use signing', () => {
  it('selects the stapled bytes for each architecture and verifies the extracted provider', async () => {
    const f = fixture()
    const before = f.receipts()
    vi.mocked(notarizeMacOS).mockImplementation(async ({ appPath, ...notary }) => {
      expect(notary).toEqual({ keychainProfile: 'test-profile' })
      writeFileSync(join(appPath, 'Contents/CodeResources'), 'stapled ticket')
    })
    vi.mocked(verifyMacOSNotarizedApplication).mockImplementation((app, expected) => {
      expect(expected).toEqual(signer)
      expect(readFileSync(join(app, 'Contents/CodeResources'), 'utf8')).toBe('stapled ticket')
    })
    await signForkCuaApplications(f.provider, environment)
    expect(codesign).toHaveBeenCalledTimes(2)
    for (const [args] of codesign.mock.calls) {
      expect(args).toEqual(['--force', '--sign', `Developer ID Application: ${signer.signingIdentity}`,
        '--keychain', environment.CSC_KEYCHAIN, '--identifier', 'com.deepseek.harness.computer-use', '--options', 'runtime', '--timestamp', expect.stringContaining(CUA_APPLICATION)])
    }
    for (const [index, receipt] of f.receipts().entries()) expect(receipt.bundle).not.toBe(before[index]!.bundle)
    const archive = join(f.root, 'provider.zip')
    const extracted = join(f.root, 'extracted/provider')
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', f.provider, archive])
    execFileSync('/usr/bin/ditto', ['-x', '-k', archive, join(f.root, 'extracted')])
    verifyForkCuaApplications(extracted, environment)
    for (const arch of CUA_ARCHITECTURES) {
      const { application } = readCuaApplication(join(extracted, 'native/bin', `darwin-${arch}`))
      expect(verifyMacOSNotarizedApplication).toHaveBeenCalledWith(application, signer)
    }
  })

  it.each(['damaged receipt', 'development identifier', 'wrong slice', 'missing keychain'] as const)(
    'rejects %s before signing either app', async (failure) => {
      const f = fixture()
      const x64 = f.directories[1]!
      const { application } = readCuaApplication(x64)
      if (failure === 'damaged receipt') writeFileSync(join(application, 'Contents/Resources/DSHComputerUse.icns'), 'corrupt')
      if (failure === 'development identifier') {
        execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', 'com.deepseek.harness.computer-use.dev', join(application, 'Contents/Info.plist')])
        sealCuaApplication(x64, application)
      }
      if (failure === 'wrong slice') {
        cpSync(join(f.receipts()[0]!.application, 'Contents/MacOS/dsh-cua-native'), join(application, 'Contents/MacOS/dsh-cua-native'))
        sealCuaApplication(x64, application)
      }
      await expect(signForkCuaApplications(f.provider, failure === 'missing keychain' ? { ...environment, CSC_KEYCHAIN: '' } : environment))
        .rejects.toThrow(/digest|CFBundleIdentifier|Mach-O architecture|CSC_KEYCHAIN/u)
      expect(codesign).not.toHaveBeenCalled()
    })

  it.each(['signature', 'notary', 'Gatekeeper'] as const)('preserves both input receipts when x64 fails %s', async (stage) => {
    const f = fixture()
    const original = f.receipts()
    const failure = new Error(stage)
    if (stage === 'signature') vi.mocked(verifyMacOSRuntimeCode).mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw failure })
    if (stage === 'notary') vi.mocked(notarizeMacOS).mockResolvedValueOnce().mockRejectedValueOnce(failure)
    if (stage === 'Gatekeeper') vi.mocked(verifyMacOSNotarizedApplication).mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw failure })
    vi.mocked(notarizeMacOS).mockImplementation(async ({ appPath }) => { writeFileSync(join(appPath, 'Contents/CodeResources'), 'ticket') })
    await expect(signForkCuaApplications(f.provider, environment)).rejects.toBe(failure)
    expect(f.receipts()).toEqual(original)
    expect(readdirSync(join(f.provider, 'native'))).toEqual(['bin'])
  })
})
