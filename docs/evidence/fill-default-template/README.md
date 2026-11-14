# 填入默认模板 — 视觉证据

- 基线：`9b2b28e`（`origin/main`，`feat: 模型编辑一期…` 的合并提交）
- 变更：本分支 `agent/fill-template-button-145327fe157f` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless（CDP `Page.captureScreenshot`），1440×1400 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`，三条模型：`jxf/dsv4.1-flash`（1M / 32K / text / 4 档）、`jxf/dsv4.1-pro`（1M / 32K / text / 4 档 + `compat.supportsReasoningEffort: true`）、`tx/deepseek-v4.1-flash`（128K / 8K / text / 无档）
- 默认模板：上下文 `1000000`、输出 `8192`、`text + image`、档位 `off,low`；通过新增表单的「存为默认模板」真实保存到 `localStorage["modelpilot.default-template.v1"]`
- 数据：两个临时 DSH profile；除 `lib/client.js` 版本外，provider、baseURL、视图、主题、模型数据与模板完全一致。没有真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址。

## 编辑表单：Before / After

基线的编辑表单完全没有模板 UI：已保存模板与未保存模板两种状态下，编辑表单显示相同，只有模型现有值。因此两者共用一张 `before-*-edit.png`；模板确实存在的依据见 `before-*-create.png` 底部的「默认模板：…」提示行（基线同样没有「填入默认模板」按钮）。

| 文件 | 说明 |
| --- | --- |
| `before-light-edit.png` / `before-dark-edit.png` | 基线：展开 `jxf/dsv4.1-pro`，窗口 `1000000`、输出 `32768`、`text`、四档；没有「填入默认模板」按钮，也没有模板摘要（模板是否已保存不改变编辑表单） |
| `after-light-edit-no-template.png` / `after-dark-edit-no-template.png` | 变更后：没有模板时按钮禁用，右侧显示「尚未设置默认模板，先在新增表单里「存为默认模板」」；点击不改变表单 |
| `after-light-edit-template.png` / `after-dark-edit-template.png` | 变更后：有模板时按钮可用，右侧显示 `默认模板：上下文 1000000（1M） · 输出 8192（8K） · text + image · off,low`（点击前） |
| `after-light-edit-filled.png` / `after-dark-edit-filled.png` | 变更后：点击「填入默认模板」后，五个模板字段全部变成模板值；显示名保持 `jxf/dsv4.1-pro`；「改动字段」列出 `输出上限 / 输入模态 / 推理档位` |
| `after-light-edit-filled-ops.png` / `after-dark-edit-filled-ops.png` | 变更后：展开 `settingsOps`，仍是 1 条 `set`，`value` 为完整行并保留 `compat.supportsReasoningEffort: true` |

### 点按钮前 / 点按钮后的字段对照

| 字段 | 点前 | 点后 |
| --- | --- | --- |
| 显示名 `name` | `jxf/dsv4.1-pro` | `jxf/dsv4.1-pro`（**不变**） |
| 上下文窗口 | `1000000` | `1000000` |
| 输出上限 | `32768` | `8192` |
| 输入模态 | `text` | `text + image` |
| 推理档位 | `off / low / medium / high` | `off / low` |
| `compat` | `supportsReasoningEffort: true` | 原样保留（见 ops 截图） |
| 改动字段 | 无（保存已禁用） | 输出上限 / 输入模态 / 推理档位 |

## 新增表单：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-light-create.png` / `before-dark-create.png` | 基线：点「清空」后五个字段回到模板值，按钮行只有「写入 DSH 设置」「清空」「存为默认模板」；没有回填按钮 |
| `after-light-create-filled.png` / `after-dark-create-filled.png` | 变更后：按钮行多出「填入默认模板」。点「清空」后手动把输出上限改成 `1234`，再点「填入默认模板」，五个字段恢复为模板值（窗口 `1000000`、输出 `8192`、`text + image`、`off / low`） |

## 边界语义：模板里为空的字段

`templateToForm` 原样返回模板的 `contextWindow` / `maxTokens` / `reasoningLevels`。因此模板里写成空字符串或空数组时，点「填入默认模板」会把编辑表单里的对应输入**清空**，而不是「只覆盖模板里有值的字段」；`reasoningLevels: []` 会让档位全不选，并显示原有的「全不选：不修改现有 reasoningEfforts」提示。

**一期写入语义的限制：** 工单 #26 的 `diffRow` 只产出正整数 token 的变化，`projectPiAi(update)` 以现有行为基底合并；被清空的 token 不会进入「改动字段」，也不会在保存时清除模型现有值。工单 #29 明确要求「不动 `formFromModel` / `diffRow` / `projectPiAi`」，所以这里保留表单级如实清空、写入侧仍只支持修改。该边界在 `test/client/template-fill.test.mjs` 的「模板空 token / 空档位如实清空表单（一期不写清空）」中固定，测试同时断言保存保持禁用、ops 为 0 条，避免误导为「保存会清空字段」。

## 测试与产物验证

- `node --test test/client/template-fill.test.mjs`：18 项通过（light / dark 各 9 项），覆盖按钮可用 / 禁用、模板摘要、五个字段替换、显示名不变、改动字段、幂等、取消不写入、保存完整行 + compat、空 token 边界、主题 token 与对比度。
- `npm test`：227 项测试，221 通过、6 项按既有条件跳过、0 失败。
- `node scripts/build-client.mjs` 后 `git diff --stat lib/client.js` 为空（`lib/client.js` 与源码同步提交）。
- `node scripts/verify-package.mjs .`：18/18 PASS。

## 说明

- 截图由 Chrome DevTools Protocol 直接采集运行中的 DSH Web 预览实例；保存模板、展开编辑、点「填入默认模板」、清空、保存都是真实 DOM 操作。
- 基线实例链接 `9b2b28e` 的打包产物，变更实例链接本分支的 `lib/client.js`；两个实例的 provider、视口、主题与模型数据一致。
- 没有使用真实服务的模型列表、真实 API Key 或私人内容。
