import { expect, it } from 'vitest'
import { localMacOSPackageEnvironment, validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

const appId = { DSH_DESKTOP_APP_ID: 'com.example.desktop' }
const forkUrl = 'https://github.com/LianZiZhou/deepseek-harness/releases/download/fork-feed/'
const macSigning = {
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_KEYCHAIN_PROFILE: 'fixture',
}

it('packages signed macOS updates from the fork by default', () => {
  const config = createElectronBuilderConfig({ ...appId, ...macSigning }, 'darwin', 'arm64')
  expect(config.publish).toEqual([{ provider: 'generic', url: forkUrl, channel: 'nightly' }])
  expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
})

it.each(['win32', 'linux'] as const)('packages an explicitly selected unsigned fork release for %s', (platform) => {
  const release = { ...appId, DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_AUTO_UPDATE_ENV: 'fork', DSH_DESKTOP_UPDATE_CHANNEL: 'stable' }
  const env = platform === 'linux' ? localMacOSPackageEnvironment(release) : release
  validateDesktopPackageEnvironment(env, { platform, arch: 'x64' }, { unsigned: true })
  const config = createElectronBuilderConfig(env, platform, 'x64')
  expect(config.publish).toEqual([{ provider: 'generic', url: forkUrl, channel: 'stable' }])
  expect(config.extraMetadata).toHaveProperty('dshDesktopUpdateChannel', 'stable')
  expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
  expect(() => {
    validateDesktopPackageEnvironment({ ...env, DSH_DESKTOP_UPDATE_CHANNEL: 'latest' }, { platform, arch: 'x64' }, { unsigned: true })
  }).toThrow('invalid update channel')
  expect(createElectronBuilderConfig({ ...appId, DSH_DESKTOP_UNSIGNED: '1' }, platform, 'x64').publish).toBeNull()
})

it.each(['stable', 'nightly'])('marks only the fork Apple Silicon DMG for manual %s updates', (channel) => {
  const local = localMacOSPackageEnvironment({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'fork', DSH_DESKTOP_UPDATE_CHANNEL: channel })
  expect(createElectronBuilderConfig(local, 'darwin', 'arm64').extraMetadata).not.toHaveProperty('dshDesktopManualUpdates')
  const env = localMacOSPackageEnvironment({ ...local, DSH_DESKTOP_FORK_MANUAL_DMG: '1' })
  const config = createElectronBuilderConfig(env, 'darwin', 'arm64')
  expect(config.publish).toBeNull()
  expect(config.extraMetadata).toMatchObject({ dshDesktopManualUpdates: 'fork-dmg', dshDesktopUpdateChannel: channel })
  expect(createElectronBuilderConfig(env, 'darwin', 'x64').extraMetadata).not.toHaveProperty('dshDesktopManualUpdates')
  expect(createElectronBuilderConfig(localMacOSPackageEnvironment({}), 'darwin', 'arm64').extraMetadata)
    .not.toHaveProperty('dshDesktopManualUpdates')
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
