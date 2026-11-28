# Fork 半分离同步方案：主题补丁队列

状态：**提案，待确认**。本文件、[`topics.toml`](topics.toml)、[`patchqueue.py`](patchqueue.py) 和 [`test_patchqueue.py`](test_patchqueue.py) 是原型，没有接入任何工作流，也不改变默认分支 `merge/upstream-0.2.2-rc.1` 的同步行为。

## 1. 问题

现行同步（[README](README.md)、[`catchup.py`](catchup.py)）沿 upstream master 的 first-parent 历史逐个提交执行 `git merge-tree`，把 fork 对 upstream 的**整棵累积差异**一次性三方合并到新树上。fork 的改动没有被拆分成可独立维护的单元，所以：

- 只要有一个文件冲突，整次同步就停下，人工在默认分支上合并；
- 生成文件、双语哈希记录、`pnpm-lock.yaml` 几乎每次都冲突，但它们本来应该重新生成，而不是手工合并；
- 冲突 issue 只说明“哪个 upstream 提交冲突”，不说明“fork 的哪一块功能受影响”。

用本次追赶（upstream `6cadb01157` → `841f76d3c5`，170 个 first-parent 提交）的真实历史复算：

| 度量 | 现行流程 |
| --- | --- |
| 人工合并次数 | **33** 次（`Merge upstream …` 提交） |
| 冲突文件累计 | **155** 个文件次 |
| 其中生成文件 | 49（`event-producer-consumer*.md` 各 15 次、`persistence-schema.json`、`config-catalog*`、`api-catalog.ts`、`slot-catalog.ts` 等） |
| 其中 `*.i18n.yaml` 配对哈希 | 38 |
| 其中 `pnpm-lock.yaml` | 4 |
| 只因生成文件 / 哈希 / lockfile 而停下的合并 | **14 / 33** |

也就是说，59% 的冲突文件次和 42% 的人工合并本可自动消除。剩下的才是真正的代码冲突。

## 2. fork 改动盘点

基准：`git diff 841f76d3c5 a44147f01c`（当前默认分支相对 upstream 的全部改动），共 631 个文件：275 新增、355 修改、1 删除。按 [`topics.toml`](topics.toml) 分类（`patchqueue.py classify --base upstream/master --head HEAD`）：

| 类别 | 文件数 | 说明 |
| --- | --- | --- |
| 生成文件 + 配对哈希 | 68 | 不进补丁；同步后统一重新生成 |
| lockfile | 1 | 取 upstream 的 lockfile，再按 fork 清单重新解析 |
| 14 个主题 | 562 | 每个路径只属于一个主题 |

| # | 主题 | 文件 | 其中改动 upstream 已有文件 | 性质 |
| --- | --- | --- | --- | --- |
| 1 | `fork-infra`：同步、发布、CI 门控 | 28 | 9 | 叠加层为主；对 upstream `ci.yml` 等只加 `if: github.repository` |
| 2 | `provider-sign-in`：pi-ai 登录贡献、授权 seam、Z.AI GLM Coding Plan | 52 | 14 | 新包 `llm-zai-coding-plan` + `settings-controller` 小改 |
| 3 | `pi-ai-catalog`：pi-ai 版本、依赖补丁、模型目录 | 33 | 27 | 依赖补丁与 Web 快照 |
| 4 | `reasoning-effort-ui`：推理等级 Auto/None/Custom | 18 | 17 | 纯 upstream 文件改动，最易与布局重构冲突 |
| 5 | `prompt-presets`：用户自有提示词预设、`/prompt-preset` | 135 | 32 | 两个新包 + `system-prompt` finalize 覆盖 |
| 6 | `agent-loop-hooks`：`Agent.resume()`、`agent/admit-context`、`agent/admit-messages` | 12 | 10 | 核心循环改动，与 upstream ToolStep 重写相撞 |
| 7 | `context-injections`：设置页开关 / 改写注入上下文 | 63 | 14 | 两个新包 + `ui-primitives` 表单字段 |
| 8 | `continue-command`：`/continue` | 14 | 0 | 纯叠加层 |
| 9 | `chat-ui`：随时 fork、Continue 按钮、会话相对图片路径 | 24 | 20 | upstream 文件改动 |
| 10 | `session-rewrite`：原地改写 Session、`session.context`、轨迹 Context 页 | 78 | 55 | 改动 upstream 文件最多的主题 |
| 11 | `permission-full-access`：完全访问免确认 | 9 | 7 | upstream 文件改动 |
| 12 | `desktop-release`：fork 桌面打包、签名、更新源、Linux Office 引擎 | 57 | 45 | fork 专用脚本 + 对 upstream 打包脚本的参数化改动 |
| 13 | `sidebar-edition`：品牌旁的版本标签 | 3 | 3 | 小改 |
| 14 | `integration`：workspace、bundle、tsconfig、目录生成器、架构文档的注册点 | 36 | 33 | 多个主题共享的接线，故意放在最后并保持最小 |

