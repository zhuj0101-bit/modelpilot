# 编辑模型清空字段 — Before / After 视觉证据

- **基线**：`524f9d7`（本分支切出 / rebase 时的 `origin/main`；工单 #38 写的仓库基线
  `1e53d7c` 之后又合并了 #74–#78，编辑表单与 token 输入相关代码未变）
- **变更**：本分支 `agent/clear-model-fields-81497554fc77` 的 PR 头提交；
  截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- **环境**：Chrome 152.0.7977.64 headless，1200×1400 视口，设备像素比 1，
  浅色 / 深色两套宿主 token
- **场景**：设置 → ModelPilot，路由 `preview-chat`，一条模型
  `jxf/dsv4.1-flash`（`1000000` / `32768` / `text` / `reasoningEfforts: false`），
  `baseURL` 为 `https://preview.invalid/v1` 占位地址

截图不是 mockup：页面加载仓库**真实打包产物** `lib/client.js`（before 为
`524f9d7` 的产物，after 为本分支产物），由与单测共用的最小 React 渲染器渲染
真实 `Workbench` 组件树，宿主 `--dsw-*` token 与 `configForms` 快照由夹具提供。
before / after 除 `lib/client.js` 外完全相同。没有真实凭据或私人内容。

## 问题一：清空上下文窗口

操作：展开 `jxf/dsv4.1-flash` 的编辑表单，把「上下文窗口」从 `1000000` 清空。

| 文件 | 说明 |
| --- | --- |
| `before-light-clear.png` / `before-dark-clear.png` | 基线：输入框已清空，但保存按钮灰、改动字段显示「无（保存已禁用）」、将写入 0 条 op；界面上没有任何一句解释为什么清空不生效 |
| `after-light-clear.png` / `after-dark-clear.png` | 变更后：保存按钮可用，改动字段显示「上下文窗口」，字段下方出现浅色提示「清空 = 删除该字段，改由路由默认值接管」，将写入 1 条整数组 `set`（`providers.preview-chat.models`，该行不再含 `contextWindow`） |

## 问题二：两个输入模态都不勾

操作：展开同一条模型的编辑表单，取消唯一的 `text` 模态，使 `text` / `image` 都不勾。

| 文件 | 说明 |
| --- | --- |
| `before-light-modality.png` / `before-dark-modality.png` | 基线：两个复选框都可以取消，保存按钮灰、改动字段「无（保存已禁用）」，没有任何原因说明 |
| `after-light-modality.png` / `after-dark-modality.png` | 变更后：保存仍然禁用，但字段下方明确写出「至少保留一个输入模态（宿主会拒绝空 input）」；重新勾选一个模态即可保存 |

## 验证

- `test/core/model-edit.test.mjs`：共享 `classifyTokenInput` 的空串 / `0` / 负数 /
  非数字 / 超长数字 / `007` 边界，`diffRow` 的显式删除标记，`validateEditForm`
  的 `input-empty` 错误码。
- `test/projection/model-edit.test.mjs`：`update + unset` 只产出 1 条整数组
  `set`，删除字段后该键消失，`compat` 与宿主未来字段原样保留，不产生任何
  `op: "unset"`。
- `test/client/model-clear-fields.test.mjs`：light / dark 两套主题下的真实 DOM
  操作 —— 清空提示、保存可用性、写入后键消失、`007` 归一、超长数字拒绝、
  两模态全不勾的禁用与说明、本来没有 `input` 的模型不被误伤。

## 局限

截图渲染的是 Workbench 组件树（与 `docs/evidence/connection-probe-provider`
同一方式），不是完整 DSH 设置外壳；被修改的表单、宿主 token 与写入管道都是
真实产物，但页面没有侧栏 / 设置弹窗容器。
