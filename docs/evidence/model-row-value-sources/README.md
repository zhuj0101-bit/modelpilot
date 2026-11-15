# 模型行摘要标注值来源 — 视觉证据（工单 #27）

- 基线：`052c88e`（`origin/main`，`feat: 删除路由时一并清理存储的密钥（工单 #26） (#55)`），打包产物 `lib/client.js` SHA-256 `2d0d8dd52bddb7d25f4e46c3ab80776355e1071680934953c5e81000da233e3e`
- 变更：本分支功能提交 `fd3e488`，截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集，SHA-256 `e3d79a9c3ba3e3769c2795d72489a5f8c68bac5d681f2b77e7d8e4422486a5bd`（连续两次构建同值）
- 环境：Chrome 152.0.7977.64 headless，截图视口 1440×1100、设备像素比 1；宿主 `--dsw-*` token 由仓库既有的 light / dark token 夹具提供，`color-scheme` 分别为 `light` / `dark`
- 场景：一条占位路由 `preview-chat`，`baseURL` 为 `https://preview.invalid/v1`，路由默认值 `defaultContextWindow: 1000000`、`defaultMaxTokens: 128000`、`defaultInput: ["text", "image"]`，三个模型：
  - `acme/declared`：四个字段全部自己声明（`contextWindow: 131072`、`maxTokens: 32768`、`input: ["text"]`、4 个推理档位）；
  - `acme/route-defaults`：四个字段全部没声明，token 与模态回落到路由默认值，推理档位没有这一级 → 无档；
  - `acme/empty-input`：`contextWindow: 262144`、`maxTokens: 8192`、`input: []`（明确选择「一个模态都不开」）、`reasoningEfforts: false`
- 数据：没有真实凭据或私人内容；`baseURL` 是 `*.invalid` 占位地址

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `052c88e` 的产物，after 为本分支产物），由与单测共用的最小 React 兼容渲染器渲染真实的 `Workbench` 组件树；路由数据、宿主 token、命名空间 schema、`configForms` 快照与 `credentials` 夹具完全一致，before / after 两份页面只有 `lib/client.js` 不同。`test/client/model-row-sources-harness.mjs` 的夹具与本组截图同源。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；`title` 是浏览器原生悬停提示，截图里不会自动展开，DOM 测试会逐字读回它的内容（见下）。截图页面里只隐藏了探针输出用的 `<pre id="result">`，它是测试脚手架，不属于产品界面。

## Before / After：同一条路由的三个模型行（light / dark）

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线 `052c88e`：`acme/route-defaults` 那行显示「窗口 未设置 · 输出 未设置 · 未设置 · 无档」。它实际在用路由默认值 1M / 128K / text / image，但读起来像什么都没配 |
| `after-light.png` / `after-dark.png` | 变更后：同一行显示「窗口 1M↑ · 输出 128K↑ · text / image↑ · 无档」；`↑` 表示来自路由默认值。`acme/declared` 仍是「窗口 131K · 输出 33K · text · 4 档」（无标记）；`acme/empty-input` 仍是「窗口 262K · 输出 8K · 未设置 · 非推理」（空数组是明确选择，不标 ↑，推理档位也没有 ↑） |
| `after-light-narrow.png` / `after-dark-narrow.png` | 变更后、320px 窄容器：摘要保持单行并用省略号截断（最长的 route-defaults 行 `scrollWidth 235 > clientWidth 232`），卡片宽 316px、行右缘 323px ≤ 卡片右缘 338px，页面没有横向滚动；「编辑」按钮保持单行 |

## 悬停解释（`title`）

DOM 测试在 light / dark 下逐字读回 `acme/route-defaults` 的 title：

```text
窗口：模型未声明 → 使用路由默认值 1M
输出：模型未声明 → 使用路由默认值 128K
模态：模型未声明 → 使用路由默认值 text / image
推理档位：模型未声明（没有路由级默认值）
```

`acme/declared` 的 title 是「模型声明 …」，不含「使用路由默认值」字样。数字统一走现有的 `humanizeTokenCount`（与摘要同一套格式化，`1000000` 显示为 `1M`），没有另写一套数字格式化。

## 验收判据对照