导出的补丁合计约 4.6 万行（含 diff 上下文），其中真正改动 upstream 已有文件的约 290 个；其余是 fork 新增的包、脚本、文档和测试（叠加层，几乎不会冲突）。

## 3. 方案比较

### A：upstream 镜像分支 + 可 rebase 的主题提交栈（stgit / patch queue）

`upstream` 镜像分支只做快进；`fork/stack` 分支 = upstream + 每个主题一个提交；同步时 `git rebase --onto <新 upstream>`，配合 `rerere`。

- 优点：每个主题是一个真实提交，冲突停在具体主题；`rerere` 复用重复冲突的解决。
- 缺点：栈分支必须改写历史，不能作为 nightly / Desktop 发布的来源，仍需一条追加式分支；日常开发 PR 无法自然地落到“栈里的某个提交”上，要么维护两份事实来源，要么要求所有人学会 fixup + autosquash；rebase 需要工作区，CI 中解决冲突的交接更复杂。

### B：`patches/fork/*.patch` 补丁文件 + 应用脚本（quilt）

仓库里保存 `series` 和每个主题的 `.patch`；同步 = 取 upstream 树 → 依次 `git apply --3way` → 重新生成 → 重建 lockfile。

- 优点：补丁本身可审阅、可单独删除；与 Debian / Chromium 的维护方式一致。
- 缺点：代码改动要以“diff 的 diff”审阅；补丁住在它所修改的树里；最大的 `prompt-presets` 补丁约 1.8 万行，二进制文件要 `--binary`；每次改代码都要 `refresh` 补丁，一旦忘记，补丁与默认分支就会分叉。

### C（推荐）：默认分支仍是唯一事实来源，主题补丁队列由清单派生

不改变日常开发方式：PR 照常合入默认分支。新增的唯一受维护工件是 [`topics.toml`](topics.toml)（路径 → 主题的映射）。每次同步：

1. 计算 fork 的改动 `diff(已集成 upstream, fork 头)`；
2. 按清单拆成互不相交的主题，生成文件和 lockfile 剔除；
3. 每个主题作为一个提交，用 `git merge-tree --merge-base` 三方重放到新的 upstream 提交上，得到“主题补丁队列”；
4. 重新生成生成物、重建 lockfile；
5. 以 `(上一个 fork 头, upstream 提交)` 为父提交写出 checkpoint，与现在完全相同。

- 优点：零迁移成本，历史仍然追加式；冲突天然只属于一个主题；生成物和 lockfile 不再参与合并；队列本身可以作为只读视图发布（`fork/patches` 分支或发布附件），满足“在主线上看到我们完整的 patches”。
- 缺点：主题粒度是**文件级**，一个文件只能属于一个主题（共享接线集中到 `integration`）；需要一个 `classify` 门禁保证清单覆盖所有改动。

需要说明的是：主题拆分本身不会让真正重叠的代码修改消失——单个文件仍是同样的三方合并。C 的收益来自四点：生成物与 lockfile 不再合并（见第 1 节的 59%）；冲突一次性停在 upstream tip 而不是逐提交停 33 次；冲突按主题隔离、命名并定位到具体 upstream PR；补丁面被显式统计，便于持续缩小（第 6 节）。

## 4. 推荐方案的设计

### 4.1 分支与提交

| 引用 | 写入者 | 内容 | 是否改写 |
| --- | --- | --- | --- |
| `merge/upstream-0.2.2-rc.1` | 开发者 PR、同步工作流 | 发布来源；checkpoint 父提交为 `(上一个 fork 头, upstream 提交)` | 否，仅快进 |
| `fork/patches` | 同步工作流 | upstream tip + 每个主题一个提交（`Fork-Topic:` trailer） | 是，只读视图，每次同步强制更新 |
| `fork/conflict/<topic>` | 同步工作流 | 冲突时：upstream tip + 已干净的主题 + 带冲突标记的该主题 | 是，解决后删除 |

checkpoint 继续使用 `Fork-Upstream: <sha>`，新增 `Fork-Queue: <fork/patches 提交>`，`catchup.py` 的“上一个已集成 upstream”判定和祖先检查无需改动，旧 checkpoint 历史天然兼容。

### 4.2 同步流程（改造后的 `catchup.py`）

