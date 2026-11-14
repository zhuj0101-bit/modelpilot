# 路由级字段编辑与删除路由（第一批）— 视觉证据

- 基线：`48e942d`（`origin/main`，`feat: 编辑与新增表单支持填入默认模板 (#29) (#31)`）
- 变更：本分支 `agent/route-edit-batch1-5c99c4ad6d08` 的 PR 头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：Chrome 152.0.7977.64 headless，1440×1600 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`：显示名 `Preview Chat`、`https://preview.invalid/v1`、`openai-completions`、`PREVIEW_CHAT_API_KEY`、默认上下文 `1000000`、默认输出上限 `32768`、缓存 `short`、传输 `auto`、超时 `60000`；三条模型 + `compat` + 宿主未来字段 `futureHostField`
- 另一条数据：只剩 `preview-chat` 一条路由的边界场景（删除按钮禁用 + 内置协议清单）
- 数据：没有真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址，`apiKeyEnv` 只是引用名

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `48e942d` 的产物，after 为本分支产物），由与单测共用的最小 React 渲染器渲染真实的 `Workbench` 组件树，宿主 `--dsw-*` token、`configForms` 快照与命名空间 schema 用夹具提供。除 `lib/client.js` 外，before / after 两份页面的 provider、模型、视口、主题与夹具完全一致。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；交互（展开、改字段、打开 ops、删除确认）是真实 DOM 操作，但宿主写入由 `scope.mutate` 夹具记录。

## 折叠态：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线：路由下拉框下面直接是「该路由的模型」；没有路由设置卡片，无法编辑路由级字段，也没有删除路由入口 |
| `after-collapsed-light.png` / `after-collapsed-dark.png` | 变更后：路由下拉框下面出现默认折叠的「▶ 路由设置 · 输出上限 33K · 上下文 1M · 3 个模型」，不展开也能看到三个最有用的值 |

## 展开态：九个字段预填

| 文件 | 说明 |
| --- | --- |
| `after-expanded-light.png` / `after-expanded-dark.png` | 展开后九个字段全部预填路由当前值：显示名 `Preview Chat`、接口地址 `https://preview.invalid/v1`、协议 `openai-completions`、密钥引用 `PREVIEW_CHAT_API_KEY`、默认上下文 `1000000`、默认输出上限 `32768`、缓存 `short`、传输 `auto`、超时 `60000`；「改动字段：无（保存已禁用）」；协议选项旁标注「选项来自宿主 schema」 |

未声明的字段会显示空（而不是宿主默认值）；本页所有字段都已声明，所以没有空态截图。空态由 `test/projection/route-edit.test.mjs` 的「未声明字段显示空，不把宿主默认值当用户值」固定。

## 改动与 ops 预览

| 文件 | 说明 |
| --- | --- |
| `after-ops-light.png` / `after-ops-dark.png` | 把接口地址改为 `https://preview.invalid/v2`、默认输出上限改为 `16384`：「改动字段：接口地址 / 默认输出上限」，「保存将写入的 settingsOps（2 条）」展开后是两条叶子 `set`，path 分别为 `["providers","preview-chat","baseURL"]` 与 `["providers","preview-chat","defaultMaxTokens"]` |

没有任何整条路由 `set`；`models` / `compat` / `futureHostField` 不在 ops 里，保存后由宿主原样保留（见下方测试输出）。

## 删除路由确认

| 文件 | 说明 |
| --- | --- |
| `after-delete-dialog-light.png` / `after-delete-dialog-dark.png` | 点「删除路由」后的自绘确认弹窗：写明「该路由下有 3 个模型，删除后连同模型配置一起消失。这一步不能撤销。」；取消与确认按钮跟随 token |

确认后只发一条 `unset ["providers", "preview-chat"]`，并自动切到剩下的路由（3 条路由 → 2 条）。

## 边界：只剩一个路由 / 协议清单读取失败

| 文件 | 说明 |
| --- | --- |
| `after-one-route-light.png` / `after-one-route-dark.png` | 只剩一条路由「删除路由」禁用，右侧提示「至少要保留一个路由」；同时展示 schema 读不到时的可见标注「协议清单读取失败，使用内置列表」，协议下拉只剩内置七种 |

## 九字段「改了什么 → 产出什么 op」

