# 工作台四项修正 — 视觉证据

- 基线：`c5d5af7`（`origin/main`，`feat: 拉取模型列表改为可搜索可勾选的弹窗选择器 (#22) (#23)`）
- 变更：本分支 `agent/workbench-four-fixes-7df5ef966a9b` 的 PR 头提交；截图在 `npm run build` 重建 `lib/client.js` 后采集
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless（CDP 截图），1440×913 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`（现有 1 条 `preview-model-existing`）；模型 ID `fresh/model-one`；两个实例使用同一个本地 mock `/v1/models`（63 个 id），勾选 `jxf/dsv4.1-flash`、`jxf/dsv4.1-pro`、`tx/deepseek-v4.1-flash`
- 数据：两个预览实例使用独立的临时 DSH profile；provider、baseURL、视口与主题一致，页面不包含真实凭据或私人内容

## 问题 1：primary 按钮文字（深浅两色）

| 文件 | 说明 |
| --- | --- |
| `before-light-primary-button.png` | 基线浅色：`s.btnPrimary` 仍是 `color:"inherit"`，按钮黑底黑字，文字完全不可见 |
| `after-light-primary-button.png` | 变更后浅色：按钮前景改为 `--dsw-alias-label-primary-foreground`，白字清晰 |
| `before-dark-primary-button.png` | 基线深色：白底白字，文字完全不可见 |
| `after-dark-primary-button.png` | 变更后深色：深色前景铺在白底上，清晰可读 |
| `before-light-picker-confirm.png` / `after-light-picker-confirm.png` | 弹窗「确定（3）」浅色：基线黑底黑字（整块空白），变更后白字可见 |
| `before-dark-picker-confirm.png` / `after-dark-picker-confirm.png` | 弹窗「确定（3）」深色：基线白底白字（整块空白），变更后深色字可见 |

同一场景、同一滚动位置的计算样式与对比度：

| 主题 | 基线 color / background | 基线对比度 | 变更后 color / background | 变更后对比度 |
| --- | --- | --- | --- | --- |
| 浅色 | `rgb(15,17,21)` / `rgb(15,17,21)` | 1.00 | `rgb(255,255,255)` / `rgb(15,17,21)` | 18.90 |
| 深色 | `rgb(249,250,251)` / `rgb(249,250,251)` | 1.00 | `rgb(15,17,21)` / `rgb(249,250,251)` | 18.08 |

`test/client/theme.test.mjs` 新增的断言会在真实 DOM 中找出所有使用 `--dsw-alias-button-primary-fill` 的按钮（主按钮、弹窗「确定（N）」、待写入「写入」），逐个计算文字对比度，任何 < 4.5 直接失败；未来新增的 primary 按钮自动纳入。

## 问题 2：多选确认后再写入

| 文件 | 说明 |
| --- | --- |
| `before-light-immediate-write.png` / `before-dark-immediate-write.png` | 基线：勾 3 个点「确定」后立即一次 `mutate` 写入，页面没有核对区块，JSON 直接铺开 |
| `after-light-pending-block.png` | 变更后：确认只生成「待写入 3 条模型」区块，展示每条模型的 `contextWindow` / `maxTokens` / `input` / `reasoningEfforts`，附「清空」「写入」；区块存在时配置未被修改 |
| `after-dark-pending-block.png` | 深色同一区块（无默认模板时字段显示「未设置」） |

补充行为（单测覆盖）：写入中按钮显示「写入中…」且禁用；写入成功后区块消失；写入失败保留区块可重试；区块存在时重新选择一批会替换而不是累加；单条选择仍只回填模型 ID。

## 问题 4：JSON 预览默认折叠

| 文件 | 说明 |
| --- | --- |
| `before-light-primary-button.png` / `after-light-primary-button.png` | 浅色同一场景：基线单条投影 JSON 展开，ModelPilot 区块高 1026px；变更后 `settingsOps（1 条）· 点击展开` 默认关闭，区块高 605px（减少 421px） |
| `before-dark-primary-button.png` / `after-dark-primary-button.png` | 深色同一场景，高度同样由 1026px 降到 605px |

「批量投影结果（写出 N 条）」上方的人读摘要行（`providers.preview-chat.models.1 ← jxf/dsv4.1-flash`）保留；折叠块里的 JSON 内容与基线完全一致。

## 问题 3：默认显示名

- 基线截图（`before-*-primary-button.png`）：模型 ID 为 `fresh/model-one` 时显示名被吃掉前缀，变成 `model-one`，写入的 `name` 也是 `model-one`。
- 变更后截图（`after-*-primary-button.png`）：显示名与模型 ID 一致，为 `fresh/model-one`。
- 批量行由 `planBatchSelection` 显式写入 `name: <模型 ID 原文>`，不依赖宿主回落链的 `base?.name`；单测覆盖 `jxf/dsv4.1-flash`、`QoderCom/DeepSeek-Flash` 的大小写与斜杠。

## 说明

- 截图由 Chrome DevTools Protocol 直接采集运行中的 DSH Web 预览实例；输入、勾选、确认与写入均为真实 DOM 操作。
- 基线实例链接 `origin/main` 检出，变更实例链接本分支检出；除 `lib/client.js` 版本外，两个实例的 provider、视口、主题与 mock 端点一致。
- 基线页面没有 `<details>` 元素；变更后的折叠块使用原生 `<details>`，默认关闭，不引入新依赖。
- 预览使用本地 mock 模型端点（`127.0.0.1:9998`），不含真实服务的模型列表或凭据。
