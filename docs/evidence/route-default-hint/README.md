# 路由默认值与模型声明的关系 — 视觉证据

- 基线：`289f6e9`（`origin/main`，`feat: 路由级字段编辑与删除路由（第一批） (#32) (#33)`）
- 变更：本分支 `agent/route-default-hint-045d4be93e18` 的 PR 头提交；截图在
  `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：Chrome 152.0.7977.64 headless，1440×1600 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `sparse-chat`，三个模型故意带不同声明：
  - `jxf/dsv4.1-flash`：`contextWindow` / `maxTokens` 都没声明
  - `tx/deepseek-v4.1-chat`：只声明 `contextWindow: 128000`
  - `qwen/complete`：两个都声明（`262144` / `8192`）
- 数据：没有真实凭据或私人内容；`baseURL` 是 `https://sparse.invalid/v1` 占位地址，
  `apiKeyEnv` 只是引用名

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为
`289f6e9` 的产物，after 为本分支产物），由与单测共用的最小 React 渲染器渲染真实的
`Workbench` 组件树，宿主 `--dsw-*` token、`configForms` 快照与命名空间 schema 用夹具
提供。除 `lib/client.js` 外，before / after 两份页面的 provider、模型、视口、主题与
夹具完全一致；交互（展开卡片、改默认值、点计数展开清单）都是真实 DOM 操作。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例。
另外，ModelPilot 的设置客户端拿不到宿主「已安装目录描述了哪些模型 id」的清单；
计数按「模型自己声明了没有」统计。对本页的自定义路由，宿主内置目录确实为空，所以
结果与真实回落链一致；内置目录优先规则由 `usesRouteDefault(model, catalogIds)` 的
纯函数与单测固定（`test/projection/route-edit.test.mjs`），见 PR 说明。

## 展开后的默认值说明：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线：默认值下方只有一句「未声明窗口 / 输出上限的模型回落到这两个值；留空表示清空（回到宿主回落），数字必须是正整数。」。没有三级回落顺序、没有压缩阈值说明、没有任何计数 |
| `after-light.png` / `after-dark.png` | 变更后：同一场景下默认值下方是三行语义 + 两个字段各自的实时计数；点「1 个」「2 个」就地展开受影响模型清单，每条写清未声明什么 |

三行语义（工单 3.1）：

```text
未声明窗口 / 输出上限的模型回落到这两个值；已声明自己的模型不受影响。
回落顺序：模型自己 → 内置目录 → 这里。
注意：这里只影响请求参数，不影响 DSH 压缩阈值 —— 后者只认模型自己声明的那一项。
```

同一次截图里的计数（表单值 `1000000` / `32768`，尚未保存）：

```text
默认上下文：当前路由 3 个模型中有 1 个会使用这两个值。
  jxf/dsv4.1-flash —— 未声明 contextWindow / maxTokens
默认输出上限：当前路由 3 个模型中有 2 个会使用这两个值。
  jxf/dsv4.1-flash —— 未声明 contextWindow / maxTokens
  tx/deepseek-v4.1-chat —— 未声明 maxTokens（已声明 contextWindow）
```

窗口只数到 `jxf`（`tx` 声明了 `contextWindow`、`qwen` 两个都声明），输出上限数到
`jxf` + `tx` —— 两个字段分别统计，不合并。

## 留空状态

| 文件 | 说明 |
| --- | --- |
| `after-blank-light.png` / `after-blank-dark.png` | 两个默认值都留空：不再显示计数行，改为写明留空的真实后果 ——「默认上下文：留空 → 宿主使用内置默认值 1,000,000（1M）」「默认输出上限：留空 → 宿主使用内置默认值 128,000（128K）」。填回数字后计数行实时出现，不需要保存 |

## 计数状态（真实 DOM 测试覆盖）

`test/client/route-edit.test.mjs` 的 `usage` 夹具在同一页里覆盖：

| 状态 | 文案 |
| --- | --- |
| 部分受影响 | `默认输出上限：当前路由 3 个模型中有 2 个会使用这两个值。`（点「2 个」展开清单） |
| 全部受影响 | `默认上下文：当前路由 2 个模型全部使用这两个值。` |
| 全部不受影响 | `默认上下文：当前路由 1 个模型都已声明自己的值，这两个输入框不影响它们。` |
| 路由没有模型 | 不显示计数行；仍显示三行语义与留空回落 |

计数随表单输入实时更新（每次读取都断言 `mutations === 0`，不需要保存）。
