"""Reapply the fork's cumulative patch to successive upstream first-parent commits."""

import argparse
import json
import os
from pathlib import Path
import subprocess

UPSTREAM = "https://github.com/deepseek-ai/deepseek-harness.git"
ISSUE_MARKER = "<!-- fork-upstream-conflict "
TRAILER = "Fork-Upstream"


def command(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def git(*args):
    return command("git", *args, stdout=subprocess.PIPE).stdout.strip()


def ancestor(commit, tip):
    result = subprocess.run(["git", "merge-base", "--is-ancestor", commit, tip])
    if result.returncode not in (0, 1):
        result.check_returncode()
    return result.returncode == 0


class Conflict(Exception):
    """The fork patch has unresolved paths at this upstream commit."""

    def __init__(self, commit, fork):
        self.fork = fork
        self.commit = commit
        super().__init__(f"Conflict at upstream commit {commit}")


def catchup(branch, source, upstream_branch="master"):
    """Push each clean checkpoint and return the fully integrated fork and upstream tips."""
    destination = f"refs/heads/{branch}"
    git("fetch", "--no-tags", "origin", destination)
    fork = git("rev-parse", "FETCH_HEAD^{commit}")
    git("fetch", "--no-tags", source, f"refs/heads/{upstream_branch}")
    target = git("rev-parse", "FETCH_HEAD^{commit}")

    # A rewritten upstream must not silently replay an unrelated replacement history.
    previous = git("log", "-1", "--first-parent", "--grep", f"^{TRAILER}: [0-9a-f]\\{{40\\}}$",
                   "--format=%(trailers:key=Fork-Upstream,valueonly)", fork)
    if previous and not ancestor(previous, target):
        raise RuntimeError(f"Upstream history no longer contains checkpoint {previous}")
    git("merge-base", fork, target)
    pending = git("rev-list", "--first-parent", "--reverse", target, f"^{fork}").splitlines()
    if pending and not ancestor(git("rev-parse", f"{pending[0]}^1"), fork):
        raise RuntimeError("First pending upstream commit has no integrated first parent")
    for commit in pending:
        # A topic branch can already be shared with the fork before it lands on master.
        merged = subprocess.run(["git", "merge-tree", "--write-tree", commit, fork],
                                text=True, stdout=subprocess.PIPE)
        if merged.returncode == 1:
            print(merged.stdout, flush=True)
            raise Conflict(commit, fork)
        merged.check_returncode()
        tree = merged.stdout.splitlines()[0]
        subject = git("show", "-s", "--format=%s", commit)
        checkpoint = git("commit-tree", tree, "-p", fork, "-p", commit,
                         "-m", f"Sync upstream: {subject}", "-m", f"{TRAILER}: {commit}")
        # Normal fast-forward push protects intervening fork commits and persists the prefix.
        git("push", "origin", f"{checkpoint}:{destination}")
        fork = checkpoint
    return fork, target


def issues(repo, state="open"):
    result = command("gh", "api", "--paginate", "--slurp",
                     f"repos/{repo}/issues?state={state}&creator=github-actions%5Bbot%5D&per_page=100",
                     stdout=subprocess.PIPE)
    blockers = {}
    for page in json.loads(result.stdout):
        for issue in page:
            line = (issue.get("body") or "").partition("\n")[0].strip()
            if line.startswith(ISSUE_MARKER) and line.endswith(" -->"):
                commit = line[len(ISSUE_MARKER):-4]
                if len(commit) == 40 and all(c in "0123456789abcdef" for c in commit):
                    blockers[commit] = issue["number"]
    return blockers


def run(recovery):
    repo = os.environ["GITHUB_REPOSITORY"]
    branch = os.environ["FORK_BRANCH"]
    blockers = issues(repo)
    if blockers and not recovery:
        print("Hourly sync paused by open conflict issue(s):", *blockers.values())
        return

    try:
        head, upstream = catchup(branch, UPSTREAM)
    except Conflict as conflict:
        for commit, number in blockers.items():
            if ancestor(commit, conflict.fork):
                command("gh", "issue", "close", str(number), "-R", repo)
        if conflict.commit in blockers:
            raise
        closed = issues(repo, "closed")
        if conflict.commit in closed:
            command("gh", "issue", "reopen", str(closed[conflict.commit]), "-R", repo)
        else:
            body = (f"{ISSUE_MARKER}{conflict.commit} -->\n"
                    f"Upstream commit [`{conflict.commit}`](https://github.com/deepseek-ai/"
                    f"deepseek-harness/commit/{conflict.commit}) conflicts with `{branch}`. "
                    "Earlier clean commits have been pushed. Resolve this commit on the fork's "
                    "default branch, then run **Fork upstream catchup**. "
                    f"See the [recovery steps](https://github.com/{repo}/blob/HEAD/.github/fork-sync/README.md).")
            command("gh", "issue", "create", "-R", repo, "--title",
                    f"Upstream sync conflict at {conflict.commit[:12]}", "--body", body)
        raise

    for commit, number in blockers.items():
        if ancestor(commit, head):
            command("gh", "issue", "close", str(number), "-R", repo)
        else:
            raise RuntimeError(f"Unresolved issue #{number} references {commit} outside synced history")

    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        print(f"head={head}\nupstream={upstream}", file=output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recovery", action="store_true", help="retry while a conflict issue is open")
    run(parser.parse_args().recovery)
