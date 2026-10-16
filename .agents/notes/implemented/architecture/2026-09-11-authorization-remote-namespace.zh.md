# Agent Note: 授权 seam 抵达浏览器

Status: implemented

[English](2026-09-11-authorization-remote-namespace.md) | 中文

## Problem

`ctx.authorization` 在本仓库中只有一个使用方：`dsh-llm-pi-ai`，它为每个提供登录的已安装提供方注册一个 flow。没有任何地方调用 `begin()`。服务只有通过 `packages/api/*` 里手写的 `TypertRemoteService` 才能抵达浏览器页面——`credentials` 有 `CredentialsController`，`settings` 有 `SettingsController`——而授权一个都没有，因此本仓库发布的任何界面都无法发起登录。pi-ai 实现的每一种 OAuth 登录（Anthropic、OpenAI Codex、OpenRouter、xAI、Kimi）都点不到，而 Models 页面只能提供 API 密钥字段，那些提供方并不接受它。

障碍不在管道，而在形状。另外两个 namespace 都是请求/响应：页面发问，Host 作答，调用结束。而 flow 是一段对话——它报出要打开的页面，再询问人在那里看到了什么——并且人的那一半发生在另一个浏览器标签页里，历时不受限。一个只能返回值的 namespace 没有任何东西可以刻画它。

## Decision

`AuthorizationController` 在 `dsh-api-settings-controller` 中与另外两个并列，拥有 `authorization` namespace。一次 `begin(key, method)` 调用**就是**那次尝试：它在整段对话期间保持打开，并以 seam 自己的结果落定，因此放弃该调用——关闭标签页、页面跳走——会中止它的 signal 并撤回尝试，无需任何额外记账。flow 期间所说的内容以三个转发的 Cordis 事件离开（`api-authorization/notice`、`/prompt`、`/prompt-closed`），页面则用自己的 `answer(attempt, prompt, value)` 调用回答每个提问。把这三段 wire 拼在一起的正是 attempt 与 prompt 的 id，因此同时运行两个登录的页面不可能答错问题，而回答一个已不再打开的提问会被拒绝而非忽略。

`cancel(key)` 与该调用自身的 signal 并存，是因为「取消」按钮本身是一次新请求：按下它的页面并不持有它所取消的那次调用的句柄。当没有挂载 seam 时，`list()` 回答空列表而非失败，因此没有 seam 的部署渲染不出登录，而不是抛出一个没人能处理的错误。

浏览器那一半是 Models 页面的一个分区：`SignInStore` 把三段 wire 变成每个 flow 一份可渲染状态，`SignInSection` 把这些行渲染在提供方列表之后。行以 flow 为键而非以提供方路由为键，因为该 seam 与提供方无关——一次注册同样服务 Z.AI、Anthropic 与 Codex。没有注册任何 flow 时该分区完全不渲染，而页面的 `signIn` prop 是可选的，因此不注入它的外壳渲染出的是没有这些行的页面，而不是渲染不出页面。

## Alternatives considered

**复用 `ctx.userQuestions` 来承载提问。** 它已经把一个 waterfall 转发到浏览器，也有回答它的 UI，本可省掉大部分客户端工作。它落选是因为该 seam 以 agent 为作用域：它的应答方挂在活跃 agent 的运行时根上，其 UI 是聊天的 ask-user 卡片。从设置发起的登录没有 agent，把它的提问送进会话视图会把它们放在人并没有在看的地方。

**让 `begin` 返回一个 attempt id，再轮询状态。** 短调用在请求/响应传输上更容易推理，也能扛住连接中断。它输在真正要紧的地方：flow 自己的 `AbortSignal` 将不再与调用方绑定，于是关掉的页面会让尝试一直跑到别的东西注意到为止，而 seam 的「每个 key 同时只允许一次尝试」会开始被废弃的尝试卡死。保持调用打开，才让浏览器的存活就是尝试的存活。

**改做一个 CLI 登录命令。** 小得多，也足以取得一次凭据。它落选是因为人们实际配置提供方的界面就是 Models 页面；只能从终端取得的凭据，桌面用户拿不到。

**通过 `settings.models.provider-card` 把行放进每张提供方卡片。** 比一个分区更易发现，而那个插槽正是为适配器家族的额外内容准备的。它落选是因为该插槽是留给**仓库之外**分发的插件的席位，由声明它的包自己来填等于把约定反过来用。以 flow 为键的分区也能服务那些其 key 并不对应任何可配置提供方行的 flow。

## Consequences

pi-ai 提供的每一种登录都变得可达，而不只是本次为之而建的 Z.AI 那一种：Models 页面如今会列出 `ctx.authorization` 所持有的一切。代价是一个调用长时存活的 namespace，这对本 Gateway 是新情况——一次登录会在人花掉的全部时间里占用一个请求，而一个会让空闲请求超时的传输会以那些短 namespace 从未暴露过的方式破坏它。

`dsh-api-settings-controller` 多了第三个 namespace 与两个新依赖（授权 seam 与 uuid 工具），`dsh-api-remotes` 多转发三个事件。客户端页面在一个可选 prop 之后多了一个 store 与一个分区，因此它已有的各套测试挂载方式保持不变。