1. 取默认分支头 `F` 与它记录的 `Fork-Upstream` `U0`，取 upstream tip `U1`。
2. `patchqueue.py classify --base U0 --head F`：有未归属路径则失败并开 `fork-topics-unowned` issue（清单维护提醒，不阻塞已有主题的诊断）。
3. `patchqueue.py queue --base U0 --head F --onto U1 --blame`：逐主题重放。
4. 全部干净：在 `U1` 的队列树上
   - 用 upstream 的 `pnpm-lock.yaml` 执行 `pnpm install --lockfile-only --ignore-scripts`，再 `pnpm install --frozen-lockfile`；
   - 执行 `topics.toml` 的 `[generated].commands`，再对所有被主题触及的双语文档执行 `verify-translation-pairing --write`；
   - 运行快速门禁：`build:artifacts` 的 fork 包子集与 fork 主题的单测（发现 React 19、`/client` 导入这类**语义冲突**）；
   - 写 checkpoint，快进推送，派发 nightly（与现在相同）。
5. 有冲突：每个冲突主题一个 issue（标记 `<!-- fork-topic-conflict <topic> -->`），正文包含冲突文件、`--blame` 定位到的首个冲突 upstream 提交、`fork/conflict/<topic>` 分支链接；干净主题不受影响。已开 issue 的主题不重复开。

**粒度从“逐 upstream 提交”改为“每次运行跳到 upstream tip”**：每次运行最多一个 checkpoint，重新生成只做一次；冲突时 `--blame` 用二分查找给出最早冲突的 upstream 提交，保留逐提交方式的定位能力。若仍需要逐提交 checkpoint，可在干净前缀上沿用现有逐提交逻辑，只在最后一次执行重新生成。

### 4.3 冲突解决

```sh
git fetch origin fork/conflict/<topic> merge/upstream-0.2.2-rc.1
git switch -c resolve/<topic> origin/fork/conflict/<topic>
# 只需处理 Fork-Conflict trailer 列出的文件
git commit -am "Resolve <topic> against <upstream sha>"
python3 .github/fork-sync/patchqueue.py finalize   # 计划中：重建 lockfile、生成物、配对哈希
```

解决结果以“合并提交”的形式进入默认分支（父提交为当前 fork 头与 upstream tip，与现行 README 第 2 步一致），随后运行 **Fork upstream catchup**。与现在相比，维护者只碰该主题的文件，不再手工合并生成物、哈希和 lockfile。

### 4.4 生成文件与 lockfile

- `topics.toml` 的 `[generated]` 列出整文件生成的产物与 `**/*.i18n.yaml`；重放时它们保持 upstream 内容，之后由生成命令重建。
- 文档中的生成区域（`docs/subsystems/*.md` 的 Cordis API 区域、`historical-formats/README*` 的 `persistence-format-index` 区域、`tsconfig.base.json` 的 `gen-tsconfig-paths` 区域）暂时留在主题补丁中；第二阶段可在拆分时把区域内容还原为 base 版本，使补丁只含手写部分。
- 录制型快照（`apps/web/tests/expected/**`、`snapshots/web/**`）在本次追赶中贡献了 4 个冲突；可作为 `recorded` 类，冲突时取 upstream 并重新录制，而不是三方合并。
- lockfile 永远不三方合并。React 19 这类升级造成 fork 新包解析失败时，会以 `pnpm install` 错误的形式出现在“重新生成”阶段，并归入对应主题的 issue。

### 4.5 nightly 与 Desktop 发布

默认分支仍只快进；`fork-desktop-release.yml` 仍由同步成功后派发，输入仍是 `sync_sha` 与 `upstream_sha`；版本对齐和标签发布（`.github/fork-release/`）读取的历史不变。`fork/patches` 与 `fork/conflict/*` 不触发任何发布。

## 5. 原型验证

在本分支运行（均只用 Git 底层命令，不触碰工作区与引用）：

```sh
python3 .github/fork-sync/patchqueue.py classify --base upstream/master --head HEAD
python3 .github/fork-sync/patchqueue.py queue --base 6cadb01157 --head 42d0ba2b9d --onto 841f76d3c5 --blame
python3 .github/fork-sync/patchqueue.py export --base upstream/master --head HEAD --out /tmp/fork-patches
python3 -m unittest discover -s .github/fork-sync
```

`42d0ba2b9d` 是本次追赶前最后一个干净 checkpoint，`6cadb01157` 是它集成的 upstream 提交。把它的主题队列一次性重放到 `841f76d3c5`（约 3 秒）：

