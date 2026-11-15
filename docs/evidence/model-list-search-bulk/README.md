# 模型列表搜索与批量操作 — 视觉证据（工单 #25）

- 基线：`dfff012`（`origin/main`，`feat: 全部路由总览与批量密钥状态（工单 #24） (#51)`）
- 变更：本分支 `agent/model-list-search-bulk-402280007749` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，截图视口 1440×1050，设备像素比 1；并排对照页 2000×790
- 场景：Workbench 工作台，路由 `preview-chat`，8 条模型（`jxf/dsv4.1-flash` / `jxf/dsv4.1-pro` / `jxf/dsv4.1-mini` / `tx/deepseek-v4.1-flash` / `tx/deepseek-v4.1-pro` / `qwen/complete` / `openai/gpt-case` / `anthropic/claude-x`）；路由设置折叠，新增模型表单为默认值
- 两个页面只有 `lib/client.js` 不同：基线链接 `dfff012` 的打包产物，变更链接本分支的 `lib/client.js`；provider、模型数据、视口、主题和 token 完全一致
- 数据不包含真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：基线（左）vs 变更后（右），同一屏 |
| `compare-dark.png` | 深色主题：基线（左）vs 变更后（右），同一屏 |

## 整页与状态

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线：模型列表只能逐行滚动，没有搜索、复选框或批量操作 |
| `after-light.png` / `after-dark.png` | 变更后：标题行右侧出现搜索框；每行左侧复选框与拖动手柄并存；列表上方是「全选 / 已选 N 条 / 批量改字段 / 批量删除 / 取消选择」 |
| `after-light-filter.png` / `after-dark-filter.png` | 变更后：搜索 `jxf`，列表只显示 3 条，勾选其中 2 条；底部显示「显示 3 / 8 条」+「清空搜索」；筛选状态下拖动手柄灰显禁用 |
| `after-light-bulk.png` / `after-dark-bulk.png` | 变更后：批量改字段面板；勾选「输出上限」并填入 8192，未勾选的输入模态 / 推理档位保持灰显，底部提示「将写入 2 条模型；应用后清空选择」 |

## 计算样式 / 结构对比（同一夹具与场景）

| 维度 | 基线 `dfff012` | 变更后 |
| --- | --- | --- |
| 模型卡片标题行 | 只有标题与「+ 新增」 | 标题 + 搜索框（占位符 `搜索模型 ID…`）+「+ 新增」同一行 |
| 搜索框 | 无 | `background: var(--dsw-alias-bg-layer-1)` / `color: var(--dsw-alias-label-primary)` / `color-scheme: inherit` |
| 搜索框文字对比度 | — | 浅色 **16.38:1**，深色 **13.03:1**（均 ≥ 4.5） |
| 每行行首 | `⠿` 手柄 + 序号 + 模型 ID | 复选框（13px）+ `⠿` 手柄 + 序号 + 模型 ID |
| 复选框 | 无 | 原生 checkbox，`color-scheme: inherit`，浅色 / 深色都跟随宿主 |
| 行高 | 首行 52px，其后 61px | 首行 52px，其后 61px（完全一致，复选框没有撑高行） |
| 筛选状态 | — | 只筛显示，`models` 数组顺序不变；拖动 / 键盘排序禁用并说明原因 |
| 批量操作 | 逐条「编辑 → 删除」 | 一次 `mutate`、一条 `op:"set"` 重写整个 `models` 数组 |
| 搜索底部 | 无 | 有搜索词时显示「显示 X / Y 条」+「清空搜索」 |

行高由同一夹具在 `getBoundingClientRect()` 下读回；新增的复选框与搜索框没有改变工单 #19 定下的行动排版。

## 测试与产物验证

- `node --test 'test/**/*.test.mjs'`：**612 项**，606 通过、6 项按既有条件跳过、0 失败。
  - 基线 `dfff012` 实测 **566 项**（560 通过 + 6 条件跳过），与工单 #25 的「现有 566 项」一致。
- 新增 **46 项**：
  - `test/core/model-bulk.test.mjs` 18 项（纯函数：id 序列复核、批量删除、批量改字段、拒绝全删 / 非法值 / 只勾 off、不改入参）；
  - `test/client/model-list-search-bulk.test.mjs` 28 项（light / dark 各 14 项真实 DOM：搜索框与 token / 对比度、行高、输入即筛、筛选禁用拖动、全选只作用于筛选结果、切换路由清空、批量删除 / 改字段各一次 mutate + 一条 set、不能全删、写入中禁用、写前复核）。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `4d435f43074f324b0c1cbb5ee940779fd8ad70028337c4242d1bb31b88b970e7`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改；未修改任何既有测试。

## 说明

- 截图由打包产物在真实 DOM 中渲染；它们不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/layout-harness.mjs` 的夹具提供（与 `theme.test.mjs` 的做法一致）。
- 搜索框直接复用 `src/core/model-selection.js` 的 `filterModels`，没有在界面里重写大小写规则。
- 批量写入的纯规则在 `src/core/model-bulk.js`：只产出「一条 set 整数组」；批量改字段只覆盖 `maxTokens` / `input` / `reasoningEfforts`，其余字段（`id` / `name` / `compat` / `contextWindow` / 宿主未来字段）原样保留。
- 写前复核比较的是 **id 序列**（长度 + 顺序 + 每个 id），不是长度；列表变化时提示「批量操作未执行」并清空选择，不写任何东西。
- 筛选状态下拖动手柄禁用：拖动按绝对下标写盘，筛选后可见行与下标对不上。
