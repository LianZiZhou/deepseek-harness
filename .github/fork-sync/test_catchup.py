"""Exercise checkpoint publication and recovery with local Git repositories."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import catchup


class CatchupTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(self.root)
        environment = patch.dict(os.environ, {
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.org",
            "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.org",
            "GITHUB_REPOSITORY": "example/fork", "FORK_BRANCH": "fork",
            "GITHUB_OUTPUT": str(self.root / "output"),
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.source = self.root / "source"
        self.origin = self.root / "origin"
        catchup.git("init", "-q", "-b", "master", str(self.source))
        os.chdir(self.source)
        self.add_commit("common", "base")
        catchup.git("init", "-q", "--bare", str(self.origin))
        catchup.git("switch", "-qc", "fork")
        self.add_commit("common", "fork patch")
        catchup.git("push", "-q", str(self.origin), "fork")
        catchup.git("switch", "-q", "master")
        self.client = self.root / "runner"
        catchup.git("clone", "-q", "-b", "fork", str(self.origin), str(self.client))
        os.chdir(self.client)

    def add_commit(self, path, content):
        (self.source / path).write_text(content)
        catchup.git("-C", str(self.source), "add", path)
        catchup.git("-C", str(self.source), "commit", "-qm", content)
        return catchup.git("-C", str(self.source), "rev-parse", "HEAD")

    def remote_head(self):
        return catchup.git("--git-dir", str(self.origin), "rev-parse", "fork")

    def test_clean_prefix_conflict_repair_and_newer_merge(self):
        clean = self.add_commit("first", "clean")
        conflict = self.add_commit("common", "upstream change")
        with self.assertRaises(catchup.Conflict) as error:
            catchup.catchup("fork", str(self.source))
        self.assertEqual(error.exception.commit, conflict)
        saved = self.remote_head()
        self.assertTrue(catchup.ancestor(clean, saved))
        self.assertFalse(catchup.ancestor(conflict, saved))
        self.assertEqual(catchup.git("show", f"{saved}:common"), "fork patch")

        catchup.git("fetch", "origin", "fork")
        catchup.git("merge", "--ff-only", "FETCH_HEAD")
        failed = subprocess.run(["git", "merge", "--no-edit", conflict], capture_output=True)
        self.assertEqual(failed.returncode, 1)
        Path("common").write_text("resolved fork patch")
        catchup.git("add", "common")
        catchup.git("commit", "-qm", "Resolve fork and upstream changes")
        catchup.git("push", "origin", "HEAD:fork")
        catchup.git("-C", str(self.source), "switch", "-qc", "topic")
        self.add_commit("topic", "side branch")
        catchup.git("-C", str(self.source), "switch", "-q", "master")
        self.add_commit("later", "released while resolving")
        catchup.git("-C", str(self.source), "merge", "--no-ff", "--no-edit", "topic")

        head, target = catchup.catchup("fork", str(self.source))
        self.assertEqual(self.remote_head(), head)
        self.assertTrue(catchup.ancestor(target, head))
        self.assertTrue(catchup.ancestor(saved, head))
        self.assertEqual(catchup.git("show", f"{head}:common"), "resolved fork patch")
        self.assertEqual(catchup.git("show", f"{head}:topic"), "side branch")
        self.assertEqual(catchup.catchup("fork", str(self.source)), (head, target))

    def test_shared_topic_does_not_restore_a_file_deleted_by_the_fork(self):
        repo = str(self.source)
        catchup.git("-C", repo, "switch", "-qc", "topic")
        self.add_commit("topic-file", "shared topic")
        catchup.git("-C", repo, "switch", "-q", "fork")
        catchup.git("-C", repo, "merge", "--no-ff", "--no-edit", "topic")
        catchup.git("-C", repo, "rm", "topic-file")
        catchup.git("-C", repo, "commit", "-qm", "Drop topic file in fork")
        catchup.git("-C", repo, "push", str(self.origin), "fork")
        catchup.git("-C", repo, "switch", "-q", "master")
        self.add_commit("new", "new mainline change")
        catchup.git("-C", repo, "merge", "--no-ff", "--no-edit", "topic")
        head, _ = catchup.catchup("fork", repo)
        self.assertEqual(catchup.git("ls-tree", "--name-only", head, "topic-file"), "")

    def test_recovery_closes_repaired_issue_and_reopens_known_next_conflict(self):
        integrated = self.add_commit("clean", "part of the repaired history")
        blocked = self.add_commit("common", "conflicting change")
        commands = []
        real_command = catchup.command

        def record(*args, **kwargs):
            if args[0] == "gh":
                commands.append(args)
                return
            return real_command(*args, **kwargs)

        with patch.object(catchup, "issues", side_effect=[{integrated: 7}, {blocked: 9}]), \
             patch.object(catchup, "command", side_effect=record), \
             patch.object(catchup, "UPSTREAM", str(self.source)):
            with self.assertRaises(catchup.Conflict):
                catchup.run(True)
        self.assertEqual([c[2:4] for c in commands], [("close", "7"), ("reopen", "9")])

    def test_remote_rejection_keeps_earlier_checkpoints_retryable(self):
        clean = self.add_commit("first", "clean prefix")
        rejected = self.add_commit("rejected", "push denied")
        hook = self.origin / "hooks" / "pre-receive"
        hook.write_text('#!/bin/sh\nread old new ref\n! git cat-file -e "$new:rejected" 2>/dev/null\n')
        hook.chmod(0o755)
        with self.assertRaises(subprocess.CalledProcessError):
            catchup.catchup("fork", str(self.source))
        saved = self.remote_head()
        self.assertTrue(catchup.ancestor(clean, saved))
        self.assertFalse(catchup.ancestor(rejected, saved))
        hook.unlink()
        head, target = catchup.catchup("fork", str(self.source))
        self.assertTrue(catchup.ancestor(saved, head))
        self.assertEqual(target, rejected)

    def test_hourly_pauses_before_fetch_and_recovery_deduplicates_issue(self):
        conflict = self.add_commit("common", "conflicting change")
        with patch.object(catchup, "issues", return_value={conflict: 42}):
            with patch.object(catchup, "catchup") as sync:
                catchup.run(False)
                sync.assert_not_called()
            with patch.object(catchup, "UPSTREAM", str(self.source)):
                with self.assertRaises(catchup.Conflict):
                    catchup.run(True)
        self.assertFalse((self.root / "output").exists())


if __name__ == "__main__":
    unittest.main()
