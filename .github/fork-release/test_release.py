"""Release selection against real first-parent merges, side-branch tags and packaged feed bytes."""

import base64
from contextlib import chdir
from fnmatch import fnmatchcase
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import release


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        tmp = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(chdir(tmp))
        self.git("init", "-q", "-b", "master")
        self.git("config", "user.name", "CI fixture")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.root = self.commit_version("1.0.0")
        self.git("branch", "fork")
        self.git("switch", "-qc", "release")
        self.rc = self.commit_version("1.1.0-rc.4")
        self.git("tag", "-a", "dsh-v1.1.0-rc.4", "-m", "RC")
        self.git("switch", "-q", "master")
        self.commit_file("master change", "master")
        self.master = self.merge("release")
        self.git("switch", "-q", "fork")
        self.commit_file("fork change", "fork")
        self.initial = self.merge("master")
        self.control = self.commit_file(".github/fork-release/release.py", "CI3 enabled")
        self.repair = self.commit_file("package fix", "repair before the next upstream merge")
        self.git("switch", "-q", "master")
        self.new_master = self.commit_file("later", "next upstream")
        self.git("switch", "-q", "fork")
        self.next = self.merge("master")
        self.tip = self.commit_file("fork fix", "latest fork-only change")
        self.tag = "dsh-v1.1.0-rc.4"
        self.tags = {self.tag: self.rc}
        self.published = {self.tag: {"published_at": "2026-11-18", "prerelease": True}}

    def git(self, *args):
        return subprocess.check_output(["git", *args], text=True).strip()

    def commit_file(self, name, content):
        path = Path(name)
        path.parent.mkdir(exist_ok=True, parents=True)
        path.write_text(content)
        self.git("add", name)
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def commit_version(self, version):
        return self.commit_file("apps/desktop/package.json", '{"version":"' + version + '"}')

    def merge(self, ref):
        self.git("merge", "-q", "--no-ff", "-m", "fixture checkpoint", ref)
        return self.git("rev-parse", "HEAD")

    def select(self, tags=None, publications=None, sync="", upstream="", activation=None, ref="HEAD", pins=None):
        rows = release.history(ref)
        master = set(self.git("rev-list", "--first-parent", "master").splitlines())
        captured = release.checkpoints(rows, master, activation or self.control)
        return release.select(rows, captured, self.tags if tags is None else tags,
                              self.published if publications is None else publications, pins or {}, sync, upstream)

    def test_side_branch_release_builds_first_captured_matching_tree(self):
        self.assertNotIn(self.rc, self.git("rev-list", "--first-parent", "master").splitlines())
        item, = self.select(ref=self.control)
        self.assertEqual((item["commit"], item["upstreamCommit"], item["upstreamTagCommit"]),
                         (self.control, self.master, self.rc))
        self.assertTrue(item["prerelease"])
        item, = self.select(activation=self.initial, ref=self.initial)
        self.assertEqual(item["commit"], self.initial)
        for ref in (self.repair, self.next, self.tip):
            item, = self.select(ref=ref)
            self.assertEqual((item["commit"], item["upstreamCommit"]), (self.repair, self.master))

    def test_inventory_fetches_and_peels_an_annotated_release_tag(self):
        for repo in (release.UPSTREAM, release.FORK):
            self.git("config", "--add", f"url.{Path.cwd().as_uri()}.insteadOf", f"https://github.com/{repo}.git")
        self.git("tag", "-a", "fork-v1.1.0-rc.4", self.control, "-m", "Fork RC")
        with patch.object(release, "release_list", side_effect=lambda repo: self.published if repo == release.UPSTREAM else {}):
            planned, pending = release.inventory("HEAD")
        item, = planned
        self.assertEqual(pending, planned)
        self.assertEqual((item["commit"], item["upstreamTagCommit"]), (self.control, self.rc))
        self.assertEqual(release.remote_tags(release.FORK, item["tag"]), {item["tag"]: self.control})
        self.assertNotEqual(self.git("rev-parse", f"refs/tags/{self.tag}"), self.rc)

    def test_skips_tags_without_publications_and_drafts(self):
        self.assertEqual(self.select(publications={}), [])
        self.assertEqual(self.select(publications={self.tag: {"draft": True}}), [])
        with self.assertRaisesRegex(ValueError, "no tag ref"):
            self.select(tags={})

    def test_defers_unmerged_tags_and_version_mismatch(self):
        self.git("switch", "-q", "release")
        future = self.commit_version("1.2.0")
        self.git("switch", "-q", "fork")
        self.assertEqual(self.select(tags={self.tag: future}), [])
        wrong = "dsh-v1.2.0"
        self.assertEqual(self.select(tags={wrong: self.rc}, publications={wrong: self.published[self.tag]}), [])

    def test_up_to_date_nightly_and_paused_or_stale_inputs(self):
        nightly, stable = self.select(sync=self.tip, upstream=self.new_master)
        self.assertEqual(nightly["tag"], "fork-nightly-" + self.tip)
        self.assertEqual(nightly["upstreamCommit"], self.new_master)
        self.assertEqual(stable["commit"], self.repair)
        self.assertEqual(self.select(sync=self.tip, upstream=self.new_master)[0], nightly)
        for sync, upstream in [(self.tip, self.master), (self.rc, self.new_master), (self.tip, "")]:
            with self.subTest(sync=sync, upstream=upstream), self.assertRaises(ValueError):
                self.select(sync=sync, upstream=upstream)

    def test_existing_pins_stay_in_the_original_upstream_checkpoint(self):
        tag = "fork-v1.1.0-rc.4"
        for sha in (self.initial, self.rc, self.next, self.tip):
            with self.subTest(sha=sha), self.assertRaisesRegex(ValueError, "outside"):
                self.select(pins={tag: sha})
        item, = self.select(pins={tag: self.control})
        self.assertEqual(item["commit"], self.control)
        self.assertEqual(release.unpublished([item], {tag: self.control}, {tag: {"draft": False}}), [])
        self.assertEqual(release.unpublished([item], {tag: self.control}, {tag: {"draft": True}}), [item])

    def test_existing_pin_at_first_version_matching_sync_survives_an_earlier_fork_version_repair(self):
        self.git("switch", "-qc", "legacy-fork", self.initial)
        self.commit_version("1.1.0-rc.3")
        activation = self.commit_file(".github/fork-release/release.py", "CI3 enabled")
        correction = self.commit_version("1.1.0-rc.4")
        original = self.merge("master")
        later_fork = self.commit_file("later fork work", "fork change")
        self.git("switch", "-q", "master")
        self.commit_file("another upstream change", "third checkpoint")
        self.git("switch", "-q", "legacy-fork")
        later_sync = self.merge("master")
        item, = self.select(activation=activation)
        self.assertEqual((item["commit"], item["upstreamCommit"]), (correction, self.master))
        item, = self.select(activation=activation, pins={item["tag"]: original})
        self.assertEqual((item["commit"], item["upstreamCommit"]), (original, self.new_master))
        for sha in (activation, later_fork, later_sync):
            with self.subTest(sha=sha), self.assertRaisesRegex(ValueError, "outside"):
                self.select(activation=activation, pins={item["tag"]: sha})

    def test_tagless_draft_resumes_only_at_an_eligible_explicit_sha(self):
        tag = "fork-v1.1.0-rc.4"
        self.git("config", f"url.{Path.cwd().as_uri()}.insteadOf", f"https://github.com/{release.UPSTREAM}.git")
        for target in (self.control, self.tip, "fork"):
            releases = {tag: {"draft": True, "target_commitish": target}}
            with self.subTest(target=target), patch.object(release, "remote_tags", return_value={}), \
                    patch.object(release, "release_list", side_effect=lambda repo: self.published if repo == release.UPSTREAM else releases):
                if target == self.control:
                    planned, pending = release.inventory("HEAD")
                    self.assertEqual(pending, planned)
                    self.assertEqual(pending[0]["commit"], self.control)
                else:
                    with self.assertRaises(ValueError):
                        release.inventory("HEAD")

    def test_hashes_assets_and_serves_immutable_installer_urls(self):
        directory = Path("assets")
        directory.mkdir()
        item, = self.select()
        for name in release.asset_names():
            (directory / name).write_text(name)
        metadata = release.manifest(item, directory)
        for channel in ["stable", "nightly"]:
            feeds = release.update_files({**metadata, "channel": channel})
            self.assertEqual(set(feeds), {channel + ext for ext in (".json", ".yml", "-linux.yml")})
            installer, = feeds[channel + "-linux.yml"]["files"]
            name = "dsh-desktop-linux-x64.AppImage"
            self.assertEqual(installer["url"], f"{release.BASE_URL}/{item['tag']}/{name}")
            self.assertEqual(installer["sha512"], base64.b64encode(hashlib.sha512(name.encode()).digest()).decode())
        (directory / "dsh-cli-win-x64.zip").unlink()
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            release.manifest(item, directory)

    def test_publish_requires_draft_digests_before_exposing_release(self):
        item, = self.select()
        assets = Path("fork-dist")
        assets.mkdir()
        for name in release.asset_names():
            (assets / name).write_text(name)
        tag = item["tag"]
        draft = {"id": 123, "draft": True, "assets": []}

        def upload(command, release_tag, *files):
            self.assertEqual((command, release_tag, files[-1]), ("upload", tag, "--clobber"))
            draft["assets"] = [{"name": Path(name).name, "digest": "sha256:" + hashlib.sha256(
                Path(name).read_bytes()).hexdigest()} for name in files[:-1]]

        with patch.object(release, "fetch_default_branch", return_value="HEAD"), \
                patch.object(release, "inventory", return_value=([item], [item])), \
                patch.object(release, "remote_tags", return_value={tag: item["commit"]}), \
                patch.object(release, "release_list", return_value={tag: draft}), \
                patch.object(release, "gh_release") as gh, patch.object(release, "output") as api:
            with self.assertRaisesRegex(ValueError, "Uploaded draft"):
                release.publish(item)
            api.assert_not_called()
            # The next runner downloads the original six package artifacts again.
            (assets / "SHA256SUMS").unlink()
            (assets / "fork-release.json").unlink()
            gh.side_effect = upload
            release.publish(item)
            command, = api.call_args_list
            self.assertIn(f"repos/{release.FORK}/releases/123", command.args)
            self.assertIn("prerelease=true", command.args)
            self.assertIn("draft=false", command.args)

    def test_stable_artifact_download_excludes_release_candidate(self):
        workflow = (Path(__file__).resolve().parents[1] / "workflows/fork-build-release.yml").read_text()
        tag = "${{ fromJSON(inputs.release).tag }}"
        pattern, = [line.split("pattern:", 1)[1].strip() for line in workflow.splitlines()
                    if "pattern:" in line and tag in line]
        name, = [line.split("name:", 1)[1].strip() for line in workflow.splitlines()
                 if "name:" in line and tag in line]
        glob = pattern.replace(tag, "fork-v1.2.0")
        self.assertTrue(fnmatchcase(name.replace(tag, "fork-v1.2.0"), glob))
        self.assertFalse(fnmatchcase(name.replace(tag, "fork-v1.2.0-rc.4"), glob))

    def test_release_order(self):
        versions = ["1.0.0", "1.1.0-rc.2", "1.1.0-rc.10", "1.1.0", "1.10.0"]
        self.assertEqual(sorted(reversed(versions), key=release.version_key), versions)
