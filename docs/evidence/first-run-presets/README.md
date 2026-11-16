# 首次装完即有内置模板与预设 — 视觉证据（工单 #40）

- 基线：`3d2bbca`（`origin/main`，`docs: 重写 README 为中文能力清单`）。
- 变更：本分支 `agent/first-run-presets-92e409e5a455` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集。
- 环境：headless Chrome 152.0.7977.64，单页视口 1440×1250，设备像素比 1；并排对照页 1960×900。
- 场景：Workbench 页面，路由 `preview-chat`，三条模型（`jxf/dsv4.1-flash` / `jxf/dsv4.1-pro` / `tx/deepseek-v4.1-flash`），`baseURL` 是 `https://preview.invalid/v1` 占位地址；`localStorage` 为空（没有用户存的默认模板），即首次安装后的状态。
- 采集方式：同一个夹具分别加载基线 `lib/client.js` 与本分支 `lib/client.js`；provider、模型数据、视口、主题与宿主 token 完全一致。截图由打包产物在真实 DOM 中渲染，不是手绘 mockup，但也不是 DSH 实时实例 —— 页面是设置页内嵌的 Workbench 组件本身，没有 DSH 的外壳 / 侧边栏。宿主 token 由 `test/client/layout-harness.mjs` 的夹具提供（与既有视觉证据一致）。
- 数据：没有真实凭据或私人内容。

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light-create.png` / `compare-dark-create.png` | 新增模型表单首次打开。基线（左）：三个模型字段之外没有任何起步值，上下文 / 输出为空，底部只有「尚未设置默认模板」和禁用的「填入默认模板」。变更后（右）：顶部出现 `[基础对话] [代码] [长文档]`，`基础对话` 高亮，表单已填 `128000 / 8192`，摘要为「内置模板：基础对话 · …」，`填入默认模板` 可用。 |
| `compare-light-edit.png` / `compare-dark-edit.png` | 编辑 `jxf/dsv4.1-flash` 的表单。基线（左）：「填入默认模板」禁用，提示「尚未设置默认模板，先在新增表单里「存为默认模板」」。变更后（右）：按钮可用，摘要为「内置模板：基础对话 · 上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high」。 |
| `compare-light-new-route.png` / `compare-dark-new-route.png` | 新建路由 →「自定义」。基线（左）：接口地址、协议、密钥引用全靠用户理解。变更后（右）：接口地址下方出现「常见格式：[OpenAI 兼容 …/v1] [Anthropic …/v1] [留空自己填]」，点一下同时填入 `/v1` 形状并切协议。 |
| `compare-light-empty.png` / `compare-dark-empty.png` | 一条路由都没有的首次打开。基线（左）：一行「当前没有配置模型路由。点「+ 新建路由」从内置目录添加，或直接自定义一条。」变更后（右）：补成三步可走通的路，并点名可先用「基础对话」预设。 |

## 交互与数据核对

| 维度 | 基线与变更后 |
| --- | --- |
| 预设数值 | 基础对话 `128000 / 8192 / text / off,low,medium,high`；代码 `200000 / 16384 / text / off,low,medium,high`；长文档 `1000000 / 8192 / text / off,low,medium,high` |
| 高亮来源 | `detectPreset` 对四个字段逐项比较；手改任一项后三个 chip 全部 `aria-pressed="false"`，不残留假状态 |
| 写配置 | chip / 预设只调表单 `setState`，全程 `mutations === 0`；「写入 DSH 设置」仍走原有单条 `set` 路径 |
| 默认模板回落 | 无 storage、空 storage、损坏 JSON、读取抛异常都回落到基础对话；用户存过合法模板时始终用用户的 |
| 模板摘要 | 用户模板「默认模板：…」；内置回落「内置模板：基础对话 · …」；两处（编辑 / 新增）共用同一个格式化函数 |
| 接口地址 chip | 只填 `https://你的中转站域名/v1` 形状，不编造具体域名；OpenAI 兼容切 `openai-completions`，Anthropic 切 `anthropic-messages`；手输过地址后点 chip 只提示不覆盖，「留空自己填」才清空并复位 |
| 预算提示 | 内置预设首次填出 `128000 / 8192` 时会出现预算提示；该提示原错误色前景在告警底上只有 3.72 对比度，改为继承主文字色（与 `s.warn` 一致），⚠ / 边框 / 底色继续承担告警语义 |

## 测试与产物验证

- `node --test "test/**/*.test.mjs"`：**984 项，977 通过、7 项按既有条件跳过、0 失败**。
  - 新增 **30 项**：`test/core/model-presets.test.mjs` 11 项、`test/client/preset-chips.test.mjs` 12 项（light / dark 各 6）、`test/client/new-route-presets.test.mjs` 6 项，`default-template.test.mjs` 净增 1 项（空 / 损坏 / 无 storage 回落 + 用户模板优先）。
  - 修改：`test/core/default-template.test.mjs`（空 / 损坏 / 无 storage 回落到内置预设，用户模板优先）、`test/client/template-fill.test.mjs`（首次打开即可填入内置模板；存过模板后摘要显示用户模板）。
- 新测试先在 `3d2bbca` 上确认红：把新测试与改动后的夹具放进基线树运行，**63 项中 31 项失败，32 项通过**。
  - 通过的 32 项是「用户模板优先」「模板摘要格式」「纯函数数值」这类本就不应改变的行为；其中 `model-presets` 的 11 项是因为临时把新模块放进了基线树，去掉模块后该文件直接 `ERR_MODULE_NOT_FOUND`。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `b1dd66641555b3f7ca07ea22bd4e3ff059f51e9c6304a71832b6f5fbd4468aaf`（可重现）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
- 未新增依赖；`package.json` 未改。

## 夹具说明（为什么动了两个既有夹具）

- `test/client/layout-harness.mjs` 与 `test/client/visual-harness.mjs` 原本用「没有默认模板」表示空表单。工单 #40 起，没有用户模板会自动填入内置基础对话，**空表单不再等于首次打开**。两个夹具各预置一份 token 为空的合法用户模板，继续测量原来的「提示行布局」与「列表摘要对比度」场景；`layout.test.mjs` / `visual-redesign.test.mjs` 的断言一行未改。
- `test/client/template-fill-harness.mjs` 的「无模板 / 禁用」场景按行为变更重写为「内置模板 / 可用」；按钮从新增表单底部移到顶部预设行旁边（工单要求的 `[chips] … [填入默认模板]` 布局），夹具的 `sameRow` 断言相应改为「与预设 chip 同一行」。
- `test/client/new-route-harness.mjs` 只新增 `custom-presets` 场景，既有场景未改。

## 说明

- 纯数据 / 纯函数在 `src/core/model-presets.js`，`default-template.js` 只负责回落；组件只接状态、样式与 DOM 属性。
- 预设没有接入 `candidates.js`（P1-07 的工作），也没有新增网络请求或宿主 schema 读取。
- 截图里的预算提示是 `128000 / 8192` 这个预设值经既有 `estimateContextBudget` 的真实结果，不是为截图造的文案。
