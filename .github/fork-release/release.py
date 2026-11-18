"""Select exact fork checkpoints, publish immutable build sets and reconcile updater feeds."""

import base64
from bisect import bisect_left
from functools import cache
import hashlib
import json
import os
from pathlib import Path
from urllib.request import urlopen
import re
import subprocess
import sys
import tempfile

FORK = "LianZiZhou/deepseek-harness"
UPSTREAM = "deepseek-ai/deepseek-harness"
FEED = "fork-feed"
BASE_URL = f"https://github.com/{FORK}/releases/download"
SHA = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?", re.ASCII)
DESKTOP = {"linux-x64": "AppImage", "win-x64": "exe", "mac-arm64": "dmg"}
CLI = {"linux-x64": "tar.gz", "win-x64": "zip", "mac-arm64": "tar.gz"}


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def release_list(repository):
    """Read every release, including recoverable drafts when using the fork token."""
    pages = json.loads(output("gh", "api", "--paginate", "--slurp",
                              f"repos/{repository}/releases?per_page=100"))
    return {r["tag_name"]: r for page in pages for r in page}


def remote_tags(repository, pattern):
    refs = output("git", "ls-remote", "--tags", f"https://github.com/{repository}.git", f"refs/tags/{pattern}")
    objects = {}
    peeled = {}
    for line in refs.splitlines():
        sha, ref = line.split()
        tag = ref.removeprefix("refs/tags/")
        if tag.endswith("^{}"):
            peeled[tag[:-3]] = sha
        else:
            objects[tag] = sha
    return objects | peeled


def version_key(version):
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError(f"Invalid product version {version!r}")
    major, minor, patch, suffix = match.groups()
    parts = suffix.split(".") if suffix else []
    if any(p.isdigit() and len(p) > 1 and p[0] == "0" for p in parts):
        raise ValueError(f"Invalid prerelease number in {version}")
    return (int(major), int(minor), int(patch), not suffix,
            tuple((0, int(p)) if p.isdigit() else (1, p) for p in parts))


def history(ref):
    """Read physical parent IDs; git rev-list --first-parent --parents can simplify ancestry."""
    return [line.split() for line in output("git", "log", "--first-parent", "--format=%H %P", ref).splitlines()]


@cache
def product_at(commit):
    return json.loads(output("git", "show", f"{commit}:apps/desktop/package.json"))["version"]


def checkpoints(rows, master, activation):
    """Start capturing at CI3 installation, including a separate setup commit atop a manual sync."""
    latest = None
    captured = []
    active = False
    for row in reversed(rows):
        fork = row[0]
        merged = len(row) == 3 and row[2] in master and fork not in master
        if merged:
            latest = row[2]
        active = active or fork == activation
        if active and latest and (merged or fork == activation):
            captured.append((fork, latest))
    return captured


def contains_tag(master, tag_commit):
    result = subprocess.run(["git", "merge-base", "--is-ancestor", tag_commit, master])
    if result.returncode not in (0, 1):
        result.check_returncode()
    return result.returncode == 0


def select(rows, captured, tags, publications, sync="", upstream=""):
    planned = []
    if sync or upstream:
        if not SHA.fullmatch(sync) or not SHA.fullmatch(upstream):
            raise ValueError("A successful sync must supply both full SHAs")
        position = next((i for i, row in enumerate(rows) if row[0] == sync), None)
        if position is None:
            raise ValueError("Sync SHA is outside the default branch's first-parent history")
        captures = dict(captured)
        integrated = next((captures[r[0]] for r in rows[position:] if r[0] in captures), None)
        if upstream != integrated:
            raise ValueError("The supplied upstream SHA differs from the selected fork head's checkpoint")
        product = product_at(sync)
        version_key(product)
        prefix = product if "-" in product else product + "-test"
        planned.append(dict(tag=f"fork-nightly-{sync}", channel="nightly", prerelease=True,
                            version=f"{prefix}.{len(rows) - position}", commit=sync,
                            upstreamCommit=upstream, upstreamTag=None, upstreamTagCommit=None))

    if not captured:
        return planned
    for tag, publication in publications.items():
        if publication.get("draft") or not publication.get("published_at") or not tag.startswith("dsh-v"):
            continue
        version = tag[5:]
        if not VERSION.fullmatch(version):
            continue
        version_key(version)
        if tag not in tags:
            raise ValueError(f"Published upstream release {tag} has no tag ref")
        tag_commit = tags[tag]
        # A publication on a release branch can precede its merge into master.
        if not contains_tag(captured[-1][1], tag_commit):
            continue
        start = bisect_left(captured, True, key=lambda pair: contains_tag(pair[1], tag_commit))
        match = next(((fork, master) for fork, master in captured[start:]
                      if product_at(fork) == version and product_at(master) == version), None)
        if match:
            fork, master = match
            planned.append(dict(tag=f"fork-v{version}", channel="stable", version=version, commit=fork,
                                prerelease=bool("-" in version or publication["prerelease"]),
                                upstreamCommit=master, upstreamTag=tag, upstreamTagCommit=tag_commit))
    return planned


