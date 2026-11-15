# 模型行直接删除与编辑折叠 — 视觉证据（工单 #28）

- 基线：`4ab7a3e`（`origin/main`，`feat: 模型行摘要标注值来源（工单 #27） (#57)`），打包产物 `lib/client.js` SHA-256 `e3d79a9c3ba3e3769c2795d72489a5f8c68bac5d681f2b77e7d8e4422486a5bd`
- 变更：本分支功能提交 `5f4990c`，截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集，SHA-256 `71be2352230b215e6681060c21e52e0a4016cdb8c28e1fdea5665515e237d79f`（连续两次构建同值）
- 环境：Chrome 152.0.7977.64 headless，设备像素比 1；列表 / 弹窗视口 1440×1100，展开编辑视口 1440×1500；宿主 `--dsw-*` token 由仓库既有的 light / dark token 夹具提供，`color-scheme` 分别为 `light` / `dark`
- 场景：一条占位路由 `preview-chat`，`baseURL` 为 `https://preview.invalid/v1`，三个模型：
  - `jxf/dsv4.1-flash`：`contextWindow: 1000000`、`maxTokens: 32768`、`input: ["text"]`、4 个推理档位；
  - `jxf/dsv4.1-pro`：字段与上一条相同，另带非空 `compat`；
  - `tx/deepseek-v4.1-flash`：`contextWindow: 128000`、`maxTokens: 8192`、`input: ["text"]`、`reasoningEfforts: false`
- 数据：没有真实凭据或私人内容；`baseURL` 是 `*.invalid` 占位地址

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `4ab7a3e` 的产物，after 为本分支产物），由与单测共用的最小 React 兼容渲染器渲染真实的 `Workbench` 组件树；路由数据、宿主 token、命名空间 schema、`configForms` 快照与 `credentials` 夹具完全一致，before / after 两份页面只有 `lib/client.js` 不同。`test/client/inline-model-delete-harness.mjs` 的夹具与本组截图同源。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；截图没有展开原生 `title` 悬停提示，DOM 测试逐字读回它的内容（见下）。

## Before / After

### 模型列表（未展开）

| 文件 | 说明 |
| --- | --- |
| `before-light-list.png` / `before-dark-list.png` | 基线 `4ab7a3e`：每行右侧只有「编辑」 |
| `after-light-list.png` / `after-dark-list.png` | 变更后：每行右侧是「编辑」「删除」并列；点「删除」直接打开确认弹窗，不需要先展开编辑 |

### 展开编辑（未改动）

| 文件 | 说明 |
| --- | --- |
| `before-light-expanded.png` / `before-dark-expanded.png` | 基线 `4ab7a3e`：展开后顶部没有标题行；要退出只能滚到底部点「取消」 |
| `after-light-expanded.png` / `after-dark-expanded.png` | 变更后：表单顶部右侧出现「编辑 jxf/dsv4.1-flash」与「× 收起」；未改动时收起可用，点一下直接回到列表；底部的「取消」仍在 |

### 删除确认弹窗

| 文件 | 说明 |
| --- | --- |
| `before-light-dialog.png` / `before-dark-dialog.png` | 基线 `4ab7a3e`：先展开编辑，再点表单底部的「删除」；弹窗标题是「删除模型」 |
| `after-light-dialog.png` / `after-dark-dialog.png` | 变更后：直接点行内「删除」；同一个 `ModelDeleteDialog`（`aria-label="删除模型确认"`），标题带模型 id「删除模型 jxf/dsv4.1-pro」，正文与按钮不变 |

## 验收判据对照

| 判据 | 证据 |
| --- | --- |
| 1 每行未展开状态右侧有「删除」，与「编辑」并列 | `after-*-list.png`；真实 DOM 测试逐行断言两个按钮同父容器、编辑在删除之前 |
| 2 点「删除」弹出同一个 `ModelDeleteDialog`，标题带模型 id | `after-*-dialog.png`；测试断言 `aria-label="删除模型确认"` 与标题首行 `删除模型 jxf/dsv4.1-pro`，且不展开编辑 |
| 3 确认后产出 1 条 `set`，path 为 `["providers", routeId, "models"]` | 真实 DOM 测试读回 `mutate` 参数：`op: "set"`、该 path、数组长度减一、没有 `unset` |
| 4 取消不发任何请求 | 测试断言取消后弹窗关闭、`mutate` 调用数仍为 0 |
| 5 只读模式（`writable === false`）按钮禁用 | 测试用 `writable: false` 页面断言每行删除按钮 `disabled === true`，点击不弹窗、不写配置 |
| 6 该行正在编辑时行内删除仍可用 | 测试先展开编辑，再点行内删除：弹窗打开且编辑表单仍在；确认后编辑随该行一起收起 |
| 7 只剩 1 个模型时删除仍允许，沿用原有守卫 | 测试删到 1 条后继续点行内删除并确认：仍产出 1 条空数组 `set`；没有新增本地判断 |
| 8 编辑表单顶部右侧有「收起」按钮 | `after-*-expanded.png`；测试断言按钮是编辑表单首行的最后一个子元素 |
| 9 没有改动时点「收起」立即收起、不弹确认 | 测试断言收起后编辑表单消失、没有 `删除模型确认` 弹窗、`mutate` 不变 |
| 10 有改动时按钮禁用 + 指定 `title` | 测试改 `maxTokens` 后断言 `disabled === true`，且 `title === "有未保存的改动，请先保存或点取消"` |
| 11 底部「取消」保持不变 | `after-*-expanded.png`；测试断言 `取消编辑` 仍存在且可用 |
| 12 顶部收起与底部取消行为一致：丢弃草稿、收起表单 | 测试断言底部取消关闭表单、不写配置；改回原值后顶部收起重新可用并立即关闭 |
| 13 现有 687 项测试全部通过 | 完整套件：701 tests，695 pass，6 skipped，0 fail（基线 687 = 681 pass + 6 skipped），新增 14 项真实 DOM |

## 测试与产物验证

```text
$ node --test 'test/**/*.test.mjs'
ℹ tests 701
ℹ pass 695
ℹ fail 0
ℹ skipped 6

$ node scripts/build-client.mjs   # 连续两次
71be2352230b215e6681060c21e52e0a4016cdb8c28e1fdea5665515e237d79f
71be2352230b215e6681060c21e52e0a4016cdb8c28e1fdea5665515e237d79f

$ node scripts/verify-package.mjs .
PASS 1 … PASS 18
```

新增测试：

- `test/client/inline-model-delete.test.mjs`：14 项真实 DOM（light / dark 各 7 项：按钮列、弹窗标题与取消、确认写入、收起两态、编辑中删除、最后一条删除、只读禁用）；
- `test/client/inline-model-delete-harness.mjs`：上述测试共用的浏览器夹具。

既有的 `test/client/visual-redesign.test.mjs` 里「编辑按钮内缩 ≤ 16px」改为测量行内最右侧操作按钮（现在是「删除」）；约束仍是操作组紧贴行右缘 ≤ 16px，没有放宽。

## 本批没有做

- 没有新增第二套确认弹窗：行内删除和编辑表单里的删除都走同一个 `DeleteConfirmDialog`；
- 没有改删除的实际写入路径：行内入口只设置 `deleteTarget`，确认后仍由原有 `confirmDelete` / `projectPiAi(remove)` 产出整数组 `set`；
- 没有在行内删除时自动展开编辑；
- 没有删掉底部的「取消」，也没有把「收起」做成任何时候都能点；
- 没有给「只剩 1 个模型」加本地拦截：是否允许空 `models` 仍由宿主原有的写入守卫决定。
