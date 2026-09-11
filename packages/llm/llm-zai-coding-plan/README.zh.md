---
description: "面向不想手工粘贴 Z.AI API 密钥的用户与维护者的 Z.AI GLM Coding Plan 浏览器登录说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-zai-coding-plan

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-zai-coding-plan` 让人在浏览器中登录 Z.AI 的 GLM Coding Plan，并把登录产出的密钥存为 `zai` 路由的凭据。Z.AI 不会签发任何推理请求可以直接使用的东西：浏览器对话只产出一个短时 OAuth token，持久的 `id.secret` 密钥要在此之后经 Z.AI 业务 API 铸造。由于产物就是一个普通 API 密钥，本插件向 [`dsh-llm-pi-ai`](../llm-pi-ai/README.zh.md) 已为其 `zai` 路由注册的 flow 贡献一个登录**方法**，而不是新增一个提供方——模型、端点与存储记录都仍属于那条路由。本插件没有配置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

[`dsh-base`](../../bundle/base/README.zh.md) bundle 已把它与 pi-ai 适配器一起挂载，因此每个基于 base 的 profile 都已提供它：该方法会出现在 `zai` 登录里，名为 **Sign in with Z.AI (GLM Coding Plan)**，排在 pi-ai 自己的密钥提问之前，因此运行 flow 首个方法的界面会打开浏览器。手工组合的 profile 自行挂载这两者：

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      zai: {}
- name: '@deepseek-ai/dsh-llm-zai-coding-plan'
```

让登录后的模型可被选中的是那条路由条目；插件本身不需要任何配置，因为正是登录才让一条路由值得配置。没有挂载 pi-ai 适配器的组合，只是没有任何 flow 可供该方法出现。

### 人要做什么

1. 某个界面以 `oauth` 方法发起 `llm-pi-ai/zai` 授权。
2. 插件报出要打开的 `chat.z.ai` 授权页，并在同一口气里把重定向地址作为回退选项问出来。
3. 谁先到就用谁：本机浏览器会抵达 54548 端口上的 loopback 监听器，提问随即无人作答地撤回；在别处的浏览器则停在一个无法抵达的地址上，由人粘贴回来。
4. 插件交换授权码、铸造密钥，适配器把它存下。此后 Z.AI 控制台会列出一个名为 `deepseek-harness` 的密钥。

再次登录会复用那个密钥而不是再造一个，因此在 Z.AI 控制台吊销它会让本 harness 退出登录，同时不影响其他客户端创建的密钥。

-----

<a id="understand-the-implementation"></a>
## 理解实现

下面每个端点都是 Z.AI 自家桌面客户端调用的端点，没有一个是公开 API，因此 Z.AI 那侧的变更在这里表现为一次失败的登录，而不是一则废弃通知。顺序是：从 `chat.z.ai/api/oauth/authorize` 取授权码（无 PKCE），在 `zcode.z.ai/api/v1/oauth/token` 交换 token（请求体既不带 `grant_type` 也不带 verifier），在 `api.z.ai/api/auth/z/login` 完成业务登录，从 `getCustomerInfo` 取账号的默认组织与项目，然后查找或创建名为 `deepseek-harness` 的密钥，并经密钥集合的 `copy` 端点读回其 secret。secret 一律取自 `copy`：密钥列表会把它打码，而创建响应只在部分账号状态下携带它。

loopback 端口固定为 54548 且不可配置，因为 Z.AI 会拿重定向地址与其自家客户端注册的地址比对——由本 harness 自行挑选的端口会在授权页就被拒绝，而人在那里无能为力。因此绑定该端口失败是回退到粘贴重定向地址，而不是登录失败。

| 导出 | 职责 |
|---|---|
| `apply(ctx)` | 向 pi-ai `zai` 路由贡献该登录；返回的 disposer 会撤回它。 |
| `runZaiSignIn(session, options?)` | 运行一次登录并返回铸造出的密钥。`options` 供测试替换 fetch 实现与 loopback 端口。 |
| `CALLBACK_PORT` | 已注册的 loopback 端口，`54548`。 |
| `KEY_NAME` | 铸造出的密钥在 Z.AI 控制台中的名称，`deepseek-harness`。 |
| `ZaiSignInError` | 失败类；`code` 取值为 `ZAI_REJECTED`、`ZAI_HTTP`、`ZAI_NO_CODE`、`ZAI_STATE_MISMATCH`、`ZAI_NO_ACCESS_TOKEN`、`ZAI_NO_BUSINESS_TOKEN`、`ZAI_NO_PROJECT`、`ZAI_NO_KEY`、`ZAI_NO_SECRET` 之一。 |

<a id="model-experience"></a>
## 模型体验

无，因为该登录只获取请求用于认证的凭据，它产出的任何东西都不会作为内容进入模型请求。

#### KV Cache 影响

独立：本插件不发起任何模型请求，也不改变任何请求前缀。凭据变化的路由发送的仍是同一份提示词，只是换了一个请求头。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **这些端点是 Z.AI 的私有端点**——client id、授权页、token 请求体以及整条业务 API 序列都对齐 Z.AI 桌面客户端。Z.AI 可以随时改动其中任何一项，届时登录会失败，并在错误中点名出问题的那一步。
- **不服务 `zai-coding-cn`**——该登录只针对 `api.z.ai` 铸造密钥。部署在 `open.bigmodel.cn` 上的仍需手工填入密钥。
- **密钥名称是固定的**——一个账号为两处 harness 安装登录时，共用名为 `deepseek-harness` 的那一个密钥，因此吊销它会让两处一起退出登录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

该登录是对着一个路由假件而非 Z.AI 本身验证的：`tests/fake-zai.ts` 应答整条端点序列，`tests/composition.spec.ts` 通过 Loader 启动实际发布的组合，以证明该方法确实抵达真实 flow。没有任何测试会触达 Z.AI，因此他们端点的变化由人登录时发现，而不是由 CI 发现。

</details>
