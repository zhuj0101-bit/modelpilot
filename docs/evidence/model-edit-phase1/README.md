# 模型编辑一期 — 视觉证据

- 基线：`f1de086`（`origin/main`，`fix: 修复工作台按钮配色与多选写入流程 (#24) (#25)`）
- 变更：本分支 `agent/model-edit-phase1-13308ea7d8d5` 的 PR 头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless（CDP `Page.captureScreenshot`），1440×1400 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`，三条模型：`jxf/dsv4.1-flash`（1M / 32K / text / 4 档）、`jxf/dsv4.1-pro`（1M / 32K / text / 4 档 + `compat.supportsReasoningEffort`）、`tx/deepseek-v4.1-flash`（128K / 8K / text / 无档）
- 数据：两个临时 DSH profile；除 `lib/client.js` 版本外，provider、baseURL、视图、主题与模型数据完全一致。没有真实凭据或私人内容。

## 列表态：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-light-list.png` / `before-dark-list.png` | 基线：只有 create 表单，无法看到该路由已经有哪些模型，也没有编辑入口 |
| `after-light-list.png` / `after-dark-list.png` | 变更后：显示「该路由的模型（3 条）」，每条给出 id、窗口、输出、模态、档位数，并提供「编辑」；同一份初始数据（`pro` 仍为 32K） |

## 展开编辑态：预填 + 同时只开一条

| 文件 | 说明 |
| --- | --- |
| `after-light-edit-zero.png` / `after-dark-edit-zero.png` | 展开 `jxf/dsv4.1-flash`：显示名、窗口 1000000、输出 32768、模态与档位全部预填现有值；保存按钮因「改动字段：无」而禁用 |
| `before-light-budget.png` / `before-dark-budget.png` | 基线：create 表单填 1000000 / 384000，底部没有任何可用上下文提示 |
| `after-light-edit-slight.png` / `after-dark-edit-slight.png` | 编辑态把输出改为 150000：`可用上下文 784,464（比最优少 1.9%）` |
| `after-light-edit-strong.png` / `after-dark-edit-strong.png` | 编辑态把输出改为 384000：`⚠ 可用上下文 550,464（比最优少 31.2%）`，并给出 `建议 ≤ 134,464 可零损失` |
| `after-light-create-budget.png` / `after-dark-create-budget.png` | 新增流程同一组 1000000 / 384000：同一个 `estimateContextBudget` 给出同一档强提示 |

`BudgetHint` 在窗口或输出为空 / 非法时返回 `null`，不渲染 0 或 NaN；两处复用同一个纯函数。

## 带 compat 的模型：编辑前后

`jxf/dsv4.1-pro` 在临时 profile 里声明了 `compat.supportsReasoningEffort: true`。DSH 0.2.2-rc.1 的 configForms 快照会给每条模型物化一个 compat 对象（即使只有空的 `chatTemplateKwargs` / `chatTemplateArgs`），因此编辑表单会在存在 compat 时显示「该模型还声明了 compat 字段，保存时会原样保留」。

| 文件 | 说明 |
| --- | --- |
| `after-light-edit-compat.png` / `after-dark-edit-compat.png` | 编辑 `jxf/dsv4.1-pro`，只把输出从 32768 改为 48000；展开 settingsOps 可见 1 条 set，path 为 `models.1`，value 仍是完整行，包含 `compat.supportsReasoningEffort: true` |
| `after-light-saved-list.png` / `after-dark-saved-list.png` | 点「保存修改」后宿主接受写入；列表立即显示 `jxf/dsv4.1-pro` 输出 48K，条目计数仍为 3 |

实际写入后的 profile 片段（`cordis.patch.yml`，只保留相关行）：

```yaml
- id: "jxf/dsv4.1-pro"
  name: "jxf/dsv4.1-pro"
  contextWindow: 1000000
  maxTokens: 48000
  input: [ text ]
  reasoningEfforts:
    off: null
    low: low
    medium: medium
    high: high
  compat:
    supportsReasoningEffort: true
    chatTemplateKwargs: {}
    chatTemplateArgs: {}
```

写入前后 `compat.supportsReasoningEffort` 一直为 `true`；宿主额外物化的空对象也随 `...existing` 保留。合并式写入没有用表单值重建整行。

## 删除确认

| 文件 | 说明 |
| --- | --- |
| `after-light-delete-dialog.png` / `after-dark-delete-dialog.png` | 编辑 `jxf/dsv4.1-pro` 后点「删除」，出现自绘二次确认弹窗（非原生 `confirm`）；文案说明会用一条 set 重写 models 数组、长度减一、不留空洞；「取消」「删除」按钮跟随 token |

单测与真实 DOM 测试（`test/client/model-edit.test.mjs`）确认：取消不产生 mutate；确认后恰好 1 条 `op:set`，path 为 `["providers","preview-chat","models"]`，value 长度为 2，列表计数同步为 2。

## 主题与对比度

- `test/client/model-edit.test.mjs` 在 light / dark 两套宿主 token 下渲染同一页面，断言列表、展开表单、compat 提示、预算提示、删除弹窗都引用 `--dsw-*` token。
- 删除按钮（实心错误色 + `label-primary-foreground`）浅色对比度 4.77；深色同样 ≥ 4.5。
- 预算提示、compat 提示、正文的对比度均 ≥ 4.5；primary 保存按钮复用 #24 的 `label-primary-foreground` 断言。

## 说明

- 截图由 Chrome DevTools Protocol 直接采集运行中的 DSH Web 预览实例；输入、展开、删除确认与保存都是真实 DOM 操作。
- 基线实例链接 `f1de086` 的打包产物，变更实例链接本分支的 `lib/client.js`；两个实例的 provider、视口、主题与模型数据一致。
- 没有使用真实服务的模型列表、真实 API Key 或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址。
- `after-*-list.png` 与基线同为初始数据（`pro` 32K）；`after-*-saved-list.png` 是执行过一次真实编辑后的状态（`pro` 48K），用于展示保存后的列表同步。