| 判据 | 证据 |
| --- | --- |
| 1 模型声明 `contextWindow` → 无标记 | `after-*-*.png` 的 `acme/declared` 行「窗口 131K」；纯测试「模型声明 contextWindow / maxTokens → 显示原值」 |
| 2 未声明 + 路由有默认值 → `↑` | `after-*-*.png` 的 `acme/route-defaults` 行「窗口 1M↑ · 输出 128K↑」；纯测试 |
| 3 未声明 + 路由也没有 → 未设置、无 ↑ | 纯测试「模型未声明 token、路由也没有默认值」 |
| 4 声明 `input: ["text","image"]` → 无标记 | 纯测试「模型声明 input → 按声明显示」 |
| 5 未声明 `input` + 路由 `defaultInput` → `text↑` | `after-*-*.png` 的「text / image↑」；纯测试（含多模态时 ↑ 在整串末尾） |
| 6 声明 `input: []` → 未设置、不带 ↑ | `after-*-*.png` 的 `acme/empty-input` 行；纯测试「input: [] 算已声明」 |
| 7 `reasoningEfforts` false / N 档 / 缺失，永不带 ↑ | `after-*-*.png` 三行分别「4 档 / 无档 / 非推理」，整行没有推理 ↑；纯测试三条；title 写明「没有路由级默认值」 |
| 8 数字用 `humanizeTokenCount` | 摘要与 title 都显示 `1M` / `128K` / `33K`；纯测试用自定义 humanizer 断言调用值，证明没有自写格式化 |
| 9 title 逐字段说明回落链 | DOM 测试逐字断言四个字段的 title（light / dark 各一次） |
| 10 声明字段不出现「使用路由默认值」 | DOM 测试断言 `acme/declared` 的 title 不含该字样；纯测试同样断言 |
| 11 路由缺失 / 不是对象 → 不抛错、无 ↑ | 纯测试覆盖 `undefined` / 字符串 / 数组 / `null` / 数字 |
| 12 `defaultInput: []` → 不显示 ↑ | 纯测试「defaultInput 是空数组 → 不构成有效默认值」 |
| 13 `model` 为 `null` / 非对象 → 一句「未设置」 | 纯测试覆盖 `null` / `undefined` / 字符串 / 数字 / 数组，同时断言 title 与 sources |
| 14 现有 656 项测试全部通过 | 完整套件 `node --test 'test/**/*.test.mjs'`：687 tests，681 pass，6 skipped，0 fail（基线 656 = 650 pass + 6 skipped，6 项跳过是宿主源码夹具在当前 checkout 不可用；新增 31 项） |
| 15 新增测试 ≥ 18、总数 ≥ 674 | 新增 31 项（25 项纯逻辑 + 6 项真实 DOM），总数 687 |
| 16 产物可重现 + verify-package 18/18 | 连续两次构建同为 `e3d79a9c…`；`node scripts/verify-package.mjs .` 18/18 PASS |
| 17 摘要不换行、溢出省略、窄容器不撑破卡片 | `after-*-narrow.png`；DOM 测试断言 `white-space: nowrap`、`text-overflow: ellipsis`、单行高度、`rowRight ≤ panelRight`、`panelWidth ≤ 320`、页面无横向滚动 |

## 测试与产物验证

```text
$ node --test 'test/**/*.test.mjs'
ℹ tests 687
ℹ pass 681
ℹ fail 0
ℹ skipped 6

$ node scripts/build-client.mjs   # 连续两次
e3d79a9c3ba3e3769c2795d72489a5f8c68bac5d681f2b77e7d8e4422486a5bd
e3d79a9c3ba3e3769c2795d72489a5f8c68bac5d681f2b77e7d8e4422486a5bd

$ node scripts/verify-package.mjs .
PASS 1 … PASS 18
```

新增测试：

- `test/projection/model-row-sources.test.mjs`：25 项纯逻辑（三态来源、四字段、title 格式、空数组 / 空默认值、缺失路由与模型、目录扩展点、旧签名兼容、humanizer 调用）；
- `test/client/model-row-sources.test.mjs`：6 项真实 DOM（light / dark 各 3 项：来源标记、title 逐字解释、窄容器单行省略）。

## 本批没有做

- 没有给 `reasoningEfforts` 标 ↑ —— 它没有路由级默认值；
- 没有把 `input: []` 当未声明，也没有把 `defaultInput: []` 当有效默认值；
- 没有假装知道内置目录描述了哪些模型：默认不出现 `·目录`，只保留 `catalogValueOf` 这个可选扩展点；
- 没有改工单 #16 的 `countRouteDefaultUsers` / `describeRouteDefaultUsage`，也没有改 `describeModelRow` 的旧调用方式（新增可选参数，旧的两参调用结果不变）；
- 没有给模型行加新的交互：完整来源解释就是原生 `title` 悬停，摘要本身单行省略。
