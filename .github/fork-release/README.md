# Fork releases

CI1 dispatches `fork-desktop-release.yml` on the fork default branch after a complete sync, with `sync_sha` and `upstream_sha` set to the full fork and upstream commit IDs. An up-to-date sync sends the same pair. Recovery runs close resolved issues so the next hourly sync can dispatch a nightly.

Each packaging runner aligns the DSH release family to the selected checkout’s root package version before building. Fork-only packages therefore use the selected upstream release version even when their manifests in that checkpoint carry an earlier version. Apple Silicon preparation verifies that the checkout changes only those manifest versions. The signer checks the alignment record against the selected commit and the unsigned shell’s checkout metadata.

Hourly reconciliation also discovers published upstream GitHub Releases with `dsh-v<version>` tags, including RCs. Starting at CI3 installation, it selects the first integrated upstream master checkpoint that contains the peeled tag and has the release version on both master and the fork. Until a fork tag pins the source, CI3 builds the newest fork first-parent commit with that version before the next upstream checkpoint. The publisher creates the fork tag before its draft. A retry uses that tag’s commit, which must belong to the same checkpoint or be the first sync or CI3 installation commit at which both versions matched. Planning uses read-only access. For a manually created draft without a tag, create the fork tag at the draft’s intended commit before retrying. The publisher checks visible draft pins before uploading any files. The release manifest records the selected fork commit in `commit`, the integrated master commit in `upstreamCommit`, and the peeled tag SHA in `upstreamTagCommit`.

Creating a tag at a historical checkpoint can require GitHub's Workflows write permission. The publisher uses the [fork sync token](../fork-sync/README.md) to create tags when configured. The built-in workflow token handles release assets and updater feeds. If tag creation fails with HTTP 403, push the exact tag and commit from the failed publish job with an account authorized to tag that checkpoint, then re-run the failed jobs to reuse the verified artifacts.

Each `fork-v<version>` or `fork-nightly-<full fork SHA>` release includes Desktop installers and CLI archives for Linux x64, Windows x64, and Apple Silicon. macOS and Linux Desktop packages use the application ID `com.deepseek.dsh`. Windows keeps `io.github.lianzizhou.dsh-desktop` so the NSIS installer can upgrade existing fork installations in place. On Apple Silicon, install the DMG once. Desktop downloads subsequent updates as a ZIP containing the signed, notarized app. The DMG and the app in the ZIP each carry a stapled Apple notarization ticket. Both use the WWW LTD Developer ID Application certificate. Windows and Linux Desktop installers use unsigned packaging. Extract the CLI archive and run `dsh` or `dsh.cmd`; the archive includes Node and pnpm. `SHA256SUMS` and `fork-release.json` identify the bytes, source commits and package version.

The `fork-feed` release in `LianZiZhou/deepseek-harness` hosts updater metadata under `releases/download/fork-feed/`. Windows reads `<channel>.yml`, Linux reads `<channel>-linux.yml`, and Apple Silicon reads `<channel>-mac.yml` for releases with a signed update ZIP. The CLI and older Mac builds with release-page updates still read `<channel>.json`. The stable feed follows the highest official product version, including upstream prereleases. The nightly feed follows the newest built full-sync head in fork first-parent order. Each feed file points directly to an immutable fork release. Only completed sets become public. Re-running reconciliation repairs interrupted uploads. GitHub replaces each public feed asset individually. If replacement is interrupted, that channel can be temporarily unavailable until reconciliation repairs it.

## macOS signing credentials

Use the WWW LTD Apple Developer team to issue a [Developer ID Application certificate](https://developer.apple.com/help/account/certificates/create-developer-id-certificates) from a [certificate signing request](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request). Import the downloaded certificate on the Mac that made the request and [export the certificate with its private key](https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac) as a password-protected PKCS#12 file. In App Store Connect, generate a [Team API key](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api) for notarization and download its private key.

Store these three values as repository Actions secrets in `LianZiZhou/deepseek-harness` with `gh secret set NAME --repo LianZiZhou/deepseek-harness`. The release workflow passes them by name to the reusable build workflow. Its macOS signing step runs on the fork’s default branch. Collaborators who can change workflows can also use repository secrets.

| Secret | Value |
| --- | --- |
| `FORK_MACOS_CERTIFICATE_BASE64` | Base64 of the WWW LTD Developer ID Application PKCS#12 export containing the private key |
| `FORK_MACOS_NOTARY_KEY_BASE64` | Base64 of the App Store Connect notarization API key file |
| `FORK_MACOS_SIGNING_ENV` | The dotenv settings below with the matching Apple team, certificate export password, and API key identifiers |

```dotenv
DSH_DESKTOP_MACOS_SIGNING_IDENTITY="WISDOM WORLD WORKSHOP LIMITED (TEAM_ID)"
DSH_DESKTOP_MACOS_TEAM_ID=TEAM_ID
CSC_LINK=../certificates/developer-id.p12
CSC_KEY_PASSWORD="P12_EXPORT_PASSWORD"
APPLE_API_KEY=../certificates/notarization.p8
APPLE_API_KEY_ID=API_KEY_ID
APPLE_API_ISSUER=ISSUER_ID
```

The build job checks that the release source belongs to the fork’s first-parent history. When the CLI includes Computer Use, it builds the release helper for arm64 and x64 from that checkout before packing the unsigned Desktop app. Pull requests that change the helper or its build inputs compile both architectures with the same macOS runner before merge. A separate signing runner checks out the workflow's control commit and accepts the built files as data. It signs and notarizes the included Computer Use helpers with the fork’s Developer ID and records their final bundle digests in the provider’s per-architecture receipts. It signs the native runtime, verifies the packaged files, and uses the Desktop packager to notarize the DMG and the app in the updater ZIP. Both must pass signature, stapling, and Gatekeeper checks. The credentials stay in a private temporary directory and are removed when signing ends. Publication downloads the signing job’s artifact by ID and verifies the SHA-256 of the DMG, ZIP, and ZIP blockmap against the job’s output. Missing credentials or failed verification prevent publication. Keep credential files and their base64 encodings outside Git and release artifacts.
