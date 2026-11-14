# 连接测试（平替第四批）— 视觉证据

- 基线：`origin/main` `28ec70e`（`feat: 模型列表拖动排序与键盘排序（工单 #19） (#42)`）
- 变更：本分支 `agent/connection-test-cba86ef47bed` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，1440×1500 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`：显示名 `Preview Chat`、`https://preview.invalid/v1`、`openai-completions`、`PREVIEW_CHAT_API_KEY`、默认上下文 `1000000`、默认输出上限 `32768`、缓存 `short`、传输 `auto`、超时 `60000`；三条模型 + `compat` + 宿主未来字段 `futureHostField`
- 数据：没有真实凭据或私人内容。`baseURL` 是 `https://preview.invalid/*` 占位地址，`apiKeyEnv` 只是引用名；探活响应由夹具返回（37 个模型 / 空数组 / `DISCOVERY_UNSUPPORTED` / 401 文案）

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `28ec70e` 的产物，after 为本分支产物），由与单测共用的最小 React 渲染器渲染真实的 `Workbench` 组件树；宿主 `--dsw-*` token、`configForms` 快照、命名空间 schema 与 `remote.llm.discoverModels` 响应由夹具提供。除 `lib/client.js` 外，before / after 两份页面的 provider、模型、视口、主题与夹具完全一致。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；点击、展开与结果渲染是真实 DOM 操作，但网络请求由 `discoverModels` 夹具应答，没有打真实端点。

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：左＝基线（`28ec70e`），右＝变更后，同一 `preview-chat` 路由、同一视口；两边都展开路由设置 |
| `compare-dark.png` | 深色主题：同上 |

基线只有 `[删除路由] [保存设置]`；变更后在两者之间多了 `[测试连接]`，位置与「保存设置」并列。

## 四种结果与边界

| 文件 | 说明 |
| --- | --- |
| `after-idle-light.png` / `after-idle-dark.png` | 展开卡片后的初始状态：`[删除路由] [测试连接] [保存设置]`，还没有任何测试结果 |
| `after-success-light.png` / `after-success-dark.png` | `ok: true` 且返回 37 个模型：绿色 `连接正常 · 端点返回 37 个模型`（`state-success-primary`） |
| `after-empty-light.png` / `after-empty-dark.png` | `ok: true` 但空数组：黄色 `连接正常，但端点没有返回任何模型`（`state-warn-primary`）——端点可能对未授权请求返回 200 + 空列表 |
| `after-unsupported-light.png` / `after-unsupported-dark.png` | `error.code === "DISCOVERY_UNSUPPORTED"`：红色 `该协议没有可读的模型列表，换个协议或手动填写模型` |
| `after-error-light.png` / `after-error-dark.png` | 其它错误：红色原文 `https://preview.invalid/v2 answered 401; check the API key`；超过 200 字符时截断到 200 |

截图页面没有提供命名空间 schema，因此两侧都出现既有的「协议清单读取失败，使用内置列表」提示；这是夹具共有的背景状态，不是本单改动。

## 实现要点

- **请求不带 `provider`。** 宿主看到 `provider` 且内置目录非空时会直接返回目录、不发 HTTP 请求；连接测试只传 `baseURL`（以及非空的 `api`），保证每次都是真实探活。单测断言所有 7 次请求都没有 `provider` / `apiKey` / `apiKeyEnv` / `signal`。
- **用表单当前值。** 请求参数在点击瞬间从表单读取快照；结果出现前改动任何字段都会清掉结果，进行中的请求仍按发起时的快照跑，迟到结果不再落地。
- **只读。** 测试不调用 `configForms.mutate`，不增删任何 `settingsOps`，也不写 localStorage / 凭据存储。
- **按需触发。** 没有自动测试，没有结果缓存：每次点击都是一次新的网络请求。

## 测试与产物验证

- `node --test 'test/**/*.test.mjs'`：**418 项**，412 通过、6 项按既有条件跳过、0 失败；新增 `test/client/connection-test.test.mjs` 20 项（light / dark 各 10 项真实 DOM）。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `ac0d6140a6754cd5d97c01144714b32becc4e90ad16960c1acecef6f906ada4b`（可重现；重建后 `git diff --stat lib/client.js` 为空）。
- `node scripts/verify-package.mjs .`：18/18 PASS。

## 说明

- `apiKeyEnv` 为空时按钮**不**禁用：本地 Ollama / vLLM 这类端点无鉴权，是否带 key 由真实响应决定，不提前假设。
- 宿主解析已保存凭据的 discovery 通道以 `provider` 为键；本单按验收判据 6 不传 `provider`，因此需要鉴权的端点可能返回 401，界面会如实显示宿主原文。这是工单指定的探测语义，不是前端吞错。
