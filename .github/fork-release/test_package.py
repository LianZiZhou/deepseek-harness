"""Exercise the fork packager's artifact and credential handling."""

from contextlib import chdir
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import package
from release import DESKTOP


class DesktopPackageTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(chdir(self.enterContext(tempfile.TemporaryDirectory())))
        self.output = Path("dist")
        self.output.mkdir()
        self.cli = Path("apps/cli/package.json")
        self.cli.parent.mkdir(parents=True)
        self.cli.write_text('{"dependencies": {}}')

    def prepare_artifact(self, target, folder):
        artifacts = Path("apps/desktop/.desktop-build/targets") / target / folder
        artifacts.mkdir(parents=True)
        (artifacts / f"installer.{DESKTOP[target]}").write_bytes(b"fixture")

    def test_runs_the_fork_signer_and_removes_private_inputs(self):
        settings = {
            "FORK_MACOS_SIGNING_ENV": 'CSC_KEY_PASSWORD="fixture password"\n',
            "FORK_MACOS_CERTIFICATE_BASE64": "Y2VydA==",
            "FORK_MACOS_NOTARY_KEY_BASE64": "a2V5",
        }
        commands = []
        roots = []

        def run(*args, env):
            commands.append(args)
            self.assertTrue(settings.keys().isdisjoint(env))
            self.assertEqual(env["DSH_PACKAGING_PRESET"], "fork")
            self.assertEqual(env["DSH_DESKTOP_UPDATE_CHANNEL"], "stable")
            root = Path(env["DSH_PACKAGING_CONFIG_DIR"])
            self.assertEqual((root / "presets/fork.env").read_text(),
                             "DSH_DESKTOP_APP_ID=com.deepseek.dsh\nDSH_DESKTOP_AUTO_UPDATE_ENV=fork\n")
            self.assertEqual((root / "secrets/macos-signing.env").read_text(), settings["FORK_MACOS_SIGNING_ENV"])
            self.assertEqual((root / "certificates/developer-id.p12").read_bytes(), b"cert")
            self.assertEqual((root / "certificates/notarization.p8").read_bytes(), b"key")
            roots.append(root)

        with patch.dict(os.environ, {**settings, "DSH_DESKTOP_UPDATE_CHANNEL": "stable"}, clear=True), \
                patch.object(package, "run", side_effect=run):
            package.sign_macos("pnpm", self.output)
        self.assertEqual(commands, [("pnpm", "exec", "tsx", "apps/desktop/scripts/sign-fork-macos.ts", str(self.output.resolve()))])
        self.assertTrue(all(not root.exists() for root in roots))

    def test_missing_macos_credentials_do_not_build_or_promote_a_dmg(self):
        self.prepare_artifact("mac-arm64", "unsigned-artifacts")
        with patch.dict(os.environ, {}, clear=True), patch.object(package, "run") as builder:
            with self.assertRaisesRegex(ValueError, "FORK_MACOS_SIGNING_ENV"):
                package.sign_macos("pnpm", self.output)
            builder.assert_not_called()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_unsigned_macos_input_contains_only_materialized_package_files(self):
        run = package.run
        for directory in ("dsh", "runtime", "electron"):
            root = package.MAC_BUILD / directory
            root.mkdir(parents=True)
            (root / "fixture").write_text(directory)

        def prepare(*args, **kwargs):
            if args[0] == "tar":
                run(*args, **kwargs)
            elif args[0] != "pnpm":
                self.assertEqual(kwargs["env"]["ELECTRON_RUN_AS_NODE"], "1")
                shell = Path(args[-1])
                shell.mkdir()
                (shell / "fixture").write_text("shell")

        alignment = {"commit": "a" * 40, "manifests": ["packages/preset/prompt-presets/package.json"]}
        with patch.object(package, "run", side_effect=prepare) as builder, \
                patch.object(package.subprocess, "check_output", return_value=json.dumps(alignment)) as verify:
            package.desktop("mac-arm64", {"version": "1.2.3"}, self.output, "pnpm")
        self.assertIn("--dir", builder.call_args_list[0].args)
        self.assertEqual(verify.call_args.args[0][-1], "--verify-checkout")
        archive = (self.output / package.MAC_INPUT).resolve()
        with tempfile.TemporaryDirectory() as signer, chdir(signer):
            package.unpack_macos(archive)
            for directory in ("dsh", "runtime", "electron", "shell"):
                self.assertEqual((package.MAC_BUILD / directory / "fixture").read_text(), directory)
            self.assertEqual(json.loads((package.MAC_BUILD / "shell/checkout-alignment.json").read_text()), alignment)

    def test_builds_both_helpers_from_the_release_source_without_a_distribution_identity(self):
        self.cli.write_text(json.dumps({"dependencies": {"@deepseek-ai/dsh-cua-bundle": "workspace:*"}}))
        native = Path("packages/experimental/cua-macos/native")
        with patch.object(package, "run") as build:
            package.prepare_macos_helpers()
            self.assertEqual([call.args for call in build.call_args_list], [
                ("/usr/bin/xcrun", "python3", str(native / "build_app.py"), "--arch", arch, "--identity", "-")
                for arch in ("arm64", "x86_64")
            ])
            (native / "bin").mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, "clean"):
                package.prepare_macos_helpers()

    def test_unsigned_macos_input_cannot_escape_the_input_directory(self):
        archive = self.output / package.MAC_INPUT
        with tarfile.open(archive, "w:gz") as output:
            entry = tarfile.TarInfo("shell")
            entry.type = tarfile.SYMTYPE
            entry.linkname = "/tmp"
            output.addfile(entry)
        with self.assertRaises(tarfile.FilterError):
            package.unpack_macos(archive)

    def test_packages_windows_and_linux_with_the_fork_feed(self):
        for target in ("win-x64", "linux-x64"):
            with self.subTest(target=target):
                self.prepare_artifact(target, "unsigned-artifacts")
                with patch.object(package, "run") as builder:
                    package.desktop(target, {"version": "1.2.3"}, self.output, "pnpm")
                self.assertEqual(builder.call_args.args, ("pnpm", "run",
                    "package:desktop:" + target.replace("-", ":") + ":unsigned",
                    "--build-version", "1.2.3", "--official-branding"))
                self.assertEqual((self.output / f"dsh-desktop-{target}.{DESKTOP[target]}").read_bytes(), b"fixture")
        self.assertEqual(Path("apps/desktop/.env.windows").read_text(),
                         "DSH_DESKTOP_APP_ID=io.github.lianzizhou.dsh-desktop\nDSH_DESKTOP_AUTO_UPDATE_ENV=fork\n")
