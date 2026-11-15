# 删除路由时一并清理密钥 — 视觉证据（工单 #26）

- 基线：`b99c9bc`（`origin/main`，`feat: 模型列表搜索与批量操作（工单 #25） (#53)`），打包产物 `lib/client.js` SHA-256 `4d435f43074f324b0c1cbb5ee940779fd8ad70028337c4242d1bb31b88b970e7`
- 变更：本分支 `agent/delete-route-cleanup-key-efdcc3f7b52f`，截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集，SHA-256 `2d0d8dd52bddb7d25f4e46c3ab80776355e1071680934953c5e81000da233e3e`（连续两次构建同值）
- 环境：Chrome 152.0.7977.64 headless，截图视口 1440×1100、设备像素比 1（`after-*-unset-failed.png` 用 1440×2000，见下文）；宿主 `--dsw-*` token 由仓库既有的 light / dark token 夹具提供，`color-scheme` 分别为 `light` / `dark`
- 场景：ModelPilot 设置页，十条占位路由（`primary-relay` / `beta-relay` / `gamma-relay` / `shared-relay` / `shared-other` / `env-relay` / `failing-relay` / `slow-relay` / `stale-relay` / `spare-relay`）。`shared-relay` 与 `shared-other` 共用 `SHARED_API_KEY`；`env-relay` 的密钥由环境变量提供（`writable: false`）；`failing-relay` 的删除会被宿主拒绝
- 数据：没有真实凭据或私人内容；`baseURL` 是 `https://*.invalid/v1` 占位地址，`apiKeyEnv` 只是引用名，凭据值是夹具里的占位串

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `b99c9bc` 的产物，after 为本分支产物），由与单测共用的最小 React 兼容渲染器渲染真实的 `Workbench` 组件树；宿主 token、命名空间 schema、`configForms` 快照与 `credentials.describe` / `unset` 由夹具提供。除 `lib/client.js` 外，before / after 两份页面的路由数据、视口、主题与夹具完全一致；展开路由设置、点「删除路由」、点确认、读回弹窗都是真实 DOM 操作。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；`credentials` 与 `scope.mutate` 是记录调用的夹具，不会写入真实凭据或配置文件。凭据值从未被读取或显示，弹窗里只有引用名。

复现：`test/client/route-delete-harness.mjs` 的夹具与本组截图同源（截图脚本在其基础上把调用改成可配置的凭据状态）。

## Before / After：同一条路由（`primary-relay`，3 个模型，密钥已配置）

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线：弹窗标题只有「删除路由」，正文只讲配置与模型条数，页脚「删除后不会影响其它路由。」；已配置的 `PRIMARY_RELAY_API_KEY` 不会被删除，也从未被提示 |
| `after-light-configured.png` / `after-dark-configured.png` | 变更后：标题写清是哪条路由（`删除路由「primary-relay」？`），正文「这会移除该路由的全部配置（3 个模型），并一并删除存储的密钥 PRIMARY_RELAY_API_KEY。密钥删除后无法恢复。」；按钮文字直接写后果「删除路由和密钥」 |

## 其余状态（变更后）

| 文件 | 说明 |
| --- | --- |
| `after-light-absent.png` / `after-dark-absent.png` | 没有存储的密钥（`beta-relay`）：正文「…（2 个模型）。它没有存储的密钥。」，按钮仍是「删除路由」；不会多发一次注定失败的 `unset` |
| `after-light-shared.png` / `after-dark-shared.png` | 密钥被别的路由共用（`shared-relay` 与 `shared-other` 共用 `SHARED_API_KEY`）：正文「密钥 SHARED_API_KEY 仍被其他路由使用（shared-other），将保留。」，配置照删 |
| `after-light-checking.png` / `after-dark-checking.png` | 正在读取密钥状态（`slow-relay`，`describe` 延迟 8s，截图取 1.5s 那一帧）：正文显示「正在检查是否存在存储的密钥…」，确认按钮禁用（浅色 / 深色下都是 danger 色的禁用态） |
| `after-light-unknown.png` / `after-dark-unknown.png` | 读取失败（`gamma-relay`）：正文「无法确认是否存在存储的密钥，因此只会删除配置。」，提示行带上宿主原因「（凭据服务不可用）」与残留风险；按钮仍是「删除路由」 |
| `after-light-unset-failed.png` / `after-dark-unset-failed.png` | `unset` 被宿主拒绝（`failing-relay`）：弹窗关闭、路由原样保留（模型列表仍在），页面底部红色提示「删除密钥失败：宿主拒绝删除（只读凭据）；路由配置未改动」。为把页面底部的提示一起截进来，这两张的视口是 1440×2000 |

