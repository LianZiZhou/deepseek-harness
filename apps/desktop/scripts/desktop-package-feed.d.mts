/** Select the update source embedded in Desktop packages. */
import type { DesktopAutoUpdateConfig, DesktopAutoUpdateEnvironment } from '@deepseek-ai/dsh-desktop-publisher/desktop-auto-update-environment.mjs'

/** Select the installed app's distribution, retaining implicit test configurations with an explicit origin. */
export function resolveDesktopPackageDeployment(env: NodeJS.ProcessEnv): 'fork' | DesktopAutoUpdateEnvironment

/** Resolve the generic feed sealed into an update-enabled application. */
export function resolveDesktopPackageFeed(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, arch: string):
  Pick<DesktopAutoUpdateConfig, 'publicUrl' | 'channel'>
export function resolveDesktopPackageFeed(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, arch: string, unsigned: boolean):
  Pick<DesktopAutoUpdateConfig, 'publicUrl' | 'channel'> | undefined
