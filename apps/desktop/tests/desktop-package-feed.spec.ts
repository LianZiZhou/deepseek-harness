import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { desktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'
import { localMacOSPackageEnvironment, validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { createForkMacOSBuilderConfig, validateForkMacOSCheckoutAlignment } from '../scripts/sign-fork-macos.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const appId = { DSH_DESKTOP_APP_ID: 'com.example.desktop' }
const forkUrl = 'https://github.com/LianZiZhou/deepseek-harness/releases/download/fork-feed/'
const macSigning = {
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_KEYCHAIN_PROFILE: 'fixture',
}

it('derives checkout dirtiness from version alignment in the selected commit', () => {
  const commit = 'a'.repeat(40)
  const path = 'packages/preset/prompt-presets/package.json'
  const original = { name: '@deepseek-ai/dsh-prompt-presets', version: '0.2.2-rc.5' }
  const version = '0.2.3-alpha.1'
  const read = () => original
  expect(validateForkMacOSCheckoutAlignment({ commit, manifests: [] }, commit, version, read)).toBe(false)
  expect(validateForkMacOSCheckoutAlignment({ commit, manifests: [path] }, commit, version, read)).toBe(true)
  expect(() => validateForkMacOSCheckoutAlignment({ commit: 'b'.repeat(40), manifests: [path] }, commit, version, read))
    .toThrow('invalid checkout alignment record')
  expect(() => validateForkMacOSCheckoutAlignment({ commit, manifests: [path, path] }, commit, version, read))
    .toThrow('invalid aligned manifest path')
  expect(() => validateForkMacOSCheckoutAlignment({ commit, manifests: ['vendor/cordis/package.json'] }, commit, version, read))
    .toThrow('invalid aligned manifest path')
  expect(() => validateForkMacOSCheckoutAlignment({ commit, manifests: [path] }, commit, original.version, read))
    .toThrow('unexpected aligned manifest')
})

it('packages signed macOS updates from the fork by default', () => {
  const config = createElectronBuilderConfig({ ...appId, ...macSigning }, 'darwin', 'arm64')
  expect(config.publish).toEqual([{ provider: 'generic', url: forkUrl, channel: 'stable' }])
  expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
})

it.each(['win32', 'linux'] as const)('packages an explicitly selected unsigned fork release for %s', (platform) => {
  const release = { ...appId, DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_AUTO_UPDATE_ENV: 'fork', DSH_DESKTOP_UPDATE_CHANNEL: 'stable' }
  const env = platform === 'linux' ? localMacOSPackageEnvironment(release) : release
  validateDesktopPackageEnvironment(env, { platform, arch: 'x64' }, { unsigned: true })
  const config = createElectronBuilderConfig(env, platform, 'x64')
  if (platform === 'linux') expect(config.appId).toBe('com.deepseek.dsh')
  expect(config.publish).toEqual([{ provider: 'generic', url: forkUrl, channel: 'stable' }])
  expect(config.extraMetadata).toHaveProperty('dshDesktopUpdateChannel', 'stable')
  expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
  expect(() => {
    validateDesktopPackageEnvironment({ ...env, DSH_DESKTOP_UPDATE_CHANNEL: 'latest' }, { platform, arch: 'x64' }, { unsigned: true })
  }).toThrow('invalid update channel')
  expect(createElectronBuilderConfig({ ...appId, DSH_DESKTOP_UNSIGNED: '1' }, platform, 'x64').publish).toBeNull()
})

it.each([
  { channel: 'stable', version: '1.2.3-rc.1' },
  { channel: 'nightly', version: '1.2.3-rc.1.25' },
])('packages the signed Mac app with its $channel fork feed and build version', ({ channel, version }) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fork-update-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const shell = join(root, 'shell')
  const paths = { ...desktopTargetBuildPaths('mac-arm64'), dsh: join(shell, 'dsh') }
  const runtime = runtimeFixture(paths.dsh, '1.2.3-rc.1')
  const unsigned = localMacOSPackageEnvironment({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'fork', DSH_DESKTOP_UPDATE_CHANNEL: channel })
  expect(createElectronBuilderConfig(unsigned, 'darwin', 'arm64').publish).toBeNull()
  const signed = createForkMacOSBuilderConfig(paths, runtime, version, '44.0.0',
    { ...unsigned, ...macSigning, DSH_DESKTOP_UNSIGNED: '0' })
  expect(signed.directories?.app).toBe(shell)
  expect(signed.publish).toEqual([{ provider: 'generic', url: forkUrl, channel }])
  expect(signed.extraMetadata).toMatchObject({ dshDesktopAppId: 'com.deepseek.dsh', dshDesktopUpdateChannel: channel, version })
  expect(signed.mac).toMatchObject({ target: ['dmg', 'zip'], identity: macSigning.DSH_DESKTOP_MACOS_SIGNING_IDENTITY })
  expect(signed.dmg).toMatchObject({ sign: true })
})

it('embeds an explicitly configured anonymous policy alongside the fork feed', () => {
  const origin = 'https://policy.example.com'
  const env = { ...appId, ...macSigning, DSH_DESKTOP_AUTO_UPDATE_ENV: 'fork',
    DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: origin, DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: '{"intervalMs":12000}' }
  const config = createElectronBuilderConfig(env, 'darwin', 'arm64')
  expect(config.extraMetadata).toHaveProperty('dshMandatoryUpdatePolicy', {
    origin, allowedPageOrigins: [origin], authentication: 'anonymous', intervalMs: 12000,
  })
  expect(config.publish?.[0].url).toBe(forkUrl)
  expect(() => createElectronBuilderConfig({ ...env, DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: undefined }, 'darwin', 'arm64'))
    .toThrow('DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN')
})
