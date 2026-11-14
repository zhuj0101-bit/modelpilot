# 工作台视觉重做 — 视觉证据（工单 #35 / 工单 17）

- 基线：`59b08d5`（`origin/main`，`feat: 讲清路由默认值与模型声明的关系（三级回落 + 按字段计数） (#36)`；工作台视觉重做的父提交）
- 变更：本分支 `agent/visual-redesign-tokens-d3e7d5149df3` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，1440×1700 视口，设备像素比 1；用 `test/client/layout-harness.mjs` 的最小 React 兼容渲染器 + `test/client/visual-harness.mjs` 的宿主 token 夹具渲染打包产物
- 场景：Workbench 工作台，路由 `preview-chat`，三条模型（`jxf/dsv4.1-flash` / `jxf/dsv4.1-pro` / `tx/deepseek-v4.1-flash`）；新模型表单为空（默认档位 `off/low/medium/high`，`text` 模态）
- 两个页面只有 `lib/client.js` 不同：基线链接 `59b08d5` 的打包产物，变更链接本分支的 `lib/client.js`；provider、baseURL、模型数据、视口、主题和 token 完全一致
- 数据不包含真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：基线（左）vs 变更后（右），整页三区块 |
| `compare-dark.png` | 深色主题：基线（左）vs 变更后（右），整页三区块 |

## 整页与状态

| 文件 | 说明 |
| --- | --- |
| `before-light-default.png` / `before-dark-default.png` | 基线：路由行、路由设置、模型列表、新增表单四个平级块；圆角/字号/间距不统一；主操作与三个次要按钮同排 |
| `after-light-default.png` / `after-dark-default.png` | 变更后：当前路由 / 模型 / 新增模型三个 `settings-card` 区块；页面标题、区块标题、字段标签、正文、提示五级字号 |
| `after-light-hover.png` / `after-dark-hover.png` | 变更后：模型行 hover 使用 `--dsw-alias-interactive-bg-hover`，`120ms ease` 过渡；基线没有行 hover 反馈 |
| `after-light-chips.png` / `after-dark-chips.png` | 变更后：推理档位 7 个 chip 单行排列（`flex-wrap: nowrap` + `overflow-x: auto`），选中态使用 `button-ghost-active-fill/border`；本图额外勾选 `xhigh` / `max` 以展示选中态 |
| `after-light-expanded.png` / `after-dark-expanded.png` | 变更后：展开「当前路由」区块内的路由设置（九个字段）；路由设置沿用同一卡片底色，只保留分隔线 |

## 计算样式 / 结构对比（同一夹具与场景）

| 维度 | 基线 `59b08d5` | 变更后 |
| --- | --- | --- |
| 区块 | 路由行 / 路由设置 / 模型列表 / 表单四个平级块 | 当前路由 / 模型 / 新增模型三个卡片 |
| 卡片底色 | 模型面板与路由卡片 `--dsw-alias-bg-layer-1`；表单无卡片 | 三个区块 `--dsw-alias-settings-card-fill` |
| 卡片边框 | `--dsw-alias-border-l2` | `--dsw-alias-settings-card-stroke` |
| 圆角 | `5` `6` `7` `8` `10`（另有 `12` / `999`） | `RADIUS.sm 6` / `md 10` / `lg 14` 三档 |
| 字号 | `10` `11` `12` `13` `16` 五种，散落使用 | `FONT` 六级 token：提示 11 / 摘要 12 / 正文 13 / 标签 12 / 区块 14 / 页面 16 |
| 间距 | `gap: 4` `6` `8` `10` 混用 | `GAP.xs 4` / `sm 8` / `md 14` / `lg 22` 四档 |
| 模型行 hover | 无 | `--dsw-alias-interactive-bg-hover`，`transition: background-color 120ms ease` |
| 编辑按钮 | 行头 `space-between`，贴行右边界 | 摘要行内右侧，距行右边界 4px |
| 推理档位 | `flex-wrap: wrap`，窄容器折行 | `nowrap` + `overflow-x: auto`，窄容器横向滚动 |
| 原生 select | 浏览器默认外观 | 四个 select 统一 `appearance: none` + `currentColor` 自绘箭头，高度 29px |
| 主操作 | 与三个次要按钮同排、同尺寸 | 「写入 DSH 设置」独占右对齐一行；「清空」「存为默认模板」为文字链接 |

## 与工单验收的已知偏差

1. **select 高度保持 29px，而不是判据 11 的 32px。** 既有 `test/client/theme.test.mjs` 在工单 #20 中钉住 `select` 高度 29px，`test/client/layout.test.mjs` 钉住路由 / 模型 ID / 显示名顶边对齐；判据 15 要求既有 281 项测试一项不改。四个 select 现在统一 `appearance: none`、自绘箭头、同一盒高 29px，与输入框对齐。
2. **模型 ID / 显示名仍在第一行（与「当前路由」同一卡片）。** 既有布局/主题测试要求路由、模型 ID、显示名三个输入框在同一行且顶边对齐，因此没有把它们单独移进「新增模型」卡片；三区块结构、卡片语言与其余层级仍按工单实现。
3. **「填入默认模板」保持小号 secondary 按钮，而不是文字链接。** 既有 `test/client/template-fill.test.mjs` 钉住它的 `--dsw-alias-interactive-bg-hover` / `--dsw-alias-border-l2` 内联 token 与 disabled 态；「清空」「存为默认模板」已降级为文字链接。
4. **hover 用 React 状态表达。** 内联样式对象无法写 `:hover`，因此模型行用 `hoveredRow` 这一纯展示状态切换背景；不参与投影、写入或任何业务状态。
5. **选择器弹窗打开时收起 token 候选面板。** 三区块重构改变了组件路径，基线里由重挂载自然产生的「fetch 完成 / 打开选择器后候选面板收起」不再出现；用 `closeSignal` 显式恢复这一纯 UI 行为，避免浮层与弹窗并存，不影响表单值与写入。
6. **对比度。** `label-tertiary` 摘要行在视觉夹具的 light / dark token 下分别为 5.26 / 7.97；所有可见文字 ≥ 4.5（测试断言）。宿主主题若给出更浅的 tertiary，最终对比度由宿主 token 决定。

## 测试与产物验证

- `node --test 'test/**/*.test.mjs'`：**325 项**，319 通过、6 项按既有条件跳过、0 失败；新增 `test/client/visual-redesign.test.mjs` 27 项（静态结构 + light/dark 真实计算样式）。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `6d57bc53aafd2260dba8d8299728594ae294fe4c7990a2612c925c873b73464e`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。

## 说明

- 截图由打包产物在真实 DOM 中渲染；它们不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/visual-harness.mjs` 的夹具提供（与 `theme.test.mjs` 的做法一致）。
- 截图中的「协议清单读取失败，使用内置列表」是因为夹具不提供宿主 schema；真实 DSH 中该提示只在 schema 读取失败时出现，与本工单无关。
- 交互与截图使用真实 DOM 事件（输入、点击、`mouseenter`），不是静态拼图。
