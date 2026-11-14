# 从目录新增路由（工单 #21）— 视觉证据

- 基线：`origin/main` `7b93c33`（`feat: 路由设置卡片增加连接测试（工单 20） (#43)`）
- 变更：本分支 `agent/add-route-from-catalog-bfd04ffca7d8` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，1440×900 视口（并排对照页 1440×760），设备像素比 1
- 场景：设置 → ModelPilot。默认数据为一条 `preview-chat` 路由：显示名 `Preview Chat`、`https://preview.invalid/v1`、`openai-completions`、`PREVIEW_CHAT_API_KEY`、默认上下文 `1000000`、默认输出上限 `32768`、两条模型；空路由场景的 `providers` 为 `{}`
- 目录数据：夹具里的 `listConfigurableProviders()` 返回 `anthropic` / `minimax-cn` / `openai` / `preview-chat`（后者已配置）；真实宿主目录里的其它命名空间条目（如 `deepseek`）不在本页展示
- 数据：没有真实凭据或私人内容。`baseURL` 是 `https://preview.invalid/*`、`relay.invalid/*` 占位地址，`apiKeyEnv` 只是引用名；目录与密钥状态由夹具返回

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `7b93c33` 的产物，after 为本分支产物），由与单测共用的最小 React 渲染器渲染真实的 `Workbench` 组件树；宿主 `--dsw-*` token、`configForms` 快照、命名空间目录和 `credentials.describe` 响应由夹具提供。除 `lib/client.js` 外，before / after 两份页面的路由、模型、视口、主题与夹具完全一致。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；点击、输入与目录列表是真实 DOM 操作，但 `listConfigurableProviders` / `createRoute` 的网络应答由夹具提供，没有打真实宿主。

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：左＝基线（`7b93c33`），右＝变更后；同一 `preview-chat` 路由、同一视口。基线只有路由下拉框，变更后下拉框右侧多出 `[+ 新建路由]` |
| `compare-dark.png` | 深色主题：同上 |

单独的大图：

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线工作台：路由下拉框旁没有新建入口 |
| `after-light.png` / `after-dark.png` | 变更后同一工作台：出现 `[+ 新建路由]` |
| `before-empty-light.png` / `before-empty-dark.png` | 一条路由都没有时的基线：提示「请先在『模型』页添加一个 provider」 |
| `after-empty-light.png` / `after-empty-dark.png` | 同一空状态：提示改为点「+ 新建路由」，按钮可用 |

## 弹窗

| 文件 | 说明 |
| --- | --- |
| `after-dialog-light.png` / `after-dialog-dark.png` | 「从目录选择」：搜索框 + 目录列表；`anthropic` / `minimax-cn` / `openai` 标注「未配置」，`preview-chat` 灰显并标注「已配置」，单选框禁用；`preview-chat` 行整体透明度 0.45，与可选项可区分 |
| `after-custom-light.png` / `after-custom-dark.png` | 「自定义」：provider id / 接口地址 / 协议 / 密钥引用四个输入 + 「模型 ID（至少一条）」；示例填 `my-relay`、`https://relay.invalid/v1`、`openai-completions`、`MY_RELAY_API_KEY`、`relay/alpha, relay/beta`。目录未描述该 id，因此模型输入可见、创建按钮可用 |

弹窗的遮罩、面板、输入框、列表行全部取 `--dsw-*` token：浅色面板 `bg-layer-1`（`#f7f8fa`）/ 深色 `#232529`，文字分别取 `label-primary`；已配置行与正常行通过透明度区分。

## 行为说明

- **目录外必须写 models。** 用户手填的 provider id 不在 `listConfigurableProviders()` 里时，`models` 至少一条才能创建；空的模型输入会禁用「创建路由」并显示「自定义路由至少需要一条模型」。目录已描述该 id 时，弹窗收起模型输入，`value` 不写 `models`。
- **目录里有 + 自定义 baseURL。** 仍不写 `models`，只写用户填的 `api` / `baseURL` / `apiKeyEnv`；宿主继续用内置目录。
- **密钥只写引用名。** `apiKeyEnv` 是唯一进入 op 的密钥相关字段，真值只走工单 #18 的 `credentials.set`；截图里的 `MY_RELAY_API_KEY` 不是密钥。
- **成功后立即切换。** 创建成功会选中新路由、展开路由设置卡片，并在卡片里立即调用 `credentials.describe` 查询引用状态；失败时弹窗保留所有输入并显示宿主拒绝原因。
- **provider id 约束。** `[a-z0-9][a-z0-9-]*`，1–64 位；与已有路由重名时禁用创建并提示「该路由已存在」。

## 验证

- `node --test 'test/**/*.test.mjs'`：**449 项**，443 通过、6 项按既有条件跳过、0 失败；新增 `test/core/route-create.test.mjs` 19 项与 `test/client/new-route.test.mjs` 18 项。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `fcb0804141b4a3300f34cfc95bb868ed15a206bfa982c8ea6f756a58dd5eaa8b`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
