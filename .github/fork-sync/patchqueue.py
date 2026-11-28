"""Split the fork's cumulative change into topic patches and replay them onto an upstream commit.

The fork's change is the tree difference between an integrated upstream commit (`--base`) and a
fork commit (`--head`). `topics.toml` assigns each changed path to one topic, to `generated`, or
to `lockfile`. Topic paths are disjoint, so each topic replays as an independent three-way merge
and a conflict belongs to exactly one topic. Generated paths and the lockfile keep the upstream
content during replay; the caller rebuilds them afterwards.

Only Git plumbing is used: no worktree, index or ref of the caller's checkout changes unless
`queue --update-ref` names a ref.
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import tomllib

MANIFEST = Path(__file__).with_name("topics.toml")


def git(*args, env=None, check=True, input=None):
    result = subprocess.run(["git", *args], text=True, input=input, env=env,
                            stdout=subprocess.PIPE, check=False)
    if check and result.returncode:
        raise subprocess.CalledProcessError(result.returncode, ["git", *args], result.stdout)
    return result


def expand_braces(pattern):
    match = re.search(r"\{([^{}]*)\}", pattern)
    if not match:
        return [pattern]
    head, tail = pattern[:match.start()], pattern[match.end():]
    return [p for alt in match.group(1).split(",") for p in expand_braces(head + alt + tail)]


def glob_regex(pattern):
    """Translate one brace-free glob to a regex anchored at the repository root."""
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("/**", i) and i + 3 == len(pattern):
            out.append("/.*")
            i += 3
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


class Matcher:
    def __init__(self, patterns):
        self.patterns = patterns
        self.regexes = [glob_regex(p) for pattern in patterns for p in expand_braces(pattern)]

    def __call__(self, path):
        return any(r.match(path) for r in self.regexes)


class Manifest:
    def __init__(self, path=MANIFEST):
        data = tomllib.loads(Path(path).read_text())
        self.generated = Matcher(data["generated"]["paths"])
        self.generated_commands = data["generated"].get("commands", [])
        self.pairing = data["generated"].get("pairing")
        self.lockfile = Matcher(data["lockfile"]["paths"])
        self.lockfile_command = data["lockfile"].get("command")
        self.topics = [(t["id"], t["title"], Matcher(t["paths"])) for t in data["topic"]]
        ids = [t[0] for t in self.topics]
        if len(set(ids)) != len(ids):
            raise SystemExit("topics.toml: duplicate topic id")

    def owner(self, path):
        if self.lockfile(path):
            return "lockfile"
        if self.generated(path):
            return "generated"
        for topic, _, matcher in self.topics:
            if matcher(path):
                return topic
        return None


def changed_paths(base, head):
    out = git("diff", "--name-only", "--no-renames", "-z", base, head).stdout
    return [p for p in out.split("\0") if p]


def classify(manifest, base, head):
    owners, unowned = {}, []
    for path in changed_paths(base, head):
        owner = manifest.owner(path)
        if owner is None:
            unowned.append(path)
        else:
            owners.setdefault(owner, []).append(path)
    return owners, unowned


def overlay_tree(base, head, paths):
    """Return the tree of `base` with `paths` taken from `head` (deleted where `head` lacks them)."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        git("read-tree", base, env=env)
        present = {}
        for chunk in range(0, len(paths), 500):
            out = git("ls-tree", "-r", "-z", "--full-tree", head, "--", *paths[chunk:chunk + 500]).stdout
            for entry in filter(None, out.split("\0")):
                meta, path = entry.split("\t", 1)
                present[path] = meta
        lines = []
        for path in paths:
            if path in present:
                mode, _, sha = present[path].split()
                lines.append(f"{mode} {sha}\t{path}")
            else:
                lines.append(f"0 {'0' * 40}\t{path}")
        git("update-index", "-z", "--index-info", input="".join(l + "\0" for l in lines), env=env)
        return git("write-tree", env=env).stdout.strip()


def commit_tree(tree, parents, message):
    args = ["commit-tree", tree]
    for parent in parents:
        args += ["-p", parent]
    return git(*args, "-m", message).stdout.strip()


def conflicts_with(base, upstream, side):
    merged = git("merge-tree", "--write-tree", "--name-only", "--no-messages", "-z",
                 f"--merge-base={base}", upstream, side, check=False)
    if merged.returncode not in (0, 1):
        raise subprocess.CalledProcessError(merged.returncode, "git merge-tree", merged.stdout)
    tree, *paths = [p for p in merged.stdout.split("\0") if p]
    return tree, sorted(set(paths))


