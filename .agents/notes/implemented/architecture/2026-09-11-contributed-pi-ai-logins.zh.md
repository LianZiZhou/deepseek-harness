# Agent Note: 被贡献的 pi-ai 登录，以及 Z.AI GLM Coding Plan 登录

Status: implemented

[English](2026-09-11-contributed-pi-ai-logins.md) | 中文

## Problem

模型厂商可能提供上游 pi-ai 目录并未实现的浏览器登录。Z.AI 就是逼出这个问题的案例：`@earendil-works/pi-ai` 提供的 `zai` 提供方唯一的认证方式是从已存储凭据或 `ZAI_API_KEY` 读取的 API 密钥，而 GLM Coding Plan 订阅者的凭据要通过在 `chat.z.ai` 登录、再用所得 token 铸造密钥来获取。等上游不是办法——该流程存在于 pi-ai 源码的一个下游 fork 中，任何已发布版本里都没有——因此 harness 需要一种不 fork 适配器就能添加某一家厂商登录的办法。

授权 seam 让这成为结构问题而非打包偏好。它对每条凭据记录只允许一个 flow，而 `dsh-llm-pi-ai` 已经为每条已安装路由认领了 `llm-pi-ai/<provider id>`。第二个插件为 `llm-pi-ai/zai` 注册 flow 会被 `DUPLICATE_FLOW` 拒绝；而在自有 scope 下注册自有记录的插件，持有的是 `zai` 路由根本不会读的凭据。pi-ai 的 `zai` 提供方唯一会拿来认证的密钥，就是 `dsh-llm-pi-ai` 存下的那一个。

## Decision

`dsh-llm-pi-ai` 暴露 `contributePiAiLogin(ctx, contribution)`：另一个插件向本包已为某条已安装路由注册的 flow 添加一个登录**方法**，点名路由、方法 id 与标签，以及一个返回 `{ apiKey }` 的 `run(session)`。记录由适配器写入；贡献方从不触碰凭据平面，因此 `dsh-llm-pi-ai` 仍是所有以其格式写入的记录的唯一写入方，而一次贡献完全不携带任何 pi-ai 类型。

某条路由的贡献集合变化时，其 flow 会重新注册，这会撤回该路由上已在运行的尝试——选择器不该提供一个正在运行的 flow 无法服务的方法。被贡献的方法排在 pi-ai 自己的 API 密钥提问之前、pi-ai 自己的 OAuth 之后，因此当存在浏览器对话时，运行 flow 首个方法的界面会抵达它。贡献注册表以 context root 弱引用为键，因此同一进程中的两个组合绝不会看到彼此的贡献；每次贡献都经 `ctx.effect` 注册，因此会随其插件一同离开。向 pi-ai 不提供的路由贡献会以 `UNKNOWN_PI_AI_ROUTE` 拒绝，方法 id 冲突以 `DUPLICATE_LOGIN_METHOD` 拒绝，而返回空密钥的运行会让尝试以 `EMPTY_CONTRIBUTED_KEY` 失败，而不是报告一次什么都没存下的授权。

`@deepseek-ai/dsh-llm-zai-coding-plan` 是第一个使用方，端到端拥有 Z.AI 协议：来自 `chat.z.ai` 的授权码、在 `zcode.z.ai` 的 token 交换、在 `api.z.ai` 的业务登录与密钥配置，以及 54548 端口上与粘贴重定向地址赛跑的 loopback 监听器。它没有配置。端口固定，是因为 Z.AI 会拿重定向地址与其自家桌面客户端注册的地址比对；铸造出的密钥名为 `deepseek-harness`，因此登录两次会复用同一个密钥，吊销它也绝不影响其他客户端创建的密钥。

## Alternatives considered

**把 Z.AI 登录实现在 `dsh-llm-pi-ai` 内部。** 改动最小，也是凭据归属规则所指向的方案，因为记录归该包所有。它落选是因为该包就是 pi-ai 边界——它的全部约定就是不让任何 pi-ai 专有的东西外溢、也不让任何厂商专有的东西进入——把一家厂商的私有端点放进去，会让下一家厂商的做法变成先例而非决策。

**发布一个带自有路由的独立包。** 为 pi-ai 不提供的路由键（`zai-coding-plan`，对齐上游 fork 的提供方 id）注册 flow 的插件完全不需要改动适配器。它输在模型目录上：`buildProvider` 只有当路由键**就是**某个 pi-ai 目录 id 时才继承端点、协议与模型，因此这样一条路由必须手工声明 `api`、`baseURL` 与整张 GLM 模型表——这份副本会在每次升级时与 pi-ai 自己的 `zai` 目录漂移，并在用户的模型选择器中多出一套 GLM 模型。

**升级 `@earendil-works/pi-ai`。** 这是核实过的而非假定的：直到 0.85.1 为止的每个已发布版本都没有 `zai-coding-plan`——提供方数据只有 `zai` 与 `zai-coding-cn`，`zai.js` 声明的是 `envApiKeyAuth`，`dist/auth/oauth/` 里也没有任何 Z.AI 流程。该实现位于 pi-ai 源码的一个下游 fork 中，因此没有任何升级能带来它。

**让贡献返回 pi-ai 自己的 `Credential` 联合类型。** 因缺少使用方而被否决：今天可能被贡献的每一种登录最终都落在一个 API 密钥上，而把约定放宽成一个贡献方必须从 pi-ai 导入的联合类型，恰恰会重新引入这个 seam 所消除的耦合。等到确有需要时，被贡献的 OAuth grant 只差加一个字段。

**只用粘贴，不设 loopback 监听器。** 更简单，对于人通过网络访问的 harness 也是正确的。它输在常见场景上：在本机安装上，重定向能在人无需复制任何东西的情况下完成登录。让两者赛跑的代价只是一个 `AbortController`，而 seam 本就为此定义了提问撤回。

## Consequences

厂商登录如今只是一个普通的包：`dsh-llm-zai-coding-plan` 约 350 行，对 pi-ai 一无所知，下一个照搬其形状即可。代价是 `dsh-llm-pi-ai` 上多了一个必须保持兼容的公开扩展点，以及 `zai` 路由上的一处行为变化——只要挂载了本插件，该路由 flow 的首个方法就变成浏览器登录，因此静默运行首个方法的界面会打开浏览器，而不再提问密钥。

Z.AI 的端点是从其桌面客户端对齐来的私有端点。没有任何测试会触达 Z.AI：`tests/fake-zai.ts` 应答整条序列，`tests/composition.spec.ts` 通过 Loader 启动实际发布的组合，因此 Z.AI 那侧的变化由人登录时发现，而不是由 CI 发现。`zai-coding-cn`（`open.bigmodel.cn`）是有意不服务的；该部署仍需手工填入密钥。
