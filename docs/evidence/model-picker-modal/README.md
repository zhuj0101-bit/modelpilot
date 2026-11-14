# 拉取模型列表改为可搜索、可勾选弹窗 — 视觉证据

- 基线：`b8fdf6e`（`origin/main`，`fix: 深色主题下原生控件配色跟随 DSH token (#20) (#21)`）
- 变更：本分支 `agent/model-picker-modal-10a13e1dcc75` 的 PR 头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless（CDP 截图），1440×913 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`，模型 ID 为空
- 数据：本地 mock `/v1/models` 返回 63 个 id；路由已有 `kimi-k3`（已存在）与 `qodercom/deepseek-flash`（与 `QoderCom/deepseek-flash` 仅大小写不同）
- 两个实例使用独立的临时 DSH profile，provider、视口与主题相同；凭据由宿主从 `PREVIEW_API_KEY` 解析，页面与仓库均不含真实凭据或私人内容
- 基线已包含 #20 的 `--dsw-*` token 配色；变更实例在此基础上增加选择器弹窗

## 基线（before）

| 文件 | 说明 |
| --- | --- |
| `before-light.png` | 浅色：拉取成功后仍是一行文字「已拉取 63 个模型：… 等 63 个」，只有一个 `<datalist>` 提供输入补全 |
| `before-dark.png` | 深色：同一场景 |

## 变更后（after）

| 文件 | 说明 |
| --- | --- |
| `after-light-modal.png` | 浅色：拉取成功自动打开「选择模型」弹窗；搜索框、全选（可选 61 个）、63 行列表；`kimi-k3` 禁用并标「已存在」，`QoderCom/deepseek-flash` 标「仅大小写不同」且默认不勾；页面上原文字行改为「已拉取 63 个 · 选择」按钮，`<datalist>` 保留 |
| `after-dark-modal.png` | 深色：同一场景；计算样式为弹窗底色 `rgb(35, 35, 36)`、文字 `rgb(249, 250, 251)`、边框 `rgba(255, 255, 255, 0.12)`，浅色对应 `rgb(255, 255, 255)` / `rgb(15, 17, 21)` / `rgba(0, 0, 0, 0.1)` |
| `after-light-selected.png` | 浅色：勾选 3 个新模型后按钮显示「确定（3）」，底部显示「将写入 3 条模型；已跳过 1 条已存在、1 条仅大小写不同」 |
| `after-dark-selected.png` | 深色：同一勾选状态 |
| `after-light-batch.png` | 浅色：确认后一次批量写入 3 条，投影预览区标题「写出 3 条」，摘要列出 `models.2 / models.3 / models.4` 三条 op |
| `after-dark-batch.png` | 深色：同一批量投影结果 |
| `after-light-batch-scroll.png` | 浅色：投影预览向下滚动，可见第 3 条 op（`models.4`）与「已写入 preview-chat / 3 个模型」提示 |
| `after-dark-batch-scroll.png` | 深色：同上 |

## 数据核对

- 拉取结果 63 条；`<datalist id="modelpilot-remote-models">` 仍保留 63 个 `option`。
- 勾选 `jxf/dsv4.1-flash`、`jxf/dsv4.1-pro`、`tx/deepseek-v4.1-flash` 后，一次 `scope.mutate` 写入 3 条 `op:"set"`：
  - `providers.preview-chat.models.2`
  - `providers.preview-chat.models.3`
  - `providers.preview-chat.models.4`
- 批量写入后页面显示「该路由现有模型条目 5」，路由条目数由 2 增至 5；写入提示为「已写入 preview-chat / 3 个模型」。
- 默认模板未设置时，弹窗提示「未设置默认模板，将使用内置默认值」，批量字段为 `input: ["text"]` 与 `reasoningEfforts: { off: null, low, medium, high }`。

## 说明

- 截图由 Chrome DevTools Protocol 直接采集运行中的 DSH Web 预览实例；输入、勾选、确认与滚动均为真实 DOM 操作。
- 基线实例与变更实例分别链接 `origin/main` 检出和本分支检出；除 `lib/client.js` 版本外，两个实例的 provider、视口与主题一致。
- 原生 `<datalist>` 弹层由浏览器绘制，headless 截图不包含该弹层；其 63 个候选项通过 DOM 单独核对。
