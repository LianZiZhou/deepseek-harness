---
kind: upgrade-guide
description: "替换使用旧 fork 应用 ID 的 Desktop 安装。"
---

# macOS 和 Linux 上的 fork Desktop 应用 ID

[English](guide.md) | 中文

## 变更

macOS 和 Linux 的 fork Desktop 安装包使用 `com.deepseek.dsh`。旧版使用 `com.deepseek.harness`。Windows 沿用 fork 原有的安装注册。

## 迁移

1. 在 macOS 上，退出 Desktop，将已签名 fork DMG 中的 `DeepSeek Harness.app` 拷贝到“应用程序”，替换旧副本。打开此副本后，即可在应用内下载后续更新。
2. 在 Linux 上，打开现有的 fork AppImage，选择**下载更新**。如果旧版没有更新源，请手动替换 AppImage。如果桌面启动项仍指向旧文件，请刷新启动项。
3. 打开**关于 DeepSeek Harness**，查看版本，并确认列表里有原来的工作区和会话。
