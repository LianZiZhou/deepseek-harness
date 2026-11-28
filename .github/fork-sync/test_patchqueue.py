"""Exercise topic classification and topic-scoped replay with a local Git repository."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import patchqueue

MANIFEST = """
[generated]
paths = ["docs/catalog.md", "**/*.i18n.yaml"]
[lockfile]
paths = ["pnpm-lock.yaml"]
[[topic]]
id = "alpha"
title = "Alpha"
paths = ["alpha/**", "shared/{a,b}.ts"]
[[topic]]
id = "beta"
title = "Beta"
paths = ["beta/*.ts"]
"""


class PatchQueueTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.addCleanup(os.chdir, os.getcwd())
        environment = patch.dict(os.environ, {
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.org",
            "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.org",
        })
        environment.start()
        self.addCleanup(environment.stop)
        (self.root / "topics.toml").write_text(MANIFEST)
        self.manifest = patchqueue.Manifest(self.root / "topics.toml")
        self.repo = self.root / "repo"
        patchqueue.git("init", "-q", "-b", "master", str(self.repo))
        os.chdir(self.repo)
        self.base = self.commit({"alpha/x.ts": "a\n", "beta/y.ts": "b\n", "docs/catalog.md": "c\n",
                                 "pnpm-lock.yaml": "l\n", "shared/a.ts": "s\n"})

    def commit(self, files):
        for path, content in files.items():
            target = self.repo / path
            if content is None:
                patchqueue.git("rm", "-q", path)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
            patchqueue.git("add", path)
        patchqueue.git("commit", "-qm", "change")
        return patchqueue.git("rev-parse", "HEAD").stdout.strip()

    def show(self, commit, path):
        return patchqueue.git("show", f"{commit}:{path}").stdout

    def fork(self, files):
        patchqueue.git("switch", "-qc", "fork", self.base)
        head = self.commit(files)
        patchqueue.git("switch", "-q", "master")
        return head

    def test_classify_reports_owners_and_unowned_paths(self):
        head = self.fork({"alpha/x.ts": "A\n", "beta/y.ts": "B\n", "beta/deep/z.ts": "Z\n",
                          "docs/catalog.md": "C\n", "docs/x.i18n.yaml": "h\n", "pnpm-lock.yaml": "L\n"})
        owners, unowned = patchqueue.classify(self.manifest, self.base, head)
        self.assertEqual(owners, {"alpha": ["alpha/x.ts"], "beta": ["beta/y.ts"],
                                  "generated": ["docs/catalog.md", "docs/x.i18n.yaml"],
                                  "lockfile": ["pnpm-lock.yaml"]})
        self.assertEqual(unowned, ["beta/deep/z.ts"])
        with self.assertRaises(SystemExit):
            patchqueue.replay(self.manifest, self.base, head, self.base)

    def test_replay_scopes_conflicts_to_one_topic_and_keeps_upstream_derived_files(self):
        head = self.fork({"alpha/x.ts": "fork\n", "beta/y.ts": "B\n", "shared/a.ts": None,
                          "docs/catalog.md": "fork catalog\n", "pnpm-lock.yaml": "fork lock\n"})
        upstream = self.commit({"alpha/x.ts": "upstream\n", "docs/catalog.md": "new catalog\n",
                                "pnpm-lock.yaml": "new lock\n"})
        tip, results, _ = patchqueue.replay(self.manifest, self.base, head, upstream, blame=True)
        self.assertEqual([(r["topic"], r["conflicts"]) for r in results],
                         [("alpha", ["alpha/x.ts"]), ("beta", [])])
        self.assertEqual(results[0]["first_conflicting_upstream"], upstream)
        self.assertEqual(self.show(tip, "beta/y.ts"), "B\n")
        self.assertEqual(self.show(tip, "docs/catalog.md"), "new catalog\n")
        self.assertEqual(self.show(tip, "pnpm-lock.yaml"), "new lock\n")
        self.assertNotIn("shared/a.ts", patchqueue.git("ls-tree", "-r", "--name-only", tip).stdout)
        message = patchqueue.git("log", "-1", "--format=%B", results[0]["commit"]).stdout
        self.assertIn("Fork-Topic: alpha\nFork-Conflict: alpha/x.ts", message)

    def test_replay_onto_its_own_base_reproduces_every_topic_path(self):
        head = self.fork({"alpha/new.ts": "n\n", "beta/y.ts": "B\n", "shared/a.ts": "S\n"})
        tip, results, _ = patchqueue.replay(self.manifest, self.base, head, self.base)
        self.assertFalse(any(r["conflicts"] for r in results))
        self.assertEqual(patchqueue.git("diff", "--name-only", tip, head).stdout, "")


if __name__ == "__main__":
    unittest.main()
