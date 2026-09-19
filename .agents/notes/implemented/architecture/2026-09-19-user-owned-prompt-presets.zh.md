# Agent Note: 由人拥有自己会话所运行的系统提示词

Status: implemented

[English](2026-09-19-user-owned-prompt-presets.md) | 中文

## 问题

塑造系统提示词的每一种方式，都属于编写组合的那个人。`dsh-system-prompt` 的 `personaPrefix` / `personaSuffix` 是某个 `cordis.yml` 行上的配置；`dsh-persona` 是 agent preset 内部的一行；其余每个段落都属于拥有它所陈述之事实的那个插件。它自己的 README 记下了这个缺口：*「不存在终端用户提示词编辑 API。」* 想换一套指令的人只能改 YAML 并重启，而且产品里没有任何地方向他们展示组装出来的提示词到底是什么。

显而易见的做法——再写一个插件、一个 `system-prompt/assemble` 监听器、一个文本框——站不住脚。监听器没有契约保证自己最后发言，而已注册的 `complete: true` 段直接压过它；随产品发布的 `minimal` agent 预设就有一个。[最终覆盖 note](2026-09-18-prompt-final-override.zh.md) 覆盖了那一半；本 note 覆盖建立在其之上的功能。

## 决策

`dsh-prompt-presets` 在用户的设置文档中存储**具名、有序的规则栈**，由会话选择一个，并可在其生命周期的任意时点切换。

### 规则栈

五种类型，按数组下标顺序应用，每一条作用于前一条的输出：`prepend` 与 `append` 在一端加入一个小节，`replace` 让其文本成为整个提示词，`remove` 按精确名称删除小节，`substitute` 改写匹配到的文本。规则只能在两端创建小节：没有按 order 插入的规则，因为没有消费方需要它，而 `remove` 加上一条端点规则能表达同样的结果。

`applyRules` 是纯函数并且导出，因此实时覆盖与预览给出完全一致的答案，而不是彼此近似。

### 选择按会话进行，且自由

agent preset 在首轮之后锁定，因为更换工具会让已记录的工具调用无所依托。prompt preset 不会：系统提示词是下一步会重新渲染的 `system/message` surface 节点，因此一次切换的代价是一次渲染，并在下一轮到达模型，不改写它已经看过的任何内容。

会话运行哪个预设，在**每一次**组装时从其持久的 `promptPreset` projection（投影）读取，而不是按 agent 缓存。于是恢复与分叉都不需要任何种子代码——projection 折叠日志，而分叉的种子就是一段日志前缀——并且这个问题只有一个来源。

### 写入要响，应用要收敛

写入会拒绝无法使用的模式、`gimsu` 之外的标志、超出边界、指名受保护小节的移除，或指向不存在预设的默认值。组装则相反：仍无法运行的规则被跳过并给出警告，其余规则照常应用；结果无法渲染的预设仅在该次组装中被丢弃。

这种不对称正是要点。写入路径是人正在看的地方，而一份能让组装抛出的设置文档，会让一个会话仅凭一个文本文件就无法运行。无论哪些规则存活下来，渲染后的提示词都作为 `system/message` 提交，因此 `Model-visible ⟺ logged` 两边都成立。

### 受保护的小节

`Config.protectedSections` 默认为 `tools:ptc-only` 与 `tool:structured_output`。这两者陈述的是**执行器**强制执行的规则——PTC 模式，以及进程内子代理的结构化输出协议——因此缺了它们的提示词会告诉模型它可以调用那些将被拒绝的工具。`replace` 会把它们重新放在自己的文本之前并给出警告；指名其中之一的 `remove` 在写入时被拒绝。它是一个 `Config` 列表而非常量：想要真的什么都不保护的部署设置 `protectedSections: []`。

## 考虑过的替代方案

**改为编辑 preset 文件。** agent preset 已经有名单、创作 API 与选择器；提示词覆盖本可以是 `agent.cordis.yml` 里的另一行。否决：preset 的创作按设计只能复制，且 preset 文件是挂载从不回写的输入，因此 GUI 还需要第二条可写的创作路径——而结果仍然会在首轮之后锁定，而那恰恰是对提示词并不适用的约束。

**用单个自由文本的提示词覆盖，而不是规则栈。** 更易实现也更易解释。否决，因为常见诉求是**增量式**的（「始终用中文回答」「不要用 emoji」），而单个文本框逼迫人为了加一行就复述整篇第一方提示词——然后在 harness 修改它时悄然过时。

**像 agent preset 那样把预设存为 harness home 下的文件。** v1 否决：设置文档已经具备分层、校验、修订号、热重载与客户端管道，而这些一样都不会被复用。分享预设是重新考虑它的理由，而那也正是正则表达式的信任论据失效的时刻。

**让 `remove` 接受模式。** 否决：预览会列出每个小节名称，因此点击移除才是交互方式；第二套模式语法只会再次引入正则表达式的安全面，却带不来新的触达范围。

## 后果

- 人可以在产品里改提示词，而且这个改动是决定性的：它同时压过部署 persona 与 agent preset 的 complete 段。
- 会话的提示词覆盖是持久且可重建的。`prompt-preset/selected` 是一个普通的必需事件——`Session.append` 无法设置信封上的 `ignorable` 标记，那个标记是为构建不认识的事件类型准备的——因此较旧构建会拒绝含该事件的日志，这与此后新增的每一个仓库内事件类型完全一致。
- 空白会话的默认值以一次已记录的选择被盖上，而不是在组装时读取，因此恢复后的会话重建的是它运行过的预设，而不是默认值后来变成了什么。
- 规则触达提示词，绝不触达工具 schema。隐藏工具仍然是 `ctx.tools.restrict()`，它让呈现、查找与执行保持一致；删掉某工具指导的预设只会让该工具仍可被调用。
- 病态的正则表达式会拖住其作者自己那一轮。模式长度、规则数与文本大小都有界，但 Node 无法为正则表达式设置超时，而那条信任论据——预设是用户自己的设置文档，本就承载着 `cordis.yml` 的信任——只在预设仍属本地时成立。

## 测试

- `packages/preset/prompt-presets/tests/rules.spec.ts` 钉住每种规则类型、顺序组合（包括一条规则作用于更早规则所创建的小节）、`replace` 过程中受保护小节的保留，以及每一种被收敛的失败。
- `packages/preset/prompt-presets/tests/override.spec.ts` 钉住按会话的应用与隔离、会话中途切换、对 `complete: true` 段的覆盖、渲染探针，以及每会话仅记录一次的警告。
- `packages/preset/prompt-presets/tests/store.spec.ts` 与 `schema.spec.ts` 钉住名册、每一种写入拒绝、修订号设防，以及设置文档校验。
- `packages/preset/prompt-presets/tests/session.spec.ts` 钉住 projection 折叠、每次变更一个事件，以及并发选择的串行化。
- `packages/preset/prompt-presets/tests/preview.spec.ts` 钉住基线与候选项这一对、小节归属，以及每一种预览警告。
- `packages/preset/prompt-presets/tests/disposal.spec.ts` 是 HMR 安全性证明：覆盖、settings 命名空间、projection 单元与事件镜像都随 fiber 一同消失。
- `packages/preset/prompt-presets/tests/loader-composition.spec.ts` 是 REAL-composition 证明：交付的行经由 Loader 启动，提交的提示词携带所选预设的变换，包括在一个声明了自身 persona 为 complete 的组合之上。
