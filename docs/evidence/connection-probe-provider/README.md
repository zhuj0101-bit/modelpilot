# 连接测试按 declared 分流（工单 #29）— 视觉证据

- 基线：`origin/main` `4ab7a3e`（`feat: 模型行摘要标注值来源（工单 #27） (#57)`），`lib/client.js` SHA-256 `e3d79a9c3ba3e3769c2795d72489a5f8c68bac5d681f2b77e7d8e4422486a5bd`
- 变更：本分支 `agent/connection-probe-provider-dcad4572dcc5` 的头提交；`lib/client.js` SHA-256 `53a2e313c494531af09c552a02b7fd9ab94deb97764719ca9e2150ed6dc33c23`（连续两次构建同值）
- 环境：headless Chrome 152.0.7977.64，`--window-size=1440,1500`，设备像素比 1；截图按 `#root` 实际包围盒裁切（约 980×1908）
- 场景：设置 → ModelPilot，当前路由 `relay-route`（`declared: true`，适配器只因为配置才知道这条路由）；显示名 `Relay Route`、地址 `https://relay.invalid/v1`、协议 `openai-completions`、密钥引用 `RELAY_ROUTE_API_KEY`、一条模型 `relay/model-a`
- 数据：没有真实凭据或私人内容。`baseURL` 是 `https://relay.invalid/*` 占位地址，`apiKeyEnv` 只是引用名；探活响应由夹具返回（401 / 404 / 500）

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `4ab7a3e` 的产物，after 为本分支产物）。页面由与单测共用的最小 React 渲染器渲染真实 `Workbench` 组件树，宿主 `--dsw-*` token、`configForms` 快照、目录条目与 `remote.llm.discoverModels` 响应由 `test/client/connection-test-harness.mjs` 的夹具提供；headless Chrome 通过 CDP `Page.captureScreenshot` 截取 `#root`，before / after 除 `lib/client.js` 外完全相同。

`buildConnectionTestHtml(bundle, scheme, { evidence: "declared-401" })`（或 `declared-404` / `declared-500`）会复用同一套页面夹具，把界面驱动到「declared 路由 + 指定 HTTP 状态」的最终状态，再交给截图脚本。

局限：页面是夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；展开、点击、结果渲染是真实 DOM 操作，但网络请求由 `discoverModels` 夹具应答，没有打真实端点。页面没有提供命名空间 schema，因此两侧都出现既有的「协议清单读取失败，使用内置列表」「模态清单读取失败」提示；这是夹具共有的背景状态，不是本单改动。

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `before-declared-401-light.png` / `after-declared-401-light.png` | 浅色主题，端点返回 401。基线只显示宿主原文 `https://relay.invalid/v1/models answered 401; check the API key`；变更后前置「密钥未通过认证（HTTP 401）：」，原文保留 |
| `before-declared-401-dark.png` / `after-declared-401-dark.png` | 深色主题，同上 |
| `before-declared-404-light.png` / `after-declared-404-light.png` | 浅色主题，端点返回 404。变更后前置「接口地址可能写错（HTTP 404）：」 |
| `before-declared-404-dark.png` / `after-declared-404-dark.png` | 深色主题，同上 |
| `before-declared-500-light.png` / `after-declared-500-light.png` | 浅色主题，端点返回 500。变更后前置「服务端错误（HTTP 500）：」 |
| `before-declared-500-dark.png` / `after-declared-500-dark.png` | 深色主题，同上 |

三种状态的 before 页面都只显示宿主原文；after 页面都在原文前加了一句明确分类，原始消息（状态码、URL、`check the API key`）逐字保留，红色错误样式不变。

## 实现要点

- **按 `declared` 分流。** 连接测试先读 `listConfigurableProviders()`：`declared === true` 的路由在 `discoverModels` 请求里带 `provider: routeId`，宿主才会解析已保存的凭据；`declared === false`（内置目录有货）不带 `provider`，避免宿主直接回目录、冒充真实探活。
- **目录读不到时保守处理。** `listConfigurableProviders` 抛错 / 拒绝 / 返回失败形态时，一律按 `declared = true` 处理：至少把凭据交给宿主，让用户看到端点的真实结果，而不是「没带密钥」的 401。
- **密钥不经过前端。** 请求只带 `provider` / `baseURL` / `api`，从不出现 `apiKey` / `apiKeyEnv` / `signal`；密钥仍由宿主凭据存储解析。
- **失败文案分类。** 401 / 403 → 「密钥未通过认证」；404 → 「接口地址可能写错」；5xx → 「服务端错误」。分类前缀在前，整体仍截断到 200 字符，前缀不会被截掉。
- **只读。** 测试不调用 `configForms.mutate`，不增删任何 `settingsOps`；表单字段一改，上一轮结论立即作废。
- **拉取模型列表不变。** `fetchModels` 仍固定带 `provider`，本单未改动该路径。

## 测试与产物验证

```text
$ node --test 'test/**/*.test.mjs'
ℹ tests 712
ℹ pass 706
ℹ fail 0
ℹ skipped 6
```

基线 687 项（681 pass + 6 skip）全部保留；新增 25 项：`test/core/connection-probe.test.mjs` 17 项纯逻辑 + `test/client/connection-test.test.mjs` 新增 8 项真实 DOM（light / dark 各 4 项）。

```text
$ node scripts/build-client.mjs   # 连续两次
53a2e313c494531af09c552a02b7fd9ab94deb97764719ca9e2150ed6dc33c23
53a2e313c494531af09c552a02b7fd9ab94deb97764719ca9e2150ed6dc33c23

$ node scripts/verify-package.mjs .
PASS 1 … PASS 18
```