def inventory(ref, sync="", upstream=""):
    # Fetch published tag objects too: future releases need not have reached master or the fork yet.
    output("git", "fetch", "--no-tags", f"https://github.com/{UPSTREAM}.git",
           "+refs/heads/master:refs/ci3/master", "+refs/tags/dsh-v*:refs/ci3/publications/dsh-v*")
    master = set(output("git", "rev-list", "--first-parent", "refs/ci3/master").splitlines())
    refs = output("git", "for-each-ref", "--format=%(refname:strip=3)", "refs/ci3/publications")
    tags = {tag: output("git", "rev-parse", f"refs/ci3/publications/{tag}^{{commit}}") for tag in refs.splitlines()}
    rows = history(ref)
    added = output("git", "log", "--first-parent", "--format=%H", "--diff-filter=A", ref, "--",
                   ".github/fork-release/release.py").splitlines()
    if not added:
        raise ValueError("CI3 installation commit is missing from the selected branch")
    return select(rows, checkpoints(rows, master, added[-1]), tags, release_list(UPSTREAM), sync, upstream)


def unpublished(planned):
    releases = release_list(FORK)
    tags = remote_tags(FORK, "fork-*")
    pending = []
    for item in planned:
        tag = item["tag"]
        if tag in tags and tags[tag] != item["commit"]:
            raise ValueError(f"Existing fork tag {tag} points at a different commit")
        if tag not in releases or releases[tag]["draft"]:
            pending.append(item)
        elif tag not in tags:
            raise ValueError(f"Published fork release {tag} has lost its tag")
    return pending


def asset_names():
    return {f"dsh-{product}-{target}.{ext}" for product, formats in (("desktop", DESKTOP), ("cli", CLI))
            for target, ext in formats.items()}


def manifest(item, directory):
    files = {p.name for p in directory.iterdir() if p.is_file()}
    required = asset_names()
    if not required <= files or files - required - {"dsh-desktop-win-x64.exe.blockmap"}:
        raise ValueError(f"Incomplete or unexpected distribution files: {sorted(files ^ required)}")
    assets = []
    for name in sorted(files):
        sha256, sha512 = hashlib.sha256(), hashlib.sha512()
        path = directory / name
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                sha256.update(chunk)
                sha512.update(chunk)
        if not 0 < path.stat().st_size < 2**31:
            raise ValueError(f"Invalid release asset size: {name}")
        assets.append(dict(name=name, size=path.stat().st_size, sha256=sha256.hexdigest(),
                           sha512=base64.b64encode(sha512.digest()).decode(),
                           url=f"{BASE_URL}/{item['tag']}/{name}"))
    return {"schemaVersion": 1, **item, "assets": assets}


def gh_release(*args):
    return output("gh", "release", *args, "--repo", FORK)


def publish(item):
    default = fetch_default_branch()
    nightly = item["channel"] == "nightly"
    planned = inventory(default, item["commit"] if nightly else "", item["upstreamCommit"] if nightly else "")
    if item not in planned:
        raise ValueError("Fork checkpoint, upstream tag, or publication changed during the build")
    if not unpublished([item]):
        return
    directory = Path("fork-dist")
    release = manifest(item, directory)
    (directory / "fork-release.json").write_text(json.dumps(release, indent=2) + "\n")
    (directory / "SHA256SUMS").write_text("".join(f"{a['sha256']}  {a['name']}\n" for a in release["assets"]))
    tag, commit = item["tag"], item["commit"]
    if tag not in remote_tags(FORK, tag):
        output("gh", "api", "-X", "POST", f"repos/{FORK}/git/refs", "-f", f"ref=refs/tags/{tag}", "-f", f"sha={commit}")
    if remote_tags(FORK, tag).get(tag) != commit:
        raise ValueError(f"Fork tag {tag} no longer points to {commit}")
    if tag not in release_list(FORK):
        notes = (f"Fork {commit}, upstream {item['upstreamCommit']}.\n\n"
                 "Download the Desktop installer or extract the CLI archive and run dsh (dsh.cmd on Windows). "
                 "Packages are unsigned. macOS uses an ad-hoc signature and requires manual installation.")
        gh_release("create", tag, "--verify-tag", "--draft", "--title", tag, "--notes", notes)
    gh_release("upload", tag, *map(str, sorted(directory.iterdir())), "--clobber")
    draft = release_list(FORK)[tag]
    expected = {a["name"]: "sha256:" + a["sha256"] for a in release["assets"]}
    for filename in ("fork-release.json", "SHA256SUMS"):
        expected[filename] = "sha256:" + hashlib.sha256((directory / filename).read_bytes()).hexdigest()
    observed = {a["name"]: a.get("digest") for a in draft["assets"]}
    if not draft["draft"] or observed != expected:
        raise ValueError(f"Uploaded draft {tag} differs from its verified distribution set")
    # Publication makes the complete build visible in one operation.
    output("gh", "api", "-X", "PATCH", f"repos/{FORK}/releases/{draft['id']}",
           "-F", "draft=false", "-F", f"prerelease={str(item['prerelease']).lower()}",
           "-f", "make_latest=false" if item["prerelease"] else "make_latest=legacy")


