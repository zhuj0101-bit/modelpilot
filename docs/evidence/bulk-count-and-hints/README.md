# 数值口径错误与提示不可达 — 视觉证据（工单 #35）

- 基线：`09c7f18`（`origin/main`，`fix: 可达性残留、失效标注与列表性能（工单 #34） (#75)`）。工单正文写的基线是 `1e53d7c`；此后 `origin/main` 又合入了与本工单无关的 #74、#75，本目录的「基线」截图取自本 PR 真正要合入的 `09c7f18`，并用 `1e53d7c` / `3fc4b6b` / `09c7f18` 分别重复跑过同一组新测试确认同样为红。
- 变更：本分支 `agent/bulk-count-and-hints-f9fd538bfd8b` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集。
- 环境：headless Chrome 152.0.7977.64，单页视口 1440×1400，设备像素比 1；并排对照页 1960×740（左右各 960px 宽）。
- 场景：Workbench 工作台，路由 `preview-chat`，`baseURL` 是 `https://preview.invalid/v1` 占位地址；数据不含真实凭据或私人内容。
  - 两个页面只有 `lib/client.js` 不同：基线链接 `09c7f18` 的打包产物，变更链接本分支的 `lib/client.js`；provider、模型数据、视口、主题与宿主 token 完全一致。
  - 截图由打包产物在真实 DOM 中渲染，不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/layout-harness.mjs` 的夹具提供（与既有视觉证据一致）。

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-bulk-count-light.png` / `compare-bulk-count-dark.png` | 三条模型里两条已是 `maxTokens 8192`、一条是 `4096`；全选后批量设 8192。基线（左）提示「已批量更新 3 条模型」，把没改的两条也算进去；变更后（右）提示「已批量更新 1 条模型（3 条中 2 条已是目标值）」 |
| `compare-budget-exhausted-light.png` / `compare-budget-exhausted-dark.png` | 新增模型表单里填窗口 8192、输出上限 4096。基线（左）显示「可用上下文 -61,440（比最优少 1037.6%）」；变更后（右）不再显示负数，改为「这个上下文窗口小于 64K 缓冲，任何输出都会立刻触发压缩。建议提高 contextWindow。」 |
| `compare-budget-zero-loss-light.png` / `compare-budget-zero-loss-dark.png` | 窗口 131072、输出上限 32768。基线（左）只有「可用上下文 32,768（比最优少 68.7%）」且没有任何建议（`freeBoundary = -39321`，「建议 ≤ …」那一行根本不会渲染）；变更后（右）补上「这个上下文窗口即使不设输出上限也无法做到零损失；建议提高 contextWindow。」 |
| `compare-toast-timeout-light.png` / `compare-toast-timeout-dark.png` | 点击「存为默认模板」触发成功提示，等 7 秒。基线（左）「已保存为默认模板」仍永久挂在底部；变更后（右）提示已在 6 秒后淡出并清空 |

## 整页状态

| 文件 | 说明 |
| --- | --- |
| `before-bulk-count-light.png` / `before-bulk-count-dark.png` | 基线：选 3 条、提示 3 条（真实只改 1 条） |
| `after-bulk-count-light.png` / `after-bulk-count-dark.png` | 变更后：同一操作提示 1 条，并点明 2 条已是目标值 |
| `before-budget-exhausted-light.png` / `before-budget-exhausted-dark.png` | 基线：负数「可用上下文」与超过 100% 的损失 |
| `after-budget-exhausted-light.png` / `after-budget-exhausted-dark.png` | 变更后：换成说明文案，不再有数字 |
| `before-budget-zero-loss-light.png` / `before-budget-zero-loss-dark.png` | 基线：131K 窗口只有损失百分比 |
| `after-budget-zero-loss-light.png` / `after-budget-zero-loss-dark.png` | 变更后：补充「无法做到零损失」的说明 |
| `before-toast-timeout-light.png` / `before-toast-timeout-dark.png` | 基线：7 秒后提示仍在 |
| `after-toast-timeout-light.png` / `after-toast-timeout-dark.png` | 变更后：7 秒后提示已消失 |

## 计算 / 结构对比（同一夹具与场景）

| 维度 | 基线 `09c7f18` | 变更后 |
| --- | --- | --- |
| 批量改字段的 `plan.changed` | 所有选中下标都进 `changed`，只把「整批无变化」单独判断 | 只收 `canonicalJson` 真正变化的行，保持下标升序、带 `index` / `id`；一条都没变才是 `no-change` |
| 批量改字段提示 | `已批量更新 ${changed.length} 条模型`（实际是选中数） | `已批量更新 N 条模型`；部分变化时补 `（M 条中 M−N 条已是目标值）` |
| 预算估算 | `threshold` 可为负数，`loss` 可达 10.376 | `threshold = max(0, …)`；`loss` 上限 1；新增 `exhausted`（`budget − 65536 <= 0`） |
| 小窗口提示 | `可用上下文 -61,440（比最优少 1037.6%）` | 不显示「可用上下文」数字，改写「这个上下文窗口小于 64K 缓冲…」 |
| `freeBoundary <= 0` | 不渲染任何建议 | 显示「即使不设输出上限也无法做到零损失；建议提高 contextWindow」 |
| 提示容器的读屏语义 | 提示是条件插入的 `<div>`，无 `role` / `aria-live` | 常驻 live region：`role="status"` + `aria-live="polite"` + `aria-atomic="true"`；`tone="bad"` 时 `role="alert"` + `aria-live="assertive"` |
| 提示生命周期 | 无 `setTimeout`，只能被下一次操作清掉 | 成功提示 6 秒后淡出 300 毫秒（`opacity` transition）再清空；报错不自动消失；焦点在提示内时暂停计时；卸载时清 timer |
| 键盘 / 读屏用户读取提示 | 无法主动停留 | 提示可见时 `tabIndex=0`，可用 Tab 聚焦后暂停自动消失 |

## 测试与产物验证

- `node --test "test/**/*.test.mjs"`：**862 项，855 通过、7 项按既有条件跳过、0 失败**。
  - 新增 **42 项**：`test/core/toast.test.mjs` 6 项、`model-bulk.test.mjs` +5、`context-budget.test.mjs` +5；`test/client/bulk-fields-count.test.mjs` 6 项（light / dark 各 3）、`budget-hint-clamp.test.mjs` 8 项、`toast-live-region.test.mjs` 12 项。
  - 新增测试先在基线上确认为红：把同一批测试放进 `1e53d7c`、`3fc4b6b` 与 `09c7f18` 的打包产物里运行，**29 项失败、10 项通过**；通过的 10 项是「1M 窗口仍是零损失」「一次 set 整数组」这类不应改变的回归护栏。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `97c1330730c309903854c962c907e705edf97bb3ac1cddaeee2a386873d83676`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改。

## 说明

- 纯逻辑在 `src/core/`：`model-bulk.js` 的 `changed` 收集与 `bulkFieldsNotice`、`context-budget.js` 的 `exhausted` / 截断，以及新增的 `toast.js`（驻留时长、淡出时长、读屏角色、焦点暂停规则）。组件只接定时器、样式与 DOM 属性。
- 提示容器常驻 DOM 而不是随提示插入，是为了让读屏在文字变化时播报；空闲态是视觉隐藏的 1×1 区域，不占版面。
- 基线截图中的 `-61,440 / 1037.6%` 与工单正文一致（窗口 8192、输出上限 4096）；工单正文里 `estimateContextBudget(8192, 2048)` 的同组数字对应的是 `-59,392 / 1008.3%`，同样属于负数 + 超过 100% 的问题，测试里用的是工单验收写明的 2048。
