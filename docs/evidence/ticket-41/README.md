# 暗色主题选中态「多重冗余编码」— Before / After 视觉证据（工单 #41）

- **基线**：`bd3dc98`（`feat: 首次装完即有内置模板与预设（工单 #40） (#83)`，
  工单 #41 写的仓库基线）
- **变更**：本分支 `agent/chip-selected-state-c63986f277c1` 的 PR 头提交；
  截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- **环境**：Google Chrome 152.0.7977.64 headless，1280×3000 视口，设备像素比 1，
  浅色 / 深色两套宿主 token
- **场景**：设置 → ModelPilot，路由 `preview-chat`，3 条模型；展开路由设置，
  勾选 1 条模型并打开「批量改字段」，同时启用输入模态与推理档位；再展开编辑
  表单与新增表单。截图区从「默认输入模态」覆盖到编辑表单的档位 / 输入模态：
  - 路由默认输入模态：`image` 选中 / `text` 未选中
  - 列表视图：`分组` 选中 / `平铺` 未选中；列表密度：`紧凑` 选中 / `详细` 未选中
  - 批量字段：`text`、`off`、`low`、`medium`、`high` 选中 / `image`、`minimal`、
    `xhigh`、`max` 未选中
  - 编辑模型：`off`、`low`、`medium`、`text` 选中 / `max`、`image` 未选中
  - before / after 两个页面只有 `lib/client.js` 不同：基线装的是 `bd3dc98` 的
    打包产物，变更装的是本分支重建的产物；夹具、模型数据、主题、视口完全一致
- **截图不是 mockup**：页面加载仓库**真实打包产物** `lib/client.js`，由与单测
  共用的最小 React 渲染器渲染真实 `Workbench` 组件树，宿主 `--dsw-*` token 与
  `configForms` 快照由夹具提供。没有真实凭据或私人内容。

## Before / After 对照

左：基线 `bd3dc98`；右：变更后（`toggle-*-dark.png` / `toggle-*-light.png` 为单张）。

| 主题 | 对照 |
| --- | --- |
| 深色 | `toggle-before-after-dark.png` |
| 浅色 | `toggle-before-after-light.png` |

- **Before**：选中态只改一层很浅的填充与 1px 边框。暗色下批量 chip 的
  选中 / 未选中填充对比度只有 **1.64**，分组 / 密度分段按钮只有 **1.00**；
  截图里 `image`、`text`、`off`、`low`、`medium`、`high` 与未选中几乎同色，
  只能靠 1px 边框猜。
- **After**：填充换成主题强调色实底，2px 强调色边框、600 字重、固定宽度 ✓
  勾选槽同时表达状态。真实 DOM 测试测得选中 / 未选中填充对比度：
  浅色 **4.76**、深色 **7.83**（WCAG 非文本门槛 3.0）；文字使用
  `label-primary-foreground`，浅色 4.76 / 深色 7.53，仍 ≥ 4.5。
- 选中态每边内边距少 1px，正好抵消 2px 边框多出的 1px：同一 chip 连续切换
  两次，`offsetWidth` / `offsetHeight` 不变（见测试）。
- 停用态（批量字段两个「启用」复选框未勾时）使用虚线边框 + 0.5 透明度 +
  `not-allowed`，与选中 / 未选中都可区分。

## 覆盖范围

同一套 `toggleOn` / `toggleOff` 样式替换了工单里的 10 处使用点：

`bulk-modality`、`bulk-levels`、`preset-chips`、`create-modality`、
`edit-modality`、`route-default-input`、`edit-levels`、`create-levels`、
`view-toggle`、`density-toggle`。

## 验证

- `node --test "test/**/*.test.mjs"`：**1019 项**，1012 通过、7 项按既有条件跳过、0 失败。
- 新增 **35 项**：
  - `test/core/toggle-style.test.mjs` 8 项：WCAG 公式基准值、工单 1.64 缺陷复现、
    `parseColor` / `relativeLuminance` / `contrastRatio` / `composite`。
  - `test/client/toggle-contrast.test.mjs` 26 项：light / dark × 10 处填充对比度
    ≥ 3.0（20 项）+ 每主题的边框 / 字重 / ✓ 标记（2 项）+ 连续切换不抖动（2 项）
    + 三态可区分（2 项）。
  - `test/client/route-edit.test.mjs` 的既有「选中态可辨识」加强为真实填充对比度、
    边框宽度、字重与 ✓ 标记断言（净增 5 项）。
  - `test/structure.test.mjs` 增加旧样式名清除守护。
- 新测试先在基线 `bd3dc98` 上确认红：填充对比度 1.00–1.64、选中 / 未选中
  `borderWidth` 都是 1px、无 ✓、停用态仍是 `solid`。
- `node scripts/build-client.mjs` 重建 `lib/client.js`；`node scripts/verify-package.mjs .`
  18/18 PASS。
- 未新增依赖，`package.json` 未改。

## 局限

截图渲染的是 Workbench 组件树（与既有 `docs/evidence/*` 同一方式），不是完整
DSH 设置外壳：被修改的控件、宿主 token 与交互都是真实产物，但页面没有侧栏 /
设置弹窗容器。三态停用态与布局抖动由真实 DOM 测试断言，未单独截图。
