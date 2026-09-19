<!-- Bilingual pair: deploy/README.zh.md -->

# Redeploying this harness

English | [中文](README.zh.md)

This directory carries everything needed to stand the fork up on another machine: the checkout builds the harness itself, and the snapshot here rebuilds the DSH home that runs it — which profile is composed, which plugins it mounts, and the user settings document.

It deliberately carries **no credentials**. A snapshot is destined for a git remote, and a secret noticed after a push has already leaked.

## Table of Contents

- [What the snapshot holds](#what-the-snapshot-holds)
- [Redeploy](#redeploy)
- [Refresh the snapshot](#refresh-the-snapshot)
- [What is not here](#what-is-not-here)

## What the snapshot holds

| Path | Role |
|---|---|
| `profile/<name>/package.json` | The plugin chain: bundles the profile composes, and every npm or git plugin with its pinned version |
| `profile/<name>/cordis.patch.yml` | The user layer over those bundles — the rows this machine disables or reconfigures |
| `profile/<name>/pnpm-workspace.yaml` | The profile's own install root |
| `settings.yaml` | The user settings document: prompt presets, model routing, theme, locale |
| `snapshot.json` | Which profiles the snapshot covers, and when it was taken |

`settings.yaml` names every provider key through `apiKeyEnv`, so it holds environment-variable *names*, never values. `deploy/export.mjs` refuses to snapshot a file that looks otherwise.

## Redeploy

```bash
git clone <this repository> deepseek-harness
cd deepseek-harness
pnpm install
pnpm run build
node deploy/bootstrap.mjs
```

`bootstrap.mjs` restores the snapshot into `$DSH_HOME` (default `~/.dsh`), installs the plugin chain, and prints the credentials still to supply. It never overwrites an existing file without `--force`, because a machine that already has a profile is where a silent overwrite costs the most.

Then provide the credentials it listed and start the app:

```bash
node apps/cli/lib/bin.js web
```

Use the built entry, not `pnpm dsh`, on any machine where `lib/` has been built — see [dev runs load two copies](../docs/development.md) for why a development run can load a package twice.

## Refresh the snapshot

Run this whenever the plugin chain or settings change, then review the diff before committing:

```bash
node deploy/export.mjs            # the web profile
node deploy/export.mjs web desktop
git diff deploy/
```

## What is not here

Runtime state, because it is personal rather than compositional, and credentials, because they must not reach a remote:

- `$DSH_HOME/.credentials.yaml` — provider keys, OAuth records, the browser-session secret
- `$DSH_HOME/sessions/`, `attachments/`, `recovery/`, `logs/` — conversation history and its artifacts
- `.dsh-market/`, `.dsh-skin-market/`, `.plugin-manager/logs/` — market caches, rebuilt on demand
- `node_modules/` in both the checkout and the profile — reinstalled from the pinned manifests

A `.dsh/` directory beside the checkout is a runtime home, not repository content; `.gitignore` excludes it.