def update_files(release):
    channel = release["channel"]
    files = {channel + ".json": release}
    for target, suffix in (("win-x64", ""), ("linux-x64", "-linux")):
        name = f"dsh-desktop-{target}.{DESKTOP[target]}"
        asset, = (a for a in release["assets"] if a["name"] == name)
        url = f"{BASE_URL}/{release['tag']}/{name}"
        files[channel + suffix + ".yml"] = {
            "version": release["version"], "path": url, "sha512": asset["sha512"],
            "files": [{"url": url, "size": asset["size"], "sha512": asset["sha512"]}],
        }
    return files


def fetch_default_branch():
    ref = f"refs/heads/{os.environ['DEFAULT_BRANCH']}"
    output("git", "fetch", "--no-tags", f"https://github.com/{FORK}.git", f"+{ref}:refs/ci3/default")
    return "refs/ci3/default"


def feeds():
    default = fetch_default_branch()
    releases = release_list(FORK)
    current = releases.get(FEED)
    available = {tag: r for tag, r in releases.items() if not r["draft"]}
    stable = [tag for tag in available if tag.startswith("fork-v") and VERSION.fullmatch(tag[6:])]
    selected = [max(stable, key=lambda tag: version_key(tag[6:]))] if stable else []
    # Fully synced fork heads, including fork-only commits, are ordered by first-parent history.
    nightly = next((f"fork-nightly-{row[0]}" for row in history(default)
                    if f"fork-nightly-{row[0]}" in available), None)
    if nightly:
        selected.append(nightly)
    if not selected:
        return
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        published = {a["name"]: a["digest"] for a in current["assets"]} if current else {}
        changes = []
        for tag in selected:
            data = json.loads(gh_release("download", tag, "-p", "fork-release.json", "-O", "-"))
            if data["tag"] != tag or data["channel"] != ("nightly" if tag == nightly else "stable"):
                raise ValueError(f"Unexpected manifest identity for {tag}")
            for filename, content in update_files(data).items():
                path = directory / filename
                path.write_bytes((json.dumps(content, indent=2) + "\n").encode())
                if published.get(filename) != "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest():
                    changes.append(str(path))
        if not current:
            gh_release("create", FEED, "--target", os.environ["GITHUB_SHA"], "--draft", "--prerelease",
                       "--title", "Fork update feeds", "--notes", "Desktop and CLI update metadata.")
        if changes:
            gh_release("upload", FEED, *changes, "--clobber")
        if not current or current["draft"]:
            gh_release("edit", FEED, "--draft=false", "--latest=false")
        for file in changes:
            path = Path(file)
            with urlopen(f"{BASE_URL}/{FEED}/{path.name}", timeout=30) as response:
                if response.read() != path.read_bytes():
                    raise ValueError(f"Public feed differs from the published manifest: {path.name}")


if __name__ == "__main__":
    if os.environ["GITHUB_REPOSITORY"].lower() != FORK.lower():
        sys.exit("CI3 runs only in the fork")
    mode, = sys.argv[1:]
    if mode == "plan":
        if (os.getenv("SYNC_SHA") or os.getenv("UPSTREAM_SHA")) and os.environ["GITHUB_ACTOR"] != "github-actions[bot]":
            sys.exit("Run Fork upstream sync to request a nightly. Manual release reconciliation takes no SHAs.")
        pending = unpublished(inventory("HEAD", os.getenv("SYNC_SHA", ""), os.getenv("UPSTREAM_SHA", "")))
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            print("releases=" + json.dumps(pending, separators=(",", ":")), file=stream)
    elif mode == "publish":
        publish(json.loads(os.environ["FORK_RELEASE"]))
    elif mode == "feeds":
        feeds()
    else:
        sys.exit(f"Unknown mode {mode}")
