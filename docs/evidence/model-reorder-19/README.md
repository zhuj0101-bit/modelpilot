# 模型拖动排序 — 视觉证据（工单 #19）

- 基线：`b8b07a9`（`origin/main`，`feat: 工作台视觉重做：设计变量与三区块 (#35) (#37)`）
- 变更：本分支 `agent/model-reorder-26a95896cd50` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，1440×1050 视口，设备像素比 1；用 `test/client/layout-harness.mjs` 的最小 React 兼容渲染器 + 宿主 token 夹具渲染打包产物
- 场景：Workbench 工作台，路由 `preview-chat`，四条模型（`jxf/dsv4.1-flash` / `jxf/dsv4.1-pro` / `tx/deepseek-v4.1-flash` / `qwen/complete`）；路由设置折叠，新增模型表单为空
- 两个页面只有 `lib/client.js` 不同：基线链接 `b8b07a9` 的打包产物，变更链接本分支的 `lib/client.js`；provider、模型数据、视口、主题和 token 完全一致
- 数据不包含真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：基线（左）vs 变更后（右），同一屏 |
| `compare-dark.png` | 深色主题：基线（左）vs 变更后（右），同一屏 |

## 整页与拖动状态

| 文件 | 说明 |
| --- | --- |
| `before-light-list.png` / `before-dark-list.png` | 基线：模型行只有名称与摘要，无法调整顺序 |
| `after-light-list.png` / `after-dark-list.png` | 变更后：每行左侧 `⠿` 手柄 + 只读序号，行高与基线一致 |
| `after-light-drag.png` / `after-dark-drag.png` | 变更后：从手柄开始拖动第一条，指针停在第三条下半区；被拖行半透明，第三条下方显示 2px 品牌色插入线 |

## 计算样式 / 结构对比（同一夹具与场景）

| 维度 | 基线 `b8b07a9` | 变更后 |
| --- | --- | --- |
| 行首 | 只有模型 ID | `⠿` 手柄（`aria-label="拖动排序 第 N 位"`）+ 只读序号 `1…4` |
| 行高 | 首行 52px，其后 61px | 首行 52px，其后 61px（完全一致） |
| 模型面板高度 | 300px | 300px（完全一致） |
| 页面内容高度 | 930.94px | 930.94px（完全一致） |
| 排序交互 | 无 | 手柄可拖动；聚焦后 ↑ / ↓ / Home / End 移动，松手 / 按键立即写盘 |
| 插入线 | 无 | `position:absolute; height:2px; background:var(--dsw-alias-brand-primary,…)`，不占布局高度 |
| 被拖行 | 无 | `opacity:0.45` |

行高 / 面板高度 / 页面高度由同一夹具在 `getBoundingClientRect()` 下读回；新增手柄与序号没有改变工单 17 定下的行布局。

## 测试与产物验证

- `node --test 'test/**/*.test.mjs'`：**350 项**，344 通过、6 项按既有条件跳过、0 失败。
- 新增 **31 项**：
  - `test/projection/model-reorder.test.mjs` 9 项（纯函数：移动、不可变、no-change / stale-index / invalid-models、整数组 op、逐字节不变、compat / 未来字段跟随）；
  - `test/client/model-reorder.test.mjs` 22 项（light / dark 各 11 项真实 DOM：手柄与序号、拖动半透明 + 插入线、松手一次 mutate、compat 保留、Esc 取消、↑/↓、Home/End、失败回滚、重排后收起旧下标的编辑表单、单模型禁用）。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `4992727305d85a49321f0d9472b29050549dfe90a9009d40c8ee614800181dba`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改；未修改任何既有测试（仅给最小渲染器补了 `onDragStart` / `onDragOver` / `onDrop` / `onDragEnd` 等事件映射）。

## 说明

- 截图由打包产物在真实 DOM 中渲染；它们不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/layout-harness.mjs` 的夹具提供（与 `theme.test.mjs` 的做法一致）。
- 拖动交互测试派发的是真实 `DragEvent`（`DataTransfer` + `dragstart` / `dragover` / `drop`），不是直接调用组件内部函数；键盘测试派发真实 `KeyboardEvent`。
- `moveModel(models, from, to, routeId)` 的 `routeId` 是第 4 个参数：整数组 op 的路径必须带当前路由 id，而函数本身无从得知它；前三个参数保持工单 3.3 的语义。省略 `routeId` 时只返回重排后的新数组、不产出 op。
