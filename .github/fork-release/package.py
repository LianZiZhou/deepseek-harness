"""Package from the selected checkout and exercise the extracted, relocatable CLI."""

import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

from release import CLI, DESKTOP


def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


def desktop(target, release, output, pnpm):
    if target == "win-x64":
        Path("apps/desktop/.env.windows").write_text(
            "DSH_DESKTOP_APP_ID=io.github.lianzizhou.dsh-desktop\nDSH_DESKTOP_AUTO_UPDATE_ENV=fork\n",
            encoding="utf-8")
    run(pnpm, "run", "package:desktop:" + target.replace("-", ":") + ":unsigned",
        "--build-version", release["version"], "--official-branding")
    folder = Path("apps/desktop/.desktop-build/targets") / target / "unsigned-artifacts"
    installer, = folder.glob("*." + DESKTOP[target])
    name = f"dsh-desktop-{target}.{DESKTOP[target]}"
    shutil.move(installer, output / name)
    blockmap = installer.with_name(installer.name + ".blockmap")
    if target == "win-x64" and blockmap.exists():
        shutil.move(blockmap, output / (name + ".blockmap"))


def cli(target, release, output, pnpm):
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp).resolve() / "dsh"
        run(pnpm, "--filter", "dsh-python-runtime-closure", "deploy", "--prod",
            "--config.allow-unused-patches=true", "--config.node-linker=hoisted",
            f"--config.pnpmfile={Path('scripts/python-runtime-deploy.pnpmfile.mjs').resolve()}",
            "--config.link-workspace-packages=true", "--config.hoist-workspace-packages=false", str(stage))
        run("node", "--import", "tsx/esm", str(Path(__file__).with_name("prepare-cli.mjs")), str(stage), target)
        archive = output / f"dsh-cli-{target}.{CLI[target]}"
        # Native bsdtar on Windows supports ZIP; POSIX tar preserves the executable modes.
        launcher_name = "dsh.cmd" if target == "win-x64" else "dsh"
        files = ["node_modules", "runtime", "LICENSE", "fork-release.json", launcher_name]
        run("tar", "-acf" if target == "win-x64" else "-czf", str(archive), "-C", tmp,
            *("dsh/" + name for name in files))
        shutil.rmtree(stage)
        extracted = Path(tmp) / "relocated install"
        extracted.mkdir()
        run("tar", "-xf", str(archive), "-C", str(extracted))
        launcher = extracted / "dsh" / ("dsh.cmd" if target == "win-x64" else "dsh")
        env = {**os.environ, "DSH_HOME": str(Path(tmp) / "home")}
        version = subprocess.check_output([str(launcher), "--version"], text=True, cwd=tmp, env=env).strip()
        if version != release["version"]:
            raise ValueError(f"Packaged CLI reports {version} instead of {release['version']}")
        run(str(launcher), "--profile", "headless", "--dump-default-config", cwd=tmp, env=env,
            stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    product, target = sys.argv[1:]
    host = {"darwin": "mac", "win32": "win", "linux": "linux"}[sys.platform]
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}[platform.machine().lower()]
    if target != f"{host}-{arch}":
        sys.exit(f"Requested {target} on {host}-{arch}")
    output = Path("fork-dist").resolve()
    output.mkdir()
    pnpm = shutil.which("pnpm")
    if not pnpm:
        sys.exit("pnpm is required")
    {"desktop": desktop, "cli": cli}[product](target, json.loads(os.environ["FORK_RELEASE"]), output, pnpm)
