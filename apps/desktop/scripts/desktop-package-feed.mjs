/** Select the update source embedded in Desktop packages. */
import { resolveDesktopAutoUpdateConfig, resolveDesktopUpdateChannel } from '@deepseek-ai/dsh-desktop-publisher/desktop-auto-update-environment.mjs'

/**
 * Select the installed app's feed. Older test configurations can supply their origin without a deployment name.
 * @param {NodeJS.ProcessEnv} env Packaging settings.
 * @returns {'fork' | 'test' | 'production'} Selected distribution.
 */
export function resolveDesktopPackageDeployment(env) {
  const testConfigured = env.DOWNLOAD_TEST_ORIGIN !== undefined || env.DOWNLOAD_TEST_RELEASE_ID !== undefined
    || env.DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN !== undefined
  const selected = env.DSH_DESKTOP_AUTO_UPDATE_ENV?.trim() || (testConfigured ? 'test' : 'fork')
  if (selected === 'fork' || selected === 'test' || selected === 'production') return selected
  throw new Error('desktop package: DSH_DESKTOP_AUTO_UPDATE_ENV must be fork, test, or production')
}

/**
 * Resolve the generic feed sealed into an update-enabled application.
 * @param {NodeJS.ProcessEnv} env Packaging settings.
 * @param {NodeJS.Platform} platform Target platform.
 * @param {string} arch Target architecture.
 * @param {boolean} unsigned Whether the package lacks a release signature.
 * @returns {{ publicUrl: string, channel: 'nightly' | 'stable' } | undefined} Feed used for discovery and relative asset URLs, when supported.
 */
export function resolveDesktopPackageFeed(env, platform, arch, unsigned = false) {
  // Squirrel.Mac requires a Developer ID signature. Unsigned Windows and Linux packages opt in explicitly.
  if (unsigned && (platform === 'darwin' || env.DSH_DESKTOP_AUTO_UPDATE_ENV?.trim() !== 'fork')) return undefined
  if (resolveDesktopPackageDeployment(env) !== 'fork') return resolveDesktopAutoUpdateConfig(env, platform, arch)
  return {
    publicUrl: 'https://github.com/LianZiZhou/deepseek-harness/releases/download/fork-feed/',
    channel: resolveDesktopUpdateChannel(env),
  }
}
