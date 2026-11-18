import { afterEach, expect, it, vi } from 'vitest'
import { forkDmgReleaseCheck } from '../src/fork-dmg-update.ts'

const marked = { dshDesktopManualUpdates: 'fork-dmg' }
const check = forkDmgReleaseCheck(marked, true, 'darwin', 'arm64')!
const releases = 'https://github.com/LianZiZhou/deepseek-harness/releases'
const name = 'dsh-desktop-mac-arm64.dmg'
const version = '0.2.2-rc.4'
const tag = `fork-v${version}`
const stable = { schemaVersion: 1, channel: 'stable', version, commit: 'a'.repeat(40), tag,
  assets: [{ name, url: `${releases}/download/${tag}/${name}` }] }

afterEach(() => { vi.restoreAllMocks() })

it('does not infer a manual feed from a missing file, host platform, or development build', () => {
  expect(forkDmgReleaseCheck({}, true, 'darwin', 'arm64')).toBeUndefined()
  expect(forkDmgReleaseCheck(marked, false, 'darwin', 'arm64')).toBeUndefined()
  expect(forkDmgReleaseCheck(marked, true, 'darwin', 'x64')).toBeUndefined()
  expect(forkDmgReleaseCheck(marked, true, 'win32', 'arm64')).toBeUndefined()
})

it('reads the selected stable RC from GitHub release assets, returning only the tag page', async () => {
  const location = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/2'
  const request = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.redirect(location, 302))
    .mockResolvedValueOnce(Response.json(stable))
  expect(await check('stable', new AbortController().signal)).toEqual({ version, page: `${releases}/tag/${tag}` })
  expect(request.mock.calls.map(([url]) => url)).toEqual([`${releases}/download/fork-feed/stable.json`, new URL(location)])
})

it.each(['retirement', 'timeout'])('aborts the redirected metadata fetch on %s', async (cause) => {
  const owner = new AbortController()
  const deadline = new AbortController()
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const redirected = Promise.withResolvers<undefined>()
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.redirect('https://release-assets.githubusercontent.com/metadata', 302))
    .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      const signal = options!.signal!
      signal.addEventListener('abort', () => { reject(new DOMException('Request aborted', 'AbortError')) }, { once: true })
      redirected.resolve(undefined)
    }))
  const checking = check('stable', owner.signal)
  await redirected.promise
  const controller = cause === 'timeout' ? deadline : owner
  controller.abort()
  await expect(checking).rejects.toThrow('Request aborted')
  expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000)
})

it('does not follow an unexpected redirect or treat HTTP failure as no newer release', async () => {
  const request = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.redirect('https://untrusted.example/', 302))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
  await expect(check('stable', new AbortController().signal)).rejects.toThrow(/unexpected fork feed redirect/u)
  expect(request).toHaveBeenCalledTimes(1)
  await expect(check('stable', new AbortController().signal)).rejects.toThrow(/HTTP 404/u)
})

it.each([
  { schemaVersion: 2 }, { channel: 'nightly' }, { version: 'invalid', tag: 'fork-vinvalid' },
  { tag: 'https://untrusted.example/' }, { assets: [] }, { assets: [{ name, url: 'https://untrusted.example/setup' }] },
])('rejects a mismatched fork manifest %j', async (fields) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...stable, ...fields }))
  await expect(check('stable', new AbortController().signal)).rejects.toThrow(/desktop update:/u)
})