## 验收判据对照

| 判据 | 证据 |
| --- | --- |
| 1 有密钥 → 先 `describe` 确认存在，再 `unset`，再 `unset` 配置，顺序固定 | `test/client/route-delete.test.mjs` 的 `assertDescribeThenUnset`：事件序列里 `unset` 之前只有 `describe`、之后紧跟 `mutate`；`after-*-configured.png` 的按钮文字 |
| 2 没有密钥 → 不调用 `unset`，只删配置 | `assertNoUnsetButMutate`（没有密钥的场景）+ `after-*-absent.png` |
| 3 `unset` 失败 → 不删配置，报「删除密钥失败…路由配置未改动」 | 「unset 失败 → 配置一条都不动」测试断言 `mutationsDelta === 0` 且路由仍在；`after-*-unset-failed.png` |
| 4 两条路由共用同一 `apiKeyEnv` → 不删密钥，配置照删，提示将保留 | `sharedAfter.events` 里没有 `unset`，`shared-other` 仍在；`after-*-shared.png` |
| 5 引用名取 `credentialRefOf(apiKeyEnv)`，为空才回落 `deriveKeyRef(routeId)` | `test/core/route-delete.test.mjs`：「apiKeyEnv 优先 / 空与纯空白回落派生」 |
| 6 不做前缀 / 通配删除，只删确定的 ref | 纯测试：「共用只做精确相等」；`unset` 断言只出现一个 ref |
| 7 删配置仍走 `buildRouteDeleteOps`，stale-route / last-route 守卫不变 | 既有 `test/projection/route-edit.test.mjs` 全部通过；浏览器测试「stale-route 守卫不变」断言此时不发任何凭据请求、不产生 mutate |
| 8 无密钥文案：全部配置（N 个模型）+ 没有存储的密钥，按钮「删除路由」 | `after-*-absent.png`；纯测试逐字断言 |
| 9 有密钥文案：全部配置 + 一并删除 REF + 无法恢复，按钮「删除路由和密钥」 | `after-*-configured.png`；纯测试逐字断言 |
| 10 共用密钥文案：密钥 REF 仍被其他路由使用，将保留，按钮「删除路由」 | `after-*-shared.png`；纯测试 |
| 11 读取中：正文「正在检查是否存在存储的密钥…」，确认按钮禁用 | `after-*-checking.png`；浏览器测试读回 `confirmDisabled === true`，读取完成后恢复可点 |
| 12 读取失败：正文「无法确认是否存在存储的密钥」，按钮仍是「删除路由」只删配置，并附一行提示 | `after-*-unknown.png`；浏览器测试断言提示行为与「不发 unset」 |
| 13 现有 612 项测试全部通过 | `node --test 'test/**/*.test.mjs'`：656 tests，650 pass，6 skipped，0 fail（既有 612 项全部保留，新增 44 项） |

## 测试与产物验证

```text
$ node --test 'test/**/*.test.mjs'
ℹ tests 656
ℹ pass 650
ℹ fail 0
ℹ skipped 6

$ node scripts/build-client.mjs   # 连续两次
2d0d8dd52bddb7d25f4e46c3ab80776355e1071680934953c5e81000da233e3e
2d0d8dd52bddb7d25f4e46c3ab80776355e1071680934953c5e81000da233e3e

$ node scripts/verify-package.mjs .
PASS 1 … PASS 18
```

新增测试：

- `test/core/route-delete.test.mjs`：20 项纯规则（引用名来源、共用判定与精确匹配、删除目标、六种状态、只有 configured 才删、六套弹窗文案、失败原因、容错）；
- `test/client/route-delete.test.mjs`：24 项真实 DOM（light / dark 各 12 项：有密钥文案、取消不写、describe → unset → mutate 顺序、无密钥、读不到、共用、只读、unset 失败、读取中禁用、stale-route、token 对比度、最终路由集合）。

## 本批没有做

- 没有改 `deriveKeyRef` —— 直接复用 `src/core/api-key.js` 的宿主镜像规则；
- 没有做任何前缀 / 通配删除，只删「`apiKeyEnv` 或派生名」这一个确定的 ref；
- 没有在弹窗里显示密钥明文或部分明文，只有引用名；
- 额外处理了一种工单未列出的状态：密钥由环境变量提供（`writable: false`）时跳过 `unset`、保留密钥并只说清原因 —— 否则这类路由会永远删不掉（`unset` 必然失败，而规则一要求失败时不能删配置）。`after-*` 截图没有单独展示这一状态，由纯测试与浏览器测试的 `readonly` 用例固定。
