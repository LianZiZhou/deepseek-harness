---
description: "面向用户与维护者的用户自有系统提示词覆盖预设，用于选择、编写或排查一个会话的提示词变换。"
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-presets

[English](README.md) | 中文

## 概述

`dsh-prompt-presets` 让人拥有自己会话所运行的系统提示词。一个预设是一组具名、有序的规则栈：在组装出的提示词之前或之后添加文本、整体替换、按名称移除小节，或改写匹配到的文本。会话可在任意时点切换预设。该变换是提示词注册表唯一的最终覆盖，在所有其他贡献之后、也在 `complete: true` 段被恢复之后运行，因此预设产出什么，模型就收到什么。写入会做边界校验；在组装时仍无法运行的规则会被跳过并给出警告，而不是让该轮失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在任何运行 agent 且组合了 settings（设置）提供方的地方挂载本行；它提供 `ctx.promptPresets`，即所有预设读写所经的 store（存储）。没有 settings 提供方时本行不会激活，因为一个无处存放预设的预设 store 不是值得运行的降级形态。

### 配置名册

```yaml
- name: '@deepseek-ai/dsh-prompt-presets'
  config:
    default: ''
    presets:
      terse:
        name: Terse
        description: Short answers, no preamble.
        rules:
          - kind: append
            text: Answer in at most three sentences.
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `presets` | `{}` | 所有已存储的预设，以 id 为键。volatile：一次编辑无需重挂即可抵达运行中的 store |
| `default` | `''` | 盖入空白会话的预设；`''` 表示不盖。同样是 volatile |
| `protectedSections` | `['tools:ptc-only', 'tool:structured_output']` | `replace` 会保留、`remove` 不得指名的小节 |
| `maxPresets` | `64` | 一个部署最多存储多少预设 |
| `maxRules` | `32` | 一个预设最多携带多少规则 |
| `maxPatternLength` | `512` | 可接受的最长正则表达式源串 |
| `maxTextBytes` | `16384` | 可接受的最大规则文本，按 UTF-8 字节计。发布的 base bundle 将其调高到 `65536` |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-prompt-presets)是每个受支持字段的穷尽式真源。

预设就是本条目自己的 Config，不是另一份独立的设置文档。编辑器通过 settings 表单把它们写进当前 profile 的 `cordis.patch.yml`，Loader 再把这两个 volatile 字段提交进运行中的 store，无需重挂。未组合 settings 服务的部署仍会读取并应用预设；名册报告 `writable: false`，每次写入都以 `prompt-preset/read-only` 拒绝。bundle 自带的预设不能通过 store 删除。

已移除的 `$DSH_HOME/settings.yaml` 中的 `prompt-presets` 一节，会在升级后的首次启动时导入本条目，与其他各节一样。

### 编写规则栈

规则按数组顺序应用，每一条都能看到前一条产出的结果——包括前一条创建的小节。

| 类型 | 作用 |
|---|---|
| `prepend` | 在一切之前加入一个小节，其文本因此成为渲染后提示词的开头 |
| `append` | 在一切之后加入一个小节，其文本因此成为渲染后提示词的结尾 |
| `insert` | 在 `after` 指定的小节正后面添加一个小节；锚点不存在时发出警告并把文本落到末尾 |
| `replace` | 让其文本成为整个提示词，只保留受保护的小节 |
| `remove` | 按精确名称删除小节 |
| `substitute` | 改写匹配到的文本；`sections` 用于限定范围，缺省或为空表示全部小节 |

规则文本默认按字面处理。在文本类规则上设置 `interpolate: true` 可解析其中的 `{{provider}}`、`{{model}}` 与 `{{cwd}}`；不开启正是粘贴含花括号的提示词也不会让一轮失败的原因。`enabled: false` 保留规则但不应用它。

### 为会话选择预设

`select(agent, id)` 把该选择记录进会话日志，下一个组装出的步骤即在其之下渲染；`select(agent, null)` 回到未变换的提示词。与 agent 预设不同，这里没有空白会话锁——会话中途更换工具会让已记录的工具调用无所依托，而系统提示词只是下一步会重新渲染的 surface 节点。切换绝不会改写模型已经看到的内容；它自下一轮起生效。

自身没有做过选择的空白会话，会在其 agent 创建时被盖上部署的 `default`，形式是一次普通的已记录选择，因此恢复或分叉后的会话重建的是它实际运行过的预设，而不是之后碰巧是什么的默认值。

### 提交前先预览

`preview(agent, id, signal)` 针对该会话自己的作用域组装两次——一次不带预设，一次带候选项——并返回两份渲染后的提示词、候选项的各小节及创建每个小节的规则，以及候选项未能按原样完成的一切。这些组装被标记为预览，因此绘制预览不会打扰会话正在运行的步骤。

### 规则做不到的事

写入失败要响：无法使用的模式、`gimsu` 之外的标志、超出边界、指名受保护小节的移除，或指向不存在预设的默认值，都会以 `prompt-preset/invalid` 拒绝。组装失败要收敛：仍无法运行的规则被跳过并给出警告，其余规则照常应用；结果无法渲染的预设仅在该次组装中被丢弃。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

两个决定支撑起本包。变换通过 `ctx.systemPrompt.finalize()` 注册，而不是作为 `system-prompt/assemble` 监听器，因为监听器既没有契约保证自己最后发言，也压不过已注册的 `complete: true` 段——随产品发布的 `minimal` agent 预设就有一个。而会话运行哪个预设，在每次组装时从其持久的 `promptPreset` projection（投影）读取，而不是按 agent 缓存，于是恢复与分叉都不需要任何种子代码，日志成为唯一来源。

一次注册覆盖所有会话：该覆盖是全局且无作用域的，per-session（按会话）行为来自读取每次组装自己的 agent。这也覆盖了在本行加载之前就已创建的 agent。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务入口：带两个 volatile 字段的 `Config`、最终覆盖、空白会话盖章、`@Remote` 面 |
| [`src/rules.ts`](src/rules.ts) | 规则词汇与 `applyRules`——对组装后小节的纯变换 |
| [`src/schema.ts`](src/schema.ts) | 运行时 schema，以及 schema 表达不了的边界与保护 |
| [`src/session.ts`](src/session.ts) | `prompt-preset/selected` 事件与 `promptPreset` projection |
| [`src/types.ts`](src/types.ts) | 客户端安全的 wire 载荷、失败码与声明合并 |
| — | 不发布运行时 invariant（不变式）伴生包：诊断伴生包会把故障大声报出来，而本包唯一的交叉核对是有意只警告的（见[已提交提示词核对](#the-committed-prompt-check)）。 |

<a id="the-committed-prompt-check"></a>

### 已提交提示词核对

覆盖方返回提示词；循环渲染它、替换 surface 节点 0，会话再把它作为 `system/message` 提交。因此已提交的文本经由一条本包并不掌控的路径抵达，这使它成为对覆盖方所作担保的一次独立读数。

存储会为每个会话保留它产出过的每篇提示词的摘要，并用下一次提交的 `system/message` 与它们比对。若某段文本与其中任何一篇都不匹配，就说明在最终覆盖跑完之后有东西改写了提示词。它每个会话只记一条警告，且从不中断：消息被提交时该步骤早已跑完，为一次上报层面的不一致而让这一轮失败，比这一不一致本身更糟。保留的是摘要而非提示词，并且一经核对即刻丢弃该集合。预览不记录任何东西——它的组装带着 `preview: true`。

### 渲染探针

`substitute` 是唯一可能产出注册表无法渲染之文本的规则：它可以把 `{{` 注入到一个确实会插值的小节里。因此覆盖方在返回前先渲染自己的结果，一旦抛出就返回未变换的组装，并附带 `render-failed` 警告。存储的文档绝不能有能力让会话无法运行。

### 为什么警告是编码

组装期与预览期的警告以判别式加上定位它的规则或小节的形式传递，绝不是句子。产品文案由 locale（语言环境）拥有，因此措辞由客户端渲染；`detail` 只携带不可本地化的引擎文本，例如正则表达式编译器的消息。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

包级约定不够用时再读这些页面。

- [系统提示词子系统](../../../docs/subsystems/system-prompt.zh.md)——本包所覆盖的组装，以及它占据的 `PromptFinalizer` 接缝。
- [agent-preset-registry 包](../agent-preset-registry/README.zh.md)——另一种按会话的选择，以及那一种为什么在首轮之后锁定。
- [persona 包](../persona/README.zh.md)——预设可以覆盖掉的、由组合编写的 persona。
- [最终覆盖 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-18-prompt-final-override.zh.md)——为什么允许一份贡献拥有最终决定权。
- [提示词预设 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-19-user-owned-prompt-presets.zh.md)——为什么用规则栈、为什么切换是自由的，以及为什么写入要响而组装不响。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-prompt-presets)——每个受支持字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 提示词变换

#### 模型看到什么

会话的预设产出什么，模型就看到什么，提示词注册表的其余内容都不再出现。未选择预设时，模型看到的组装与其他所有贡献构建出的完全一致。选择了预设时，模型看到的是该组装经过预设规则之后的样子：规则添加的文本成为提示词的开头或结尾；`replace` 只留下部署的受保护小节加上该规则自己的文本；`remove` 删掉指名的小节；`substitute` 改写其余小节中匹配到的文本。文本属于用户，因此本包不钉住其中任何内容；它创建的小节名为 `prompt-preset:<kind>-<index>`，除非规则要求插值，否则其文本按字面处理。无法运行的规则会被跳过，模型看到规则栈其余部分的应用结果；无法渲染的结果则让模型看到未变换的提示词。

#### Token 影响

是替换而非追加：预设决定整个提示词，因此成本是它的结果而不是一个增量。规则添加的部分受部署的 `maxRules` 与 `maxTextBytes` 约束，而 `replace` 可以让提示词比原本更小。

#### KV Cache 影响

只要选择与所选预设的存储规则都不动，前缀就保持稳定：渲染未变时系统节点保持不动。选择变更、对所选预设的编辑、以及清除选择，都会重写渲染后的提示词，agent loop（智能体循环）将其作为 `system/message` 替换提交——从第一个变化的 token 起使复用失效，并开启一个新的请求序列。由于预设可以重写开头的小节，它的变更比只做追加的贡献更可能移动最靠前的 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明提示词预设在什么情况下并不合适。它们是当前包约束，不是待办事项清单。

- **规则锚定的是小节，不是 order**——`insert` 把文本放在它按完整名称指定的小节之后，因此若预设想要的是一个位置而非一个邻居，或想按名称的一部分匹配，都无从表达。也没有 `before`：改成锚定到前一个小节之后即可。
- **`remove` 只匹配精确名称**——不支持前缀或通配，因为预览会列出每个名称，而第二套模式语法只会再次引入正则表达式的安全面，却带不来新的触达范围。
- **没有实时 agent 就无法预览**——预览针对会话自己的作用域组装，而没有 agent 的作用域会让 `{{model}}` 与 `{{cwd}}` 无从注册，渲染将抛出。设置界面针对用户挑选的会话来预览。
- **模式没有执行预算**——长度、规则数与文本大小都有界，但 Node 无法为正则表达式设置超时，因此病态模式会拖住其作者自己那一轮。该论据只在预设仍属其作者本地时成立；导入或分享预设之前必须先有真正的预算。
- **一次写入会把整张预设表钉进 profile**——Cordis 补丁替换的是完整的条目配置，因此首次编辑之后，后续 bundle 版本新增的预设不会抵达本 profile，直到重置该条目的覆盖。bundle 自带的预设仍拒绝删除，这一判断读取的是继承层而非实时值。
- **规则触达的是提示词，绝非工具 schema**——隐藏工具用 `ctx.tools.restrict()`，它让呈现、查找与执行保持一致；删掉某工具指导小节的预设只会让该工具仍可被调用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
