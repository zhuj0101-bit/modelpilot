# 分组视图：跨组拖动拦截 + 紧凑模式摘要可达性 — 证据（工单 #32）

- 基线：`12b538d`（`origin/main`，`feat: 长模型列表分组折叠与密度切换（工单 #31） (#65)`）
- 变更：本分支的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，1440×1500 视口，设备像素比 1；宿主 token 由 `test/client/layout-harness.mjs` 提供
- 场景：Workbench 工作台，路由 `preview-chat`，9 条模型，四个前缀组 `acme`（3）/ `jxf`（3，摘要混合）/ `tx`（2）/ `其他`（1）
  - 拖动源：`jxf/dsv4.1-flash`（数组下标 3，jxf 组第一条）
  - 落点：`tx/deepseek-v4.1-flash`（数组下标 6，tx 组第一条）的下半区
  - 两个页面只有 `lib/client.js` 不同：基线链接 `12b538d` 的打包产物，变更链接本分支的 `lib/client.js`；provider、模型数据、视口、主题和 token 完全一致
  - 数据不含真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-over-light.png` / `compare-over-dark.png` | 拖动经过跨组行：基线（左）显示蓝色插入线，暗示可以放下；变更后（右）跨组落点不显示插入线，`dropEffect = none` |
| `compare-dropzoom-light.png` / `compare-dropzoom-dark.png` | 在跨组行松手：基线（左）把 `jxf/dsv4.1-flash` 悄悄挪到 jxf 组末尾并提示「已把 … 移到第 6 位」；变更后（右）jxf 组顺序不变，提示「只能在同一分组内调整顺序；跨分组无法排序」 |
| `compare-compact-light.png` / `compare-compact-dark.png` | 默认紧凑模式：视觉完全不变（像素级一致）；摘要从「只有 hover」变为同时进入 `aria-label` 与 sr-only 节点 |

## 整页状态

| 文件 | 说明 |
| --- | --- |
| `before-light-cross-over.png` / `before-dark-cross-over.png` | 基线：从 jxf 拖到 tx 行，插入线画在 tx 行之间 |
| `after-light-cross-over.png` / `after-dark-cross-over.png` | 变更后：同一场景，跨组落点无插入线；被拖行仍为 `opacity: 0.45` |
| `before-light-cross-drop.png` / `before-dark-cross-drop.png` | 基线：跨组松手写盘，jxf 组内顺序被改写，绿色 toast 提示移动成功 |
| `after-light-cross-drop.png` / `after-dark-cross-drop.png` | 变更后：跨组松手不写盘、不产生 settingsOps，红色 toast 明确拒绝；顺序保持不变 |

## 紧凑模式可访问性（真实 DOM 计算值）

夹具在默认紧凑模式下读回同一份行树，详细模式再读一次：

| 维度 | 变更后 |
| --- | --- |
| 行 `aria-label` | `模型 jxf/dsv4-pro-reason。窗口 200K · 输出 66K · text / image · 非推理`（完整摘要，两种密度一致） |
| 组内共享摘要 | `模型 acme/zeta。窗口 131K · 输出 8K · text · 4 档`（即使行内视觉上不重复，可访问名也保留完整摘要） |
| sr-only 节点 | 紧凑模式每行 1 个，文本 = `aria-label` 中「模型 xxx。」之后的部分 |
| `display` / `visibility` | `block` / `visible`（**不是** `display: none` / `visibility: hidden`） |
| 视觉隐藏 | `position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); margin: -1px; white-space: nowrap`，实际包围盒 1×1 |
| 行高 | 紧凑 27–32px；详细 52–61px；sr-only 不撑高紧凑行 |
| 详细模式 | sr-only 节点 0 个；混合摘要行内可见且 `title` 仍在；行容器保留完整 id 的 `title` |
| 密度切换 | `aria-label` 逐行不变（compact / detailed 两次读回完全相等） |

## 测试与产物验证

- `node --test 'test/**/*.test.mjs' test/structure.test.mjs`：**790 项**，783 通过、7 项按既有条件跳过、0 失败。
- 新增 **26 项**（light / dark 各 13 项，`test/client/grouped-view-fixes.test.mjs`），覆盖：
  - 跨组拖被拒（两个方向 + 「其他」组）、不产生 op、不写盘、顺序不变、提示文案；
  - 跨组拖动经过时不显示插入线、`dropEffect = none`，回到本组后插入线恢复；
  - Esc 取消跨组拖动不写盘也不弹提示；
  - 同组拖动仍为一次 mutate、一条整数组 `set`，顺序只在本组内变化；
  - 键盘排序仍严格限制在本组（End 到 jxf 组末位）；
  - 紧凑行 `aria-label` 含完整摘要；sr-only 文本等于摘要、标准视觉隐藏而非 `display:none`；
  - 详细模式摘要 / `title` 不变；两种密度下 `aria-label` 一致。
- 既有浏览器夹具只做了机械读取更新：行的 `aria-label` 现在含摘要，因此 #19 / #25 / #27 / #31 等夹具改用稳定的 `data-model-key` 定位行；视觉文本断言排除 sr-only 节点。断言语义未改变。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `23a95e032669ae04670e992841b233c6f2f01d47116903429693e51ef61a6064`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改。

## 说明

- 截图由打包产物在真实 DOM 中渲染；它们不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/layout-harness.mjs` 的夹具提供（与既有截图做法一致）。
- 拖动截图派发的是真实 `DragEvent`（`DataTransfer` + `dragstart` / `dragover` / `drop`）；断言在 `test/client/grouped-view-fixes.test.mjs`。
- 紧凑模式的视觉没有变化：摘要仍然只在短 id 的 `title` 悬停里；新增的是 `aria-label` 与 sr-only 节点，因此仅靠截图无法看出差异，可访问性证据以上表计算值为准。
