# 深色主题下原生控件配色 — 视觉证据

- 基线：`7b530e9`（`origin/main`，`feat: 支持保存默认模板并自动回填 (#16)`）
- 变更：本分支 `agent/dark-theme-tokens-ed3cf79bd5ce` 的 PR 头提交（截图在 `npm run build` 重建 `lib/client.js` 后采集）
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless，1440×913 视口，**深色主题**（profile 内 `ui-theme` 的 `preference: dark`）
- 场景：设置 → ModelPilot，路由 `preview-chat`；模型 ID `tflow/alpha-32b`，上下文窗口 `131072`，输出上限 `8192`，再输入 `abc` 触发「请输入正整数」
- 两个预览实例使用独立的临时 profile 与示例 provider，不含真实凭据或私人内容

| 文件 | 状态 |
| --- | --- |
| `before-controls.png` | 基线：原生 select / input 背景为 `transparent`，深色下与页面底色完全融合；错误提示为硬编码 `#e05252` |
| `after-controls.png` | 变更后：select / input 使用 `--dsw-alias-bg-layer-1` 底色，错误提示使用 `--dsw-alias-state-error-primary` |
| `before-fields.png` | 基线放大：路由下拉与模型 ID / 显示名输入框没有独立底色 |
| `after-fields.png` | 变更后放大：同样的控件出现一级抬升面的深灰底色与 token 边框 |
| `before-combo.png` | 基线：token 候选面板使用系统色 `Canvas`（Chrome 中解析为 `rgb(18,18,18)`） |
| `after-combo.png` | 变更后：候选面板使用 `--dsw-alias-bg-layer-1`，与 chip / 输入框同一层级 |
| `before-checkboxes.png` | 基线放大：推理档位 chip 使用固定 `rgba(128,128,128,0.1)` 底色 |
| `after-checkboxes.png` | 变更后放大：chip 使用 `--dsw-alias-bg-layer-1`；复选框继承宿主 `color-scheme` |

## 计算样式对比（同一预览实例、同一场景）

| 指标 | 基线 | 变更后 |
| --- | --- | --- |
| `documentElement.style.colorScheme` | `dark` | `dark` |
| `<select>` background | `rgba(0, 0, 0, 0)` | `rgb(35, 35, 36)` |
| 上下文窗口 `<input>` background | `rgba(0, 0, 0, 0)` | `rgb(35, 35, 36)` |
| chip background | `rgba(128, 128, 128, 0.1)` | `rgb(35, 35, 36)` |
| 候选面板 background | `rgb(18, 18, 18)`（`Canvas`） | `rgb(35, 35, 36)` |
| 错误提示 color | `rgb(224, 82, 82)` | `rgb(242, 90, 90)` |

## 说明

- 原生 `<option>` 弹层由浏览器合成器绘制，headless 截图不包含该弹层；`before-combo.png` /
  `after-combo.png` 证明的是自定义候选面板。select 自身的底色与 `color-scheme` 由
  `test/client/theme.test.mjs` 在真实 DOM 中读取计算样式验证。
- Chrome 会把 `Canvas` 系统色随 `color-scheme` 反色，因此基线候选面板在 Chrome 中已经是深色，
  只是与宿主的 `--dsw-alias-bg-layer-1` 不同；Firefox / WebView 下 `Canvas` 不跟随主题的问题
  无法在这个 Chrome 预览里复现。变更后的视觉差异因此以「控件底色 / 边框 / 错误色与宿主 token
  对齐」为主，不夸大为 Chrome 内的明显换肤。
- Chrome 对原生复选框已按 `color-scheme: dark` 渲染深色未选中态；变更通过 `colorScheme: "inherit"`
  把这一前提显式写进控件样式（也作用于 `<option>` 与滚动条），并让 chip 底色来自主题 token。
  Firefox / WebView 的实际渲染仍需发布后在对应宿主中复核。
