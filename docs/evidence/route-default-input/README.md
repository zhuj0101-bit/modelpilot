# 默认输入模态（defaultInput）— 第 10 个路由级字段 — 视觉证据

- 基线：`origin/main` `39e8c3e`（`feat: 从目录新增路由（工单 #21） (#45)`）
- 变更：本分支 `agent/route-default-input-fd7af58fe241` 的头提交；截图在
  `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集（产物 SHA-256
  `f5655fea83b8a303223e387091b8c3b50a28db374a081301b00e170d716804a8`）
- 环境：headless Chrome 152.0.7977.64，1440×1500 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`：显示名 `Preview Chat`、
  `https://preview.invalid/v1`、`openai-completions`、`PREVIEW_CHAT_API_KEY`、
  默认上下文 `1000000`、默认输出上限 `32768`、缓存 `short`、传输 `auto`、
  超时 `60000`、`defaultInput: ["image"]`；4 条模型故意带不同声明：
  - `jxf/dsv4.1-flash`：没声明 `input`
  - `jxf/vision-empty`：`input: []`（明确一个模态都不开）
  - `jxf/vision-declared`：`input: ["text","image"]`
  - `jxf/text-only`：只声明 `contextWindow: 128000` / `maxTokens: 8192`
- 数据：没有真实凭据或私人内容。`baseURL` 是 `https://preview.invalid/v1` 占位地址，
  `apiKeyEnv` 只是引用名；模态候选由命名空间 schema 夹具提供（宿主当前的
  `text` / `image` 两项）。

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为
`39e8c3e` 的产物，after 为本分支产物），由与单测共用的最小 React 渲染器渲染真实的
`Workbench` 组件树；宿主 `--dsw-*` token、`configForms` 快照与命名空间 schema 用夹具
提供。除 `lib/client.js` 外，before / after 两份页面的 provider、模型、视口、主题与
夹具完全一致；展开卡片、点 chip、展开计数与 `settingsOps` 预览都是真实 DOM 操作。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例。
截图场景里 schema 可用；「schema 读不到 → 退回内置清单并标注」这一路只在
`test/client/route-edit.test.mjs` 的真实 DOM 测试里覆盖（`input:fallback` 夹具），
没有单独截图。

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：左＝基线（`39e8c3e`），右＝变更后，同一 `preview-chat` 路由、同一视口、同一未改动状态 |
| `compare-dark.png` | 深色主题：同上 |

基线只有 9 个路由字段，默认值下方没有输入模态控件；变更后在数字默认值下方多出
「默认输入模态 (defaultInput)」多选 chip，候选从宿主 schema 现读（标注
「选项来自宿主 schema」），路由声明的 `image` 已预选。

## 展开状态

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线：9 个字段；默认值说明只有「未声明窗口 / 输出上限的模型回落到这两个值」 |
| `after-prefill-light.png` / `after-prefill-dark.png` | 变更后未改动：第 10 个字段出现，`image` 已选；默认值说明同步写上「输入模态」；计数行 `默认输入模态：当前路由 4 个模型中有 2 个会使用这个默认值。` |
| `after-light.png` / `after-dark.png` | 选中 `text` + `image` 两个 chip：`改动字段：默认输入模态`，`保存设置` 从禁用变为可用 |
| `after-count-light.png` / `after-count-dark.png` | 点「2 个」就地展开受影响模型：`jxf/dsv4.1-flash`（没声明 `input`）与 `jxf/text-only`（只声明 token 字段）；`jxf/vision-empty`（`input: []`）与 `jxf/vision-declared` 不算受影响 |
| `after-clear-light.png` / `after-clear-dark.png` | 全部 chip 取消选择：回到「留空 → 宿主使用内置默认值 text（未声明 input 的模型按纯文本处理）」，不再显示计数行 |

## 写入形态（`settingsOps` 预览展开）

| 文件 | 说明 |
| --- | --- |
| `after-both-ops-light.png` / `after-both-ops-dark.png` | `text` + `image` → 恰好 1 条 `op: "set"`，`path: ["providers", "preview-chat", "defaultInput"]`，`value: ["text", "image"]`（叶子路径，不是整条路由 set） |
| `after-clear-ops-light.png` / `after-clear-ops-dark.png` | 全部取消 → 恰好 1 条 `op: "unset"`，path 相同，**没有** `value: []`：宿主会在解析路由时以 `defaultInput must name at least one modality` 拒绝空数组 |

## 关键行为

- **清空 = unset。** 宿主 schema 允许 `defaultInput: []` 通过校验，但运行时拒绝；
  界面把「全部 chip 不选」表达为 unset（回落内置 `["text"]`）。
- **顺序归一化。** chip 点击顺序不影响产出：数组始终按候选清单顺序排
  （`normalizeModalities`），避免同一配置写出不同数组。
- **结构比较。** 与路由原值逐元素比较：原值 `["image","text"]` 与表单归一化后的
  `["text","image"]` 集合相同，不产生 op（`structural` 由真实 DOM 测试与纯函数单测
  双重覆盖）。
- **计数语义。** `defaultInput` 与两个 token 字段同一套「路由默认值影响谁」机制，
  但按 `input` 数组是否声明判断：`input: []` 也算已声明；只声明 token 的模型在输入
  模态计数里受影响、在输出上限计数里不受影响。宿主未把「内置目录描述了哪些模型」
  交给设置客户端，计数按模型自己的声明统计（纯函数保留 `catalogIds` 入参）。

## 测试与产物验证

- `node --test 'test/**/*.test.mjs'`：**483 项**，477 通过、6 项按既有条件跳过、0 失败；
  新增 14 项 `test/projection/route-edit.test.mjs` 纯逻辑测试与 14 项
  `test/client/route-edit.test.mjs` 真实 DOM 测试（light / dark 各 7 项）。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为
  `f5655fea83b8a303223e387091b8c3b50a28db374a081301b00e170d716804a8`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