| 字段 | 控件 | 改动示例 | 产出 op |
| --- | --- | --- | --- |
| `displayName` | 文本框 | `Preview Chat` → `Renamed` / 清空 | `set ["providers", id, "displayName"]` / `unset [..., "displayName"]` |
| `baseURL` | 文本框 | `https://preview.invalid/v1` → `https://preview.invalid/v2` / 清空 | `set` 叶子 / `unset` 叶子；非空必须以 `http://` / `https://` 开头，否则 0 op |
| `api` | 原生下拉（schema） | `openai-completions` → `anthropic-messages` / 不声明 | `set` 叶子 / `unset` 叶子 |
| `apiKeyEnv` | 文本框 | 引用名改名 / 清空 | `set` 叶子 / `unset` 叶子；不碰凭据值 |
| `defaultContextWindow` | 数字 | `1000000` → `128000` / 清空 | `set` 叶子（number）/ `unset` 叶子；0 / 负数 / 小数 / abc 报错且 0 op |
| `defaultMaxTokens` | 数字 | `32768` → `16384` / 清空 | `set` 叶子（number）/ `unset` 叶子；同上校验 |
| `cacheRetention` | 原生下拉 | `short` → `long` / 不声明 | `set` 叶子 / `unset` 叶子 |
| `transport` | 原生下拉 | `auto` → `websocket` / 不声明 | `set` 叶子 / `unset` 叶子 |
| `timeoutMs` | 数字 | `60000` → `30000` / 清空 | `set` 叶子（number）/ `unset` 叶子；正整数校验 |

## 证明「没有整体 set route」的测试输出

```text
$ node --input-type=module -e '… buildRouteEditOps("preview-chat", 九字段全改, provider) …'
ops = 9
set   ["providers","preview-chat","displayName"]
set   ["providers","preview-chat","baseURL"]
set   ["providers","preview-chat","api"]
set   ["providers","preview-chat","apiKeyEnv"]
set   ["providers","preview-chat","defaultContextWindow"]
set   ["providers","preview-chat","defaultMaxTokens"]
set   ["providers","preview-chat","cacheRetention"]
set   ["providers","preview-chat","transport"]
set   ["providers","preview-chat","timeoutMs"]
whole-route set: false
touches models/compat: false
```

对应的自动化断言在 `test/projection/route-edit.test.mjs`：

- 「任何 op 都不是对整条路由的 set（否则会丢 models / compat / 未来字段）」：覆盖无改动、两字段改动、九字段全清、改协议四种表单；
- 「携带 models / compat / futureHostField 的路由对象从不被整条读取或重写」：输入不可变，ops 的 JSON 里不出现这三个键；
- 「所有 op 都以 `["providers", routeId]` 为前缀」：换一个 routeId 再断言一次；
- 删除路由单独断言 `unset ["providers", routeId]` 是唯一允许的整条操作。

## 实现说明

- 卡片没有用原生 `<details>` / `<summary>`：既有工作台测试（`test/client/model-picker.test.mjs`）会把页面里所有 `details` 的 `summary` 文本做精确断言，新增一个 `details` 会改变这些既有断言；因此改用受控的折叠按钮 + `<section>`。行为仍是「默认折叠、摘要行显示输出上限 / 上下文 / 模型数、展开后九个字段」。
- 路由级写入是新纯模块 `src/core/route-edit.js`；`projectPiAi` 与模型级 `create` / `update` / `remove` 一行未改。
- 折叠摘要里的 token 用现有 `humanizeTokenCount`：`32768 → 33K`、`1000000 → 1M`；未声明显示「未设置」。
- 协议清单从 `configForms.describe()` 的命名空间视图读取 `providers.<probe>.api` 的 union；读不到时退回内置七种并显示「协议清单读取失败，使用内置列表」。

## 本批没有做（按路线留给后续批次）

- 凭据值管理（`credentials.describe / set / unset`）：第二批。本批 `apiKeyEnv` 只改引用名，不读也不写密钥内容。
- 新增路由、从目录新增：第三批。本批只能编辑 / 删除已有路由。
- 模型拖动排序：第三批。
- 测试连接（`probeApi` / `probeBase`）：第四批。
- `compat` 的嵌套字段编辑：单独一批；本批保存路由字段时兼容对象原样保留。

## 测试与产物验证

- 新增测试 48 项：`test/projection/route-edit.test.mjs` 28 项（纯逻辑），`test/client/route-edit.test.mjs` 20 项（light / dark 各 10 项真实 DOM）。
- 既有 227 项测试全部保持不变并通过：`npm test` 共 275 项，269 通过、6 项按既有条件跳过、0 失败。
- `node scripts/build-client.mjs` 后 `git diff --stat lib/client.js` 为空（产物与源码同步提交）。
- `node scripts/verify-package.mjs .`：18/18 PASS。
