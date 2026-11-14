# API 密钥管理（平替第二批）— 视觉证据

- 基线：`b8b07a9`（`origin/main`，`feat: 工作台视觉重做：设计变量与三区块 (#35) (#37)`）
- 变更：本分支 `agent/api-key-management-7b3bb4e2358b` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：headless Chrome 152.0.7977.64，1440×1640 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`：显示名 `Preview Chat`、`https://preview.invalid/v1`、`openai-completions`、默认上下文 `1000000`、默认输出上限 `32768`、缓存 `short`、传输 `auto`、超时 `60000`；三条模型 + `compat` + 宿主未来字段 `futureHostField`
- 数据：没有任何真实凭据或私人内容。`baseURL` 是 `https://preview.invalid/v1` 占位地址，`apiKeyEnv` 只是引用名；密钥输入框在截图里是空 placeholder，**全程没有输入任何密钥值**。

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `b8b07a9` 的产物，after 为本分支产物），由与单测共用的最小 React 渲染器渲染真实的 `Workbench` 组件树；宿主 `--dsw-*` token、`configForms` 快照与 `remote.credentials` 响应由夹具提供。除 `lib/client.js` 外，before / after 两份页面的 provider、模型、视口、主题、schema 与夹具完全一致；after 的六个状态只在 `apiKeyEnv` 与 `remote.credentials.describe` 的返回值上不同。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；交互（展开、点设置 / 更换 / 清除、二次确认）是真实 DOM 操作，但凭据写入由 `remote.credentials` 夹具记录，没有真实凭据存储。只读状态（`writable: false`）由夹具模拟。

## Before / After 并排对照

| 文件 | 说明 |
| --- | --- |
| `compare-light.png` | 浅色主题：左＝基线（`b8b07a9`），右＝变更后，同一 `preview-chat` 路由、同一视口 |
| `compare-dark.png` | 深色主题：左＝基线，右＝变更后 |

基线里 `apiKeyEnv` 与协议同排，hint 是「只改引用名」，下面还有一行「ⓘ 只改引用名，密钥值在第二批管理；这里不读取也不写入任何密钥内容。」—— 用户看不到任何填真 key 的地方。

变更后 `apiKeyEnv` 独占一行并加宽到 360px（完整显示引用名），正下方是密钥区块：`密钥状态 ● 已配置  [更换] [清除]`。

## 六个 after 状态

| 文件 | 说明 |
| --- | --- |
| `after-light-configured.png` / `after-dark-configured.png` | 已配置且可写：`● 已配置` +「更换」「清除」 |
| `after-light-unconfigured.png` / `after-dark-unconfigured.png` | 未配置且可写：`○ 未配置` +「设置」 |
| `after-light-readonly.png` / `after-dark-readonly.png` | `writable: false`：`● 已配置（由环境变量提供，不可从此处修改）`；「更换」「清除」禁用（opacity 0.5，带 disabled 属性），下方标注「该引用来自部署的环境变量，这里只显示状态。」 |
| `after-light-suggestion.png` / `after-dark-suggestion.png` | `apiKeyEnv` 为空：输入框 placeholder 显示派生建议 `PREVIEW_CHAT_API_KEY`，下面一行「建议：PREVIEW_CHAT_API_KEY [采用]」；状态行是「未设置引用名，无法管理密钥」，没有任何写按钮。建议不自动填入 |
| `after-light-editor.png` / `after-dark-editor.png` | 点「更换」就地展开：`type="password"` + `aria-label="密钥值"` 的输入框、「取消」「保存密钥」，以及「ⓘ 密钥只写入宿主的凭据存储，不会出现在配置文件中。」 |
| `after-light-clear-dialog.png` / `after-dark-clear-dialog.png` | 点「清除」的自绘二次确认：写明要清除 `PREVIEW_CHAT_API_KEY`、清除后变为「未配置」且不能撤销；取消不调用 `unset`，确认后才调用 |

## 圆点：颜色 + 形状双重编码

| | 已配置 | 未配置 |
| --- | --- | --- |
| 字形 | `●`（实心） | `○`（空心） |
| 底色 | `--dsw-alias-state-success-secondary`（夹具 `#2f855a1f`） | `transparent` |
| 描边 | `--dsw-alias-state-success-primary`（夹具 `#2f855a`） | `--dsw-alias-border-l4`（夹具 `#00000026`） |

浅色与深色夹具下两种状态的字形、底色、描边都不同；`test/client/api-key.test.mjs` 在两套主题里各断言一次（不只比较颜色）。字形本身用 `label-primary`，保证作为状态文字也有足够对比度。

## 测试与产物验证

- `node --test 'test/**/*.test.mjs'`：**367 项**，361 通过、6 项按既有条件跳过、0 失败；新增 `test/core/api-key.test.mjs` 12 项、`test/client/api-key.test.mjs` 30 项。
- `node scripts/build-client.mjs` 连续两次：`lib/client.js` 的 SHA-256 均为 `0c54366bd1879048debec0856b18f7b9b79fcc95c777e2c5d030de2e1990fce5`（可重现；重建后 `git diff --stat lib/client.js` 为空）。
- `node scripts/verify-package.mjs .`：18/18 PASS（第 15 项 inject 列表已同步为 `slots,configForms,remote,remote.llm,remote.credentials`）。

## 说明

- **清除确认复用了同一套自绘确认外壳。** `DeleteConfirmDialog` 的文案写死了模型 / 路由语义（“从 route 删除模型 …”），直接复用它会在密钥语境里显示错误的对象。这里新增的 `ClearCredentialDialog` 与 `DeleteConfirmDialog`、`DeleteRouteDialog` 共用同一个 `ConfirmDialog` 外壳（自绘、Escape 关闭、焦点管理、危险按钮样式），只替换标题与正文，视觉效果和交互完全一致。
- **密钥值不进入截图、不进入 settingsOps。** 单测断言 `credentials.set` 收到用户输入的原样字符串（含首尾空格），而 `configForms.mutate` 的 op 序列化、`<pre>` 预览、localStorage / sessionStorage、页面可见文字都不含该字符串；宿主错误消息若回显输入，界面会把它替换成 `[已隐藏]`。
- **`apiKeyEnv` 的写入路径未改。** 「采用」只填表单；引用名仍随「保存设置」走 `configForms.mutate` 的叶子 `set`，本单只负责引用背后的值。
- **未做「测试密钥有效性」。** 保存后只重新 `describe` 刷新状态，不发任何请求验证 key 本身（属于工单 20）。
