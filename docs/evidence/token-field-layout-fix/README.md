# token 输入候选与提示行布局 — 视觉证据

- 基线：`ec913d3`（`origin/main`，`docs: 调查 reasoningEfforts 档位显示与 pi-ai 路由开关 (#10)`）
- 变更：本分支 `agent/token-field-layout-fix-231f86be4c18` 的 PR 头提交（截图在重建 `lib/client.js` 后采集）
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless，1440×1000 视口，浅色主题
- 场景：设置 → ModelPilot，路由 `preview-chat`，模型 ID 留空；两个 token 字段分别填入
  `131072` / `8192`，再输入 `abc` 触发非法输入。
- 两个预览实例都使用临时 profile 与示例 provider（`preview-model-existing`），不含真实凭据或私人内容。

| 文件 | 状态 |
| --- | --- |
| `before-empty.png` | 基线：token 输入为空，提示行整体不存在，字段高度随内容变化 |
| `after-empty.png` | 变更后：提示行始终保留 16px 占位，空态字段高度与有提示时一致 |
| `before-values.png` | 基线：`131072` / `8192`，输入框为原生 datalist 输入 |
| `after-values.png` | 变更后：同样的值，输入框带自定义下拉箭头，提示 `131K` / `8K` |
| `before-error.png` | 基线：再次输入 `abc`，拒绝写入并回显 `131072`，下方红色「请输入正整数」 |
| `after-error.png` | 变更后：同样拒绝 `abc` 并回显 `131072`，错误行不改变输入框位置 |
| `after-candidates.png` | 变更后：上下文窗口下拉展开，7 个候选全部显示，当前值 `131072` 高亮 |
| `after-selected.png` | 变更后：点击候选 `200000` 后写入输入框、下拉关闭、提示变为 `200K` |
| `after-max-candidates.png` | 变更后：输出上限下拉展开，6 个候选全部显示，当前值 `8192` 高亮 |

## 真实 DOM 矩形测量（Chrome headless，同一次采集）

| 指标 | 基线 | 变更后 |
| --- | --- | --- |
| 上下文窗口空态输入框 `top` | 336.58 | 335.19 |
| 上下文窗口填入 `131072` 后 `top` | 317.19 | 335.19 |
| 上下文窗口非法输入 `abc` 后 `top` | 317.19 | 335.19 |
| 清空后 `top` | — | 335.19 |
| 路由（select）`top` / 高度 | 251.19 / 31 | 251.19 / 29 |
| 模型 ID 输入框 `top` / 高度 | 253.19 / 29 | 251.19 / 29 |
| 显示名输入框 `top` / 高度 | 253.19 / 29 | 251.19 / 29 |

基线在提示行出现时输入框上移 19.39px（336.58 → 317.19）；变更后空态、合法值、
错误提示、清空四种状态的 `top` 均为 335.19。同一行的路由 / 模型 ID / 显示名在
变更后顶边均为 251.19、高度均为 29px（`test/client/layout.test.mjs` 会重新测量这些值）。

## 候选下拉的截图限制

原生 `<datalist>` 的弹出层由浏览器合成器绘制，headless Chrome 的页面截图不包含
该弹层，因此基线无法截到「候选被当前值过滤」的弹层画面；本目录的 `after-candidates.png`
用自定义面板证明 7 个候选全量可见。基线实现确实使用 `datalist`（`lib/client.js`
基线产物中含两处 `datalist` 标记），变更后产物中已无该标签。
