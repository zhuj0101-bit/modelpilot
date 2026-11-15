# 长模型列表：分组折叠 + 摘要去重 + 密度切换 — 视觉证据（工单 #31）

- 基线：`4ab7a3e`（`origin/main`，`feat: 模型行摘要标注值来源（工单 #27） (#57)`）
- 变更：本分支 `agent/model-list-grouping-e72dbb928de4` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，整页截图视口 1440×2200，设备像素比 1；并排对照页 2200×1114
- 场景：Workbench 工作台，路由 `preview-chat`，22 条模型，四个前缀组 `deepseek`（3）/ `jxf`（12）/ `tx`（6）/ `其他`（1，`standalone-model`）
  - `jxf` 组里 `jxf/dsv4-pro-reason` 的上下文窗口是 200K，其余是 131K：组内摘要混合 → 组头不显示摘要，详细模式每行各自显示
  - `deepseek` / `tx` 组内摘要逐字相同 → 摘要提到组头，行内不重复
  - 路由设置折叠，新增模型表单为默认值；数据不含真实凭据，`baseURL` 是 `https://preview.invalid/v1` 占位地址
- 两个页面只有 `lib/client.js` 不同：基线链接 `4ab7a3e` 的打包产物，变更链接本分支的 `lib/client.js`；provider、模型数据、视口、主题和 token 完全一致

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：左＝基线（`4ab7a3e`，22 行详细摘要、无分组），右＝变更后（默认紧凑、四个分组） |
| `compare-dark.png` | 深色主题：同一场景、同一裁剪范围 |

## 整页与状态

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线：22 行逐条显示完整 ID 与摘要，列表高度 1517px，超出 1000px 视口 |
| `after-light.png` / `after-dark.png` | 变更后默认紧凑：`deepseek` / `jxf` / `tx` / `其他` 四个组头；行内只显示短 ID +「编辑 / 删除」，摘要移到短 ID 的 `title` 悬停；列表高度 896px |
| `after-light-detailed.png` / `after-dark-detailed.png` | 切到详细：`deepseek` / `tx` 的摘要提到组头，行内不重复；`jxf` 混合摘要时组头留空，每行各自显示（`jxf/dsv4-pro-reason` 显示 200K） |
| `after-light-search.png` / `after-dark-search.png` | 搜索 `flash`：命中的 `jxf` / `tx` 自动展开，未命中的 `deepseek` / `其他` 收起；底部「显示 3 / 22 条」 |
| `after-light-collapsed.png` / `after-dark-collapsed.png` | 手动折叠 `jxf` / `tx`：行与拖动手柄一起收起，组计数保留；`deepseek` / `其他` 保持展开 |

## 计算尺寸对比（同一夹具、同一场景）

| 维度 | 基线 `4ab7a3e` | 变更后（默认紧凑） | 变更后（详细） |
| --- | --- | --- | --- |
| 模型卡片高度 | **1517px** | **896px**（−41%） | 1518px |
| 页面内容高度 | 2285px | 2113px | 2286px |
| 模型行数 | 22 | 22 | 22 |
| 分组数 | 无 | 4 | 4 |
| 行内摘要 | 每条重复显示 | 移入短 ID 的 `title` 悬停 | 组内共享时提到组头，混合时逐行显示 |
| 密度偏好 `localStorage` | 无 | 未写入（默认 compact） | `modelpilot.model-list-density.v1 = detailed` |

紧凑默认下 22 条模型 + 4 个组头的高度已经小于 1000px 视口；详细模式保留原有逐行摘要信息，但通过组头去重减少重复。

## 测试与产物验证

- `node --test 'test/**/*.test.mjs'`（`npm test`）：**758 项**，751 通过、7 项按既有条件跳过、0 失败。
- 新增 **28 项**：
  - `test/core/model-list-view.test.mjs` 9 项（纯函数：分组键 / 短名 / 组顺序 / 组内绝对下标 / 阅读序号 / 摘要去重 / localStorage 默认、非法值回落、异常存储）；
  - `test/client/model-list-grouping.test.mjs` 19 项（light / dark 真实 DOM：分组顺序与短名、折叠与全选可见行、摘要去重、详细 / 紧凑切换与持久化、搜索自动展开 / 收起、拖动绝对下标写盘、折叠组无手柄、搜索禁用拖动、行内删除确认、非法偏好回落）。
- 既有浏览器夹具按 #31 的新视图语义做了最小调整：
  - 验证行摘要的 #12 / #17 / #27 / #29 夹具在渲染前把密度设为 `detailed`，继续覆盖详细模式；
  - #19 拖动夹具把四条模型放进同一个 `jxf` 组，组内顺序与数组顺序一致，拖动 / 键盘 / 失败回滚断言不变；
  - #25 搜索 / 批量夹具只更新分组后的显示顺序，写盘参数与批量行为断言不变。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `fa463695421309ed012061d9f12979fbba03ed6fbb2417890cd9a13caa35cc3d`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改。

## 说明

- 截图由打包产物在真实 DOM 中渲染；它们不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/layout-harness.mjs` / `visual-harness.mjs` 的夹具提供（与既有截图做法一致）。
- 分组是纯视图：`groupModelRows` 不修改 `models` 数组，组按前缀字母序、「其他」最后，组内保持数组顺序；折叠状态只存在组件状态里，不写配置。
- 行序号按分组后的阅读顺序编号（1…22），写盘仍使用 `models` 数组的绝对下标；拖动落点换算与批量选择也继续使用绝对下标。
- 搜索时命中组自动展开、未命中组收起；搜索结束后恢复全部展开。用户仍可在搜索中手动折叠命中的组。
- 默认紧凑；密度偏好是全局一个 `localStorage` key（`modelpilot.model-list-density.v1`），读不到 / 值非法时回落 compact。
- 组头摘要是不可点击的说明文字；组内摘要任意一行不同，组头就留空，不猜统一值。