| 主题 | 文件 | 冲突 | 首个冲突 upstream 提交（`--blame`） |
| --- | --- | --- | --- |
| fork-infra | 28 | 0 | — |
| provider-sign-in | 52 | 3 | #9048 llm-pi-ai deployment provider rows |
| pi-ai-catalog | 33 | 6（4 个是录制快照） | #9048 |
| reasoning-effort-ui | 18 | 5 | #8894 models settings layout |
| prompt-presets | 135 | 6 | #8882 scoped tool registries |
| agent-loop-hooks | 12 | 3 | #8882 |
| context-injections | 63 | 2 | #9363 client platform rows layout |
| continue-command | 14 | 0 | — |
| chat-ui | 24 | 5 | #8406 unify tool call UI |
| session-rewrite | 78 | 7 | #9074 page input hooks |
| permission-full-access | 9 | 1 | #9451 Client packages as dynamic plugins |
| desktop-release | 57 | 5 | #9223 desktop channel convergence |
| sidebar-edition | 3 | 0 | — |
| integration | 39 | 9（3 个是 upstream 已吸收的 LibreOffice 脚本） | #6291 im-automation |

| 对比 | 停顿次数 | 冲突文件 |
| --- | --- | --- |
| 现行逐提交合并 | 33 | 155 文件次 |
| 现行算法但一次跳到 tip（整树 `merge-tree`） | 1 | 78 |
| 主题队列（剔除生成物 / 哈希 / lockfile） | 1 | 52，分属 11 个主题；中英成对文档按一处计为 41 处，其中录制快照 4 个、upstream 已吸收 3 个 |

另外两项核对：

- **往返一致**：把当前 `HEAD` 的改动重放回它自己的 upstream（`841f76d3c5`），除生成物与 lockfile 外与 `HEAD` 逐字节相同，证明拆分不丢改动。
- **语义改动**：干净重放的结果与人工追赶后的 `HEAD` 仍有 38 个文件不同（`ui-prompt-preset`、`ui-settings-context-injections` 改成 `/client` 导入与 React 19 适配、`sign-fork-macos.ts` 适配四参数构建配置、录制快照重录等）。这类改动任何文本合并都发现不了，所以 4.2 第 4 步必须包含 fork 包的构建与测试，并把失败归入对应主题。

## 6. 缩小补丁面（与同步改造并行）

补丁越少触碰 upstream 文件，冲突越少。按收益排序的候选：

1. **向 upstream 提交通用扩展点**：`Agent.resume()` 与 `agent/admit-context` / `agent/admit-messages` 瀑布（`agent-loop-hooks`）、`system-prompt` 的 finalize 覆盖（`prompt-presets`）、完全访问免确认的配置项（`permission-full-access`）。一旦被接受，对应主题只剩叠加层。
2. **fork 自有 bundle 叠加**：把 `packages/bundle/base|web-app/cordis.patch.yml` 中挂载 fork 插件的条目移到 fork 自有的 bundle / `deploy/cordis.patch.yml` overlay，`integration` 主题少一个高频冲突点。
3. **把功能从 upstream 包里移到 fork 包**：`session-rewrite` 改动 55 个 upstream 文件，其中 `session-controller` 的命令与远程命名空间可尝试做成独立插件包，只在注册点留一行接线；`reasoning-effort-ui` 与 `sidebar-edition` 优先用 slot 贡献而不是改组件。
4. **fork 文档独立成文**：fork 功能说明写入 fork 自有页面，upstream 文档（`architecture`、各包 README、`providers` 指南）只保留必要链接。本次 52 个冲突文件中有 22 个是 11 对中英 README / 文档。
5. **及时删除被 upstream 吸收的改动**：例如 upstream #9303（LibreOffice kit Linux glibc engine）已覆盖 fork 的 `scripts/libreoffice-*` 改动；`--blame` 指向的提交若已实现同等功能，应删除 fork 版本而不是合并。

## 7. 实施步骤（确认后执行）

1. **观测**：在同步工作流成功后追加不阻塞的步骤：`classify`（未归属路径时开清单维护 issue）并强制更新 `fork/patches` 视图分支。默认分支行为不变。
2. **生成物与 lockfile 自动化**：实现 `patchqueue.py finalize`（lockfile 重建、生成命令、配对哈希），供人工解决冲突时使用；验证它重建的生成物与人工结果一致。
3. **切换同步引擎**：`catchup.py` 改为 tip 模式 + 主题队列 + 每主题 issue + `fork/conflict/<topic>` 分支；保留 `Fork-Upstream` trailer 与 nightly 派发；同步更新 [README](README.md) 的恢复步骤。
4. **缩小补丁面**：按第 6 节逐项推进，每完成一项更新 `topics.toml`。

## 8. 待确认

1. 是否接受方案 C（默认分支为事实来源、队列派生），而不是 A / B？
2. checkpoint 粒度：每次运行一个（跳到 tip），还是保留逐 upstream 提交的 checkpoint？
3. 主题划分是否符合你的心智模型（特别是 `integration`、`chat-ui`、`agent-loop-hooks` 三个合并型主题）？
4. 第 6 节中哪些可以尝试提交到 upstream？
