"""Check the update metadata requested by the fork's desktop release packager."""

from contextlib import chdir
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import package
from release import DESKTOP


class DesktopPackageTests(unittest.TestCase):
    def test_only_the_apple_silicon_dmg_receives_the_manual_update_marker(self):
        root = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(chdir(root))
        output = Path("dist")
        output.mkdir()
        for channel in ("stable", "nightly"):
            release_env = {"DSH_DESKTOP_AUTO_UPDATE_ENV": "fork", "DSH_DESKTOP_UPDATE_CHANNEL": channel}
            for target, extension in DESKTOP.items():
                with self.subTest(target=target, channel=channel), patch.dict(os.environ, release_env, clear=True):
                    artifacts = Path("apps/desktop/.desktop-build/targets") / target / "unsigned-artifacts"
                    artifacts.mkdir(parents=True, exist_ok=True)
                    (artifacts / f"installer.{extension}").touch()
                    with patch.object(package, "run") as builder:
                        package.desktop(target, {"version": "1.2.3"}, output, "pnpm")
                    environment = builder.call_args.kwargs.get("env")
                    effective = os.environ if environment is None else environment
                    self.assertEqual(effective["DSH_DESKTOP_AUTO_UPDATE_ENV"], "fork")
                    self.assertEqual(effective["DSH_DESKTOP_UPDATE_CHANNEL"], channel)
                    self.assertEqual(effective.get("DSH_DESKTOP_FORK_MANUAL_DMG"), "1" if target == "mac-arm64" else None)
