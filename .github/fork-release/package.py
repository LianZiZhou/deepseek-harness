"""Package from the selected checkout and exercise the extracted, relocatable CLI."""

import base64
import binascii
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile

from release import CLI, DESKTOP

MAC_BUILD = Path("apps/desktop/.desktop-build/targets/mac-arm64")
MAC_INPUT = "unsigned-macos.tar.gz"


def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


def prepare_macos_helpers():
    """Compile the selected source's Computer Use applications before packing its provider."""
    cli = json.loads(Path("apps/cli/package.json").read_text(encoding="utf-8"))
    if "@deepseek-ai/dsh-cua-bundle" not in cli.get("dependencies", {}):
        return
    native = Path("packages/experimental/cua-macos/native")
    if (native / "bin").exists():
        raise ValueError("Build the fork release from a clean Computer Use native/bin directory")
    for architecture in ("arm64", "x86_64"):
        run("/usr/bin/xcrun", "python3", str(native / "build_app.py"), "--arch", architecture, "--identity", "-")


def prepare_macos(pnpm, version, output):
    prepare_macos_helpers()
    run(pnpm, "run", "package:desktop:mac:arm64:unsigned",
        "--build-version", version, "--official-branding", "--dir")
    application = MAC_BUILD / "unsigned-artifacts/mac-arm64/DeepSeek Harness.app/Contents"
    with tempfile.TemporaryDirectory(prefix="dsh-fork-macos-input-") as directory:
        shell = Path(directory) / "shell"
        run(str(application / "MacOS/DeepSeek Harness"), "--expose-internals",
            str(Path(__file__).with_name("stage-macos-shell.cjs")), str(application / "Resources/app.asar"), str(shell),
            env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"})
        run("tar", "-czf", str((output / MAC_INPUT).resolve()), "-C", str(MAC_BUILD.resolve()),
            "dsh", "runtime", "electron", "-C", directory, "shell",
            env={**os.environ, "COPYFILE_DISABLE": "1"})


def unpack_macos(archive):
    MAC_BUILD.mkdir(parents=True)
    with tarfile.open(archive, "r:gz") as source:
        source.extractall(MAC_BUILD, filter="data")
    entries = {"dsh", "electron", "runtime", "shell"}
    if {path.name for path in MAC_BUILD.iterdir()} != entries:
        raise ValueError("The unsigned macOS input has unexpected entries")
    if any((MAC_BUILD / name).is_symlink() or not (MAC_BUILD / name).is_dir() for name in entries):
        raise ValueError("The unsigned macOS input must contain independent directories")


def sign_macos(pnpm, output):
    environment = dict(os.environ)
    settings = {name: environment.pop(name, "") for name in (
        "FORK_MACOS_SIGNING_ENV", "FORK_MACOS_CERTIFICATE_BASE64", "FORK_MACOS_NOTARY_KEY_BASE64",
    )}
    if missing := [name for name, value in settings.items() if not value.strip()]:
        raise ValueError(f"Configure the fork's repository Actions secrets: {', '.join(missing)}")
    with tempfile.TemporaryDirectory(prefix="dsh-fork-macos-signing-") as directory:
        root = Path(directory)
        (root / "presets").mkdir()
        (root / "secrets").mkdir()
        (root / "certificates").mkdir()
        (root / "presets/fork.env").write_text(
            "DSH_DESKTOP_APP_ID=com.deepseek.dsh\nDSH_DESKTOP_AUTO_UPDATE_ENV=fork\n", encoding="utf-8")
        (root / "secrets/macos-signing.env").write_text(settings["FORK_MACOS_SIGNING_ENV"], encoding="utf-8")
        for name, path in (
            ("FORK_MACOS_CERTIFICATE_BASE64", root / "certificates/developer-id.p12"),
            ("FORK_MACOS_NOTARY_KEY_BASE64", root / "certificates/notarization.p8"),
        ):
            try:
                contents = base64.b64decode("".join(settings[name].split()), validate=True)
            except (binascii.Error, ValueError):
                raise ValueError(f"{name} must contain a base64-encoded file") from None
            path.write_bytes(contents)

        environment.update(DSH_PACKAGING_PRESET="fork", DSH_PACKAGING_CONFIG_DIR=str(root))
        run(pnpm, "exec", "tsx", "apps/desktop/scripts/sign-fork-macos.ts", str(output.resolve()), env=environment)


def desktop(target, release, output, pnpm):
    if target == "mac-arm64":
        prepare_macos(pnpm, release["version"], output)
        return
    if target == "win-x64":
        Path("apps/desktop/.env.windows").write_text(
            "DSH_DESKTOP_APP_ID=io.github.lianzizhou.dsh-desktop\nDSH_DESKTOP_AUTO_UPDATE_ENV=fork\n", encoding="utf-8")
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
    if sys.argv[1] == "unpack-macos":
        unpack_macos(sys.argv[2])
        sys.exit()
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
    if product == "sign":
        if target != "mac-arm64":
            raise SystemExit("The isolated signer accepts only mac-arm64")
        sign_macos(pnpm, output)
    else:
        {"desktop": desktop, "cli": cli}[product](target, json.loads(os.environ["FORK_RELEASE"]), output, pnpm)