def first_conflict(base, onto, side):
    """Binary-search the first-parent upstream commit in base..onto that first conflicts with `side`.

    Topic paths are disjoint from every other topic, so the search needs no earlier topic.
    A conflict that appears and later disappears can make the result an upper bound.
    """
    commits = git("rev-list", "--first-parent", "--reverse", onto, f"^{base}").stdout.split()
    low, high = 0, len(commits) - 1
    while low < high:
        middle = (low + high) // 2
        if conflicts_with(base, commits[middle], side)[1]:
            high = middle
        else:
            low = middle + 1
    return commits[low] if commits else None


def replay(manifest, base, head, onto, blame=False):
    """Replay every topic of base..head onto `onto`; return the queue tip and per-topic results."""
    owners, unowned = classify(manifest, base, head)
    if unowned:
        raise SystemExit("Paths claimed by no topic:\n  " + "\n  ".join(unowned))
    tip, results = git("rev-parse", f"{onto}^{{commit}}").stdout.strip(), []
    for topic, title, _ in manifest.topics:
        paths = owners.get(topic, [])
        if not paths:
            continue
        side = commit_tree(overlay_tree(base, head, paths), [base], f"fork({topic}) at base")
        tree, conflicts = conflicts_with(base, tip, side)
        message = (f"fork({topic}): {title}\n\nFork-Topic: {topic}\n"
                   + "".join(f"Fork-Conflict: {p}\n" for p in conflicts))
        tip = commit_tree(tree, [tip], message)
        result = {"topic": topic, "files": len(paths), "conflicts": conflicts, "commit": tip}
        if conflicts and blame:
            result["first_conflicting_upstream"] = first_conflict(base, onto, side)
        results.append(result)
    return tip, results, owners


def cmd_classify(args, manifest):
    owners, unowned = classify(manifest, args.base, args.head)
    order = ["generated", "lockfile"] + [t[0] for t in manifest.topics]
    for owner in order:
        if owner in owners:
            print(f"{owner}\t{len(owners[owner])}")
            if args.verbose:
                for path in owners[owner]:
                    print(f"  {path}")
    for path in unowned:
        print(f"UNOWNED\t{path}")
    return 1 if unowned else 0


def cmd_export(args, manifest):
    owners, unowned = classify(manifest, args.base, args.head)
    if unowned:
        raise SystemExit("Paths claimed by no topic:\n  " + "\n  ".join(unowned))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    series = []
    for index, (topic, title, _) in enumerate(t for t in manifest.topics if t[0] in owners):
        name = f"{index + 1:02d}-{topic}.patch"
        diff = git("diff", "--binary", "--full-index", "--no-renames", args.base, args.head,
                   "--", *owners[topic]).stdout
        (out / name).write_text(f"Subject: fork({topic}): {title}\n\n{diff}")
        series.append(name)
    (out / "series").write_text("".join(f"{name}\n" for name in series))
    print(f"Wrote {len(series)} topic patches to {out}")
    return 0


def cmd_queue(args, manifest):
    tip, results, owners = replay(manifest, args.base, args.head, args.onto, args.blame)
    if args.update_ref:
        git("update-ref", args.update_ref, tip)
    report = {"base": args.base, "head": args.head, "onto": args.onto, "tip": tip,
              "excluded": {k: len(owners.get(k, [])) for k in ("generated", "lockfile")},
              "topics": results}
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for r in results:
            state = f"CONFLICT {len(r['conflicts'])}" if r["conflicts"] else "clean"
            first = r.get("first_conflicting_upstream")
            blame = f"  first at {git('log', '-1', '--format=%h %s', first).stdout.strip()}" if first else ""
            print(f"{r['topic']:<24} {r['files']:>4} files  {state}{blame}")
            for path in r["conflicts"]:
                print(f"    {path}")
        print(f"queue tip {tip}")
    return 1 if any(r["conflicts"] for r in results) else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--manifest", default=MANIFEST)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("classify", "export", "queue"):
        p = sub.add_parser(name)
        p.add_argument("--base", required=True, help="integrated upstream commit")
        p.add_argument("--head", required=True, help="fork commit whose change is split")
        if name == "classify":
            p.add_argument("-v", "--verbose", action="store_true")
        if name == "export":
            p.add_argument("--out", required=True)
        if name == "queue":
            p.add_argument("--onto", required=True, help="upstream commit to replay onto")
            p.add_argument("--update-ref", help="ref that receives the queue tip")
            p.add_argument("--json", action="store_true")
            p.add_argument("--blame", action="store_true",
                           help="name the first upstream commit each conflicting topic conflicts with")
    args = parser.parse_args(argv)
    manifest = Manifest(args.manifest)
    return {"classify": cmd_classify, "export": cmd_export, "queue": cmd_queue}[args.command](args, manifest)


if __name__ == "__main__":
    sys.exit(main())
