# Fork upstream sync

The hourly workflow follows the first-parent history of `deepseek-ai/deepseek-harness:master`. For each upstream commit, it reapplies the fork's accumulated changes to the new tree using Git's three-way merge. Each successful checkpoint has the previous fork head and the upstream commit as parents. It is pushed immediately with a normal fast-forward push. Existing fork commits, manual resolutions and upstream merge commits remain reachable.

Enable Actions and Issues on the fork. The workflows run from the fork's default branch. For upstream changes to files under `.github/workflows/`, configure the `FORK_SYNC_TOKEN` Actions secret with Contents and Workflows write access to this repository. Branch rules must permit the sync identity to push. Issue management and release dispatch use the workflow's built-in token.

## Resolve a conflict

The hourly workflow opens one issue per conflicting upstream commit. While a conflict issue is open, scheduled runs skip the upstream fetch and nightly dispatch. A network, authentication or push failure fails the run and can be retried.

1. Start on the fork's current default branch and fast-forward it to `origin`.
2. Fetch official master and merge the full commit SHA from the issue. In the commands below, replace `BLOCKED_SHA` with that SHA.

   ```sh
   git pull --ff-only
   git fetch --no-tags https://github.com/deepseek-ai/deepseek-harness.git master
   git merge --no-ff BLOCKED_SHA
   ```

3. Resolve and test the conflicting files, commit the resolution and push it to the fork's default branch.
4. Run **Fork upstream catchup** from Actions. It fetches the latest upstream tip, including releases published during the repair. At a new conflict the run fails after pushing the clean prefix. Repeat the repair for that issue. A fully successful recovery closes the resolved issues. The next successful hourly sync dispatches a nightly for its exact fork commit.

Run the checkpoint and recovery tests locally with `python3 -m unittest discover -s .github/fork-sync`.

## Daily pi-ai updates

[Fork pi-ai sync](../workflows/fork-pi-ai-sync.yml) checks the npm `latest` tag for `@earendil-works/pi-ai` daily at 00:43 UTC (08:43 Hong Kong). You can also run it from Actions on the fork's default branch. It checks the published package directly, so the fork can pick up new models before the hourly harness sync supplies them.

A newer stable version updates the adapter, lockfile, Desktop pin and generated provider metadata. The updater checks the existing patch against the published tarball and keeps the experimental OAR dependency at its own locked version. The Models and onboarding browser scenarios refresh the affected snapshots and replay them against the built application. After the browser, adapter and Desktop checks pass, a separate job pushes the tested changes in one commit. An up-to-date checkout produces no commit. Both sync workflows share a queue.

To reproduce an update, run `node .github/fork-sync/update-pi-ai.mjs VERSION` in a clean checkout, replacing `VERSION` with the exact npm release. If a release needs a patch or adapter change, resolve it on the default branch, then select **Run workflow** on that branch to check the new commit. Run the updater tests with `node --test .github/fork-sync/update-pi-ai.test.mjs`.
