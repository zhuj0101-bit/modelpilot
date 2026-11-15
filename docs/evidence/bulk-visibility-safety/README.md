# 批量操作可见性与安全边界 — 视觉证据（工单 #33）

- 基线：`1e53d7c`（`origin/main`，`fix: 分组视图跨组拖动拦截与紧凑摘要可达性（工单 #32） (#67)`）
- 变更：本分支 `agent/batch-visibility-safety-e8e9e9a4cf69` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，单页视口 1440×980，设备像素比 1；并排对照页 1928×720（左右各 960px）
- 场景：Workbench 工作台，路由 `preview-chat`，8 条模型，三个前缀组 `acme`（3）/ `jxf`（3）/ `tx`（2），详细密度，路由设置折叠
  - 两个页面只有 `lib/client.js` 不同：基线链接 `1e53d7c` 的打包产物，变更链接本分支的 `lib/client.js`；provider、模型数据、视口、主题和宿主 token 完全一致
  - 操作序列：勾选 `acme` 组 3 条 → 折叠 `acme` 组 → 点击「批量删除」
  - 数据不含真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` / `compare-dark.png` | 折叠 `acme` 后的选择态：基线（左）批量栏仍只写「已选 3 条」，行全部隐藏且没有任何提示；变更后（右）批量栏写明「其中 3 条未显示（折叠分组或搜索过滤）」，并提供「取消这些选择」 |
| `compare-delete-light.png` / `compare-delete-dark.png` | 同一场景点击「批量删除」：基线（左）一次点击直接删掉 3 条并提示「已删除 3 条模型」；变更后（右）先弹出二次确认，点名 3 个 id、写明「其中 3 条位于折叠或未显示的行，当前不可见」与「此操作无法撤销」 |

## 整页状态

| 文件 | 说明 |
| --- | --- |
| `before-light-collapsed.png` / `before-dark-collapsed.png` | 基线：3 条已选被折叠隐藏，批量栏只有「已选 3 条」，无从得知将被删除的隐藏条目 |
| `after-light-collapsed.png` / `after-dark-collapsed.png` | 变更后：同一选择态，批量栏显示隐藏条数与「取消这些选择」 |
| `before-light-deleted.png` / `before-dark-deleted.png` | 基线：点击「批量删除」无确认，3 条被删，列表剩 5 条，绿色 toast |
| `after-light-confirm.png` / `after-dark-confirm.png` | 变更后：点击「批量删除」弹出自绘确认框（Esc / Tab 复用既有 ConfirmDialog）；取消不写盘，确认后才一次 `mutate` |

## 计算 / 结构对比（同一夹具与场景）

| 维度 | 基线 `1e53d7c` | 变更后 |
| --- | --- | --- |
| 折叠后隐藏选中提示 | 无，只有「已选 3 条」 | 「其中 3 条未显示（折叠分组或搜索过滤）」+「取消这些选择」 |
| 取消隐藏选择 | 只能「取消选择」清空全部 | 可只清除不可见条目，保留可见选择 |
| 批量删除确认 | 无，一次点击直接写盘 | `BulkDeleteConfirmDialog`：`ariaLabel="批量删除模型确认"`、`badge="二次确认"`、标题「删除 N 条模型」、正文前 5 个 id + 「……另有 N−5 条」、隐藏条目行、「此操作无法撤销」 |
| 全选复选框 | 无半选状态；3/8 与 0/8 外观相同 | 3/8 时 `indeterminate = true`；`aria-label` 三态：`已全选 N 条` / `已选 N / M 条` / `全选`；点半选 → 勾满 |
| 组头计数（搜索中） | 始终显示总数，`(3)` | 显示命中数/总数，`(1/3)`、`(0/3)`；`aria-label` 与可见文本一致 |
| 折叠 / 搜索 / 选择 / 半选 | 不写配置 | 不写配置（DOM 测试 `mutations === 0`） |

## 测试与产物验证

- `node --test "test/**/*.test.mjs"`：**815 项**，808 通过、7 项按既有条件跳过、0 失败。
  - 本工作副本首次跑基线时为 785 项；其中 `test/shared/version-caps.test.mjs` 因缺少 `@deepseek-ai/dsh-llm` 链接整体失败。补齐宿主模块链接后该文件 6 项全部通过，折算基线为 **790 项**（与工单 #33 的基线一致）；本分支新增 **25 项**。
- 新增 **25 项**：
  - `test/core/model-bulk.test.mjs` +5：`summarizeBulkSelection` 的 id 顺序、隐藏计数、缺失 id 回落、非法下标、不改入参；
  - `test/core/model-list-view.test.mjs` +2：`groupCountText` 与 `selectAllCheckboxState`；
  - `test/client/bulk-visibility.test.mjs` 6 项（light / dark 各 3）：半选 / 勾满 / 清空三态、折叠隐藏选择、搜索隐藏选择、折叠 / 搜索全程 `mutations === 0`、搜索组头命中计数；
  - `test/client/bulk-delete-confirm.test.mjs` 12 项（light / dark 各 6）：确认框出现不写盘、取消、确认后一次 `mutate` + 一条 set、隐藏条目点名、超过 5 条的截断、Esc / Tab / Shift+Tab、全选禁用、取消选择 / 切路由关闭。
- 既有浏览器夹具只做了机械读取更新：全选复选框的稳定定位改为 `data-modelpilot-select-all`，批量删除流程补上「打开确认框 → 确认」两步；断言语义未改变。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `7a6fd6b181e93cb51a8af308e512e6cb9bcc946ec126e3206346b24cc4a56820`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改。

## 说明

- 截图由打包产物在真实 DOM 中渲染；它们不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/layout-harness.mjs` 的夹具提供（与既有视觉证据一致）。
- 问题一采用方案 C：折叠不改变选择集合，批量栏点名「未显示」条数并提供「取消这些选择」；隐藏定义同时覆盖折叠分组与搜索过滤。
- 批量删除确认框复用既有 `ConfirmDialog`，Esc / Tab 焦点循环没有重复实现；写盘成功后关闭，取消选择 / 切换路由也会关闭。
- 全选的半选状态在 effect 里写入 `input.indeterminate`，每次渲染后都同步一次，避免 React 复用 DOM 节点时残留旧状态。
