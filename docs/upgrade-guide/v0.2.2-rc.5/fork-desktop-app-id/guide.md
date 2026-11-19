---
kind: upgrade-guide
description: "Replace Desktop installations that use an older fork application ID."
---

# Fork Desktop application ID on macOS and Linux

English | [中文](guide.zh.md)

## Change

Fork Desktop installers on macOS and Linux use `com.deepseek.dsh`. Older builds use `com.deepseek.harness`. Windows keeps its existing fork installer registration.

## Migration

1. On macOS, quit Desktop and copy `DeepSeek Harness.app` from the signed fork DMG into Applications, replacing the old copy. Open that copy to download future updates in the app.
2. On Linux, use **Download update** in the existing fork AppImage. If the build has no update source, replace the AppImage manually. Refresh the launcher if your desktop still points to the old file.
3. Open **About DeepSeek Harness** and check the version. Confirm that your workspaces and sessions are listed.
