# 模型列表平铺 / 分组视图开关 — Before / After 视觉证据（工单 #39）

- **基线**：`8487ede`（`fix: 编辑模型支持清空字段并给出明确提示（工单 #38） (#79)`，
  工单 #39 写的仓库基线）
- **变更**：本分支 `agent/flat-grouped-view-toggle-4d1a74a50eab` 的 PR 头提交；
  截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- **环境**：Google Chrome 152.0.7977.64 headless，1200×1000 视口，设备像素比 1，
  浅色 / 深色两套宿主 token
- **场景**：设置 → ModelPilot，路由 `preview-chat`，5 条模型：
  `jxf/alpha`、`tx/beta`、`jxf/gamma`、`standalone`、`tx/delta`（数组顺序）；
  默认紧凑密度，`baseURL` 是 `https://preview.invalid/v1` 占位地址
  - 三个分组：`jxf`（alpha、gamma）、`tx`（beta、delta）、`其他`（standalone）
  - before / after 两个页面只有 `lib/client.js` 不同：基线装的是 `8487ede`
    的打包产物，变更装的是本分支重建的产物；夹具、模型数据、主题、视口完全一致
  - `after-*-flat.png` 在渲染后点击「平铺」，其余与 `after-*-grouped.png` 相同

截图不是 mockup：页面加载仓库**真实打包产物** `lib/client.js`，由与单测共用的
最小 React 渲染器渲染真实 `Workbench` 组件树，宿主 `--dsw-*` token 与
`configForms` 快照由夹具提供，滚动到「该路由的模型列表」后截取视口。
没有真实凭据或私人内容。

## Before / After 对照

| 文件 | 说明 |
| --- | --- |
| `before-light-grouped.png` / `before-dark-grouped.png` | 基线（分组视图）：模型列表标题行只有「详细 / 紧凑」密度开关；没有视图开关，列表按 id 前缘分三个组头，组内短名，序号按分组阅读顺序 1–5 |
| `after-light-grouped.png` / `after-dark-grouped.png` | 变更后（默认分组）：密度开关左边多出「平铺 / 分组」分段开关，「分组」为按下态；分组渲染、组头计数与共享摘要与基线一致 |
| `after-light-flat.png` / `after-dark-flat.png` | 变更后切换到平铺：「平铺」为按下态；没有组头，行按 `models` 数组顺序逐条渲染（`jxf/alpha`、`tx/beta`、`jxf/gamma`、`standalone`、`tx/delta`），显示完整 id，序号 1–5；此后拖动手柄按全表位置写盘 |

## 拖动 / 键盘排序（行为证据）

截图静态呈现不了拖动与键盘，这两条由真实 DOM 测试断言：

- 平铺下把 `tx/beta` 拖到 `jxf/alpha` 之前 → 写入 `providers.preview-chat.models`
  的数组首条是 `tx/beta`，界面首行也是 `tx/beta`；一次拖动一条整数组 `set`。
- 平铺下 `Home` / `End` 移到全表首 / 末位，`↑` / `↓` 跨组连续；分组视图仍严格
  限本组、跨组松手弹既定提示且不写盘。
- 视图切换只写 `localStorage`（`modelpilot.model-list-view.v1`），两种视图下
  视图切换全程 `mutations === 0`；折叠状态在切回分组后原样恢复。

## 验证

- `node --test "test/**/*.test.mjs"`：**954 项**，947 通过、7 项按既有条件跳过、0 失败。
- 新增 **19 项**：`test/core/model-list-view.test.mjs` 3 项（视图偏好读写 / 回落 /
  key 独立），`test/client/model-list-view-mode.test.mjs` 16 项（light / dark 各 7
  项 + localStorage 读回 1 项 + key 1 项），覆盖本工单验收标准里的每条判据。
- 既有分组相关断言未改：`model-list-grouping` / `grouped-view-fixes` /
  `bulk-visibility` 三套全绿。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为
  `27db09426095715daf577769e831b67ce7450047622aaede85c89333ffced499`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改。

## 局限

截图渲染的是 Workbench 组件树（与 `docs/evidence/model-edit-clear-fields` 同一
方式），不是完整 DSH 设置外壳：被修改的列表头、行、宿主 token 与写入管道都是
真实产物，但页面没有侧栏 / 设置弹窗容器。拖动过程（插入线、toast）的视觉没有
单独截图，由上面的真实 DOM 测试覆盖。
