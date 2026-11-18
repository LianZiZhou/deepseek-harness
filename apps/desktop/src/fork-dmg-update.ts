/** Read-only release discovery for the fork's manually installed Apple Silicon DMG. */
import { valid } from 'semver'
import { z } from 'zod'
import type { DesktopUpdateChannel } from './update-channel.ts'

const releases = 'https://github.com/LianZiZhou/deepseek-harness/releases'
const dmg = 'dsh-desktop-mac-arm64.dmg'
const manifestSchema = z.object({
  schemaVersion: z.literal(1), channel: z.enum(['nightly', 'stable']),
  version: z.string(), commit: z.string().regex(/^[a-f0-9]{40}$/u), tag: z.string(),
  assets: z.array(z.object({ name: z.string(), url: z.string() })),
})

async function checkForkDmgRelease(channel: DesktopUpdateChannel, signal: AbortSignal): Promise<{ version: string; page: string }> {
  const options = { redirect: 'manual', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) } as const
  let response = await fetch(`${releases}/download/fork-feed/${channel}.json`, options)
  if (response.status === 302) {
    const asset = new URL(response.headers.get('location') ?? '')
    if (asset.origin !== 'https://release-assets.githubusercontent.com' || asset.username || asset.password) {
      throw new Error('desktop update: unexpected fork feed redirect')
    }
    response = await fetch(asset, options)
  }
  if (!response.ok) throw new Error(`desktop update: fork feed returned HTTP ${response.status}`)
  const parsed = manifestSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error('desktop update: invalid fork release manifest')
  const release = parsed.data
  const tag = channel === 'stable' ? `fork-v${release.version}` : `fork-nightly-${release.commit}`
  if (release.channel !== channel || valid(release.version) !== release.version || release.tag !== tag
    || !release.assets.some(asset => asset.name === dmg && asset.url === `${releases}/download/${tag}/${dmg}`)) {
    throw new Error('desktop update: fork release does not match the selected channel or DMG')
  }
  return { version: release.version, page: `${releases}/tag/${tag}` }
}

/**
 * @param manifest - Manifest sealed into the application, never renderer or user settings.
 * @param packaged - Whether Electron is running an installed package.
 * @param platform - Platform running this application.
 * @param arch - Architecture of the running Electron process.
 * @returns A metadata-only check for explicitly marked fork DMGs; no fallback for other distributions.
 */
export function forkDmgReleaseCheck(manifest: unknown, packaged: boolean, platform: NodeJS.Platform, arch: string):
  typeof checkForkDmgRelease | undefined {
  return packaged && platform === 'darwin' && arch === 'arm64' && typeof manifest === 'object' && manifest !== null
    && 'dshDesktopManualUpdates' in manifest && manifest.dshDesktopManualUpdates === 'fork-dmg' ? checkForkDmgRelease : undefined
}
