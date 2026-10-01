<!-- Bilingual pair: deploy/README.md -->

# 重新部署本 harness

[English](README.md) | 中文

本目录携带了在另一台机器上重建本 fork 所需的一切：检出的仓库构建 harness 本身，这里的快照重建运行它的 DSH home——组合哪个 profile、挂载哪些插件、以及在产品里编辑过的设置。

它刻意**不携带任何凭据**。快照的归宿是 git 远端，而推送之后才发现的密钥已经泄漏了。

## 目录

- [快照包含什么](#what-the-snapshot-holds)
- [重新部署](#redeploy)
- [刷新快照](#refresh-the-snapshot)
- [不在这里的东西](#what-is-not-here)

<a id="what-the-snapshot-holds"></a>

## 快照包含什么

| 路径 | 职责 |
|---|---|
| `profile/<name>/package.json` | 插件链：profile 组合的 bundle，以及每个 npm 或 git 插件及其锁定版本 |
| `profile/<name>/cordis.patch.yml` | 覆盖这些 bundle 的用户层：本机禁用的那些行，以及在产品里编辑过的每一项设置——模型 provider、主题、语言 |
| `cordis.patch.yml` | home 级补丁，在每个 profile 自己的补丁之后应用：提示词预设名册放在这里，让 Web 与终端 profile 共用一份。设置编辑器写不了它，需直接编辑该文件 |
| `profile/<name>/pnpm-workspace.yaml` | profile 自己的安装根 |
| `settings.yaml` | 仅当源 home 尚未启动过 0.2 时存在：已移除的设置文档，首次启动会把它导入 profile |
| `snapshot.json` | 快照覆盖了哪些 profile，以及采集时间 |

自 0.2 起不再有独立的设置文档，产品把每次编辑写进 profile 补丁。那里的每个 provider 都通过 `apiKeyEnv` 引用密钥，因此补丁保存的是环境变量**名称**，从不是值，而 `deploy/export.mjs` 会拒绝快照任何看起来不是这样的文件。`bootstrap.mjs` 会从快照里把这些名称读回来，列出新机器必须提供的内容。

<a id="redeploy"></a>

## 重新部署

```bash
git clone <this repository> deepseek-harness
cd deepseek-harness
pnpm install
pnpm run build
node deploy/bootstrap.mjs
```

`bootstrap.mjs` 把快照还原进 `$DSH_HOME`（默认 `~/.dsh`），安装插件链，并打印仍需自行提供的凭据。不加 `--force` 它绝不覆盖已存在的文件——一台已经有 profile 的机器，正是静默覆盖代价最大的场合。

随后提供它列出的凭据并启动：

```bash
node apps/cli/lib/bin.js web
```

在任何构建过 `lib/` 的机器上都用内置入口，而不是 `pnpm dsh`——原因见[开发运行会加载两份包](../docs/development.zh.md)。

<a id="refresh-the-snapshot"></a>

## 刷新快照

插件链或设置发生变化时重跑，提交前先看 diff：

```bash
node deploy/export.mjs            # the web profile
node deploy/export.mjs web desktop
git diff deploy/
```

<a id="what-is-not-here"></a>

## 不在这里的东西

运行时状态（属于个人而非组合）与凭据（不得抵达远端）：

- `$DSH_HOME/.credentials.yaml`——provider 密钥、OAuth 记录、浏览器会话密钥
- `$DSH_HOME/sessions/`、`attachments/`、`recovery/`、`logs/`——对话历史及其产物
- `.dsh-market/`、`.dsh-skin-market/`、`.plugin-manager/logs/`——市场缓存，按需重建
- 检出与 profile 两处的 `node_modules/`——由锁定的清单重新安装

检出旁边的 `.dsh/` 目录是运行时 home，不是仓库内容；`.gitignore` 已排除它。
