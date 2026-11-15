# 改密钥引用名时清理旧密钥 — 视觉证据（工单 #37）

- 基线：`09c7f18`（`origin/main`，`fix: 可达性残留、失效标注与列表性能（工单 #34） (#75)`），打包产物 `lib/client.js` SHA-256 `b8d53fd9bdcda7fb5f1df626edb2d9583724758389bb5aace3eae754a6640a36`
- 变更：本分支功能提交 `e340b2a`，截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集，SHA-256 `e5ecc6da1aa8f4bb6ae65fb5dd2283b4acafdef1562743d32c89181a2323c3e2`（连续两次构建同值）
- 环境：Chrome 152.0.7977.64 headless，截图视口 1440×1600、设备像素比 1；宿主 `--dsw-*` token 由仓库既有的 light / dark token 夹具提供，`color-scheme` 分别为 `light` / `dark`
- 场景：ModelPilot 设置页，两条占位路由（`relay` / `backup-relay`）。`relay` 有 3 个模型，`apiKeyEnv = RELAY_API_KEY`，凭据存储里已配置且可写。操作：展开路由设置 → 把「密钥引用」改成 `RELAY_KEY_V2` → 点「保存设置」
- 数据：没有真实凭据或私人内容；`baseURL` 是 `https://relay.invalid/v1` 占位地址，`apiKeyEnv` 只是引用名，凭据值是夹具里的占位状态（`{ configured, writable }`）

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `09c7f18` 的产物，after 为本分支产物），由与单测共用的最小 React 兼容渲染器渲染真实的 `Workbench` 组件树；宿主 token、命名空间 schema、`configForms` 快照与 `credentials.describe` / `unset` 由夹具提供。除 `lib/client.js` 外，before / after 两份页面的路由数据、视口、主题与夹具完全一致；展开路由设置、修改输入框、点保存 / 确认都是真实 DOM 操作。采集脚本临时放在 `/tmp`，复用 `test/client/layout-harness.mjs` 的 `SHIM_SOURCE` / `THEME_TOKEN_FIXTURE`，与 `test/client/key-rename-harness.mjs` 的夹具同源，未加入仓库。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；`credentials` 与 `scope.mutate` 是记录调用的夹具，不会写入真实凭据或配置文件。凭据值从未被读取或显示，弹窗里只有引用名。

## Before / After：同一操作（`relay`，改引用名 + 保存）

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线：点保存后立刻写配置，没有任何确认弹窗。路由卡片已经换成新引用名并回到「改动字段：无（保存已禁用）」，页面底部提示「已保存路由设置 relay（1 条 op）」。旧密钥 `RELAY_API_KEY` 仍留在凭据存储里（DOM 探针：`unset` 调用 0 次），而密钥区块只按新引用名查询，界面上再也看不到它 |
| `after-light.png` / `after-dark.png` | 变更后：同一操作先弹出二次确认「把密钥引用从 RELAY_API_KEY 改为 RELAY_KEY_V2？」，正文「保存后会删除旧密钥 RELAY_API_KEY，且无法恢复。新引用 RELAY_KEY_V2 还没有配置密钥，保存后需要重新填写。」，页脚「先删除旧密钥，成功后才写入新的引用名；删除失败会中止保存。」。弹窗出现时配置一条都没写（DOM 探针：`mutations = 0`、`unset` 调用 0 次） |
| `after-confirmed-light.png` / `after-confirmed-dark.png` | 确认后：先 `unset` 旧密钥、成功后才写新引用名；弹窗关闭，页面底部提示「已保存路由设置 relay（1 条 op），并删除旧密钥 RELAY_API_KEY」 |

DOM 探针（light / dark 相同）：点「保存设置」后、确认前的事件只有 `describe:RELAY_API_KEY`；确认后是 `describe:RELAY_API_KEY` → `describe:RELAY_API_KEY`（复核旧密钥仍存在）→ `unset:RELAY_API_KEY` → `mutate`（1 条 `set` 写 `apiKeyEnv`）。

## 其余状态的界面行为（由真实 DOM 测试覆盖）

| 状态 | 界面行为 |
| --- | --- |
| 取消确认 | 弹窗关闭；配置未写（`mutations` 不增加），旧密钥未删（`unset` 调用数 0），路由仍指向旧引用名 |
| 旧密钥被别的路由共用 | 不弹窗，配置照常保存；不调用 `unset`；toast「旧密钥 SHARED_API_KEY 仍被 shared-other 使用，已保留」 |
| 旧引用由环境变量提供（`writable: false`） | 不弹窗，配置照常保存；不调用 `unset`；toast「旧引用 ENV_KEY 由环境变量提供，无法删除」 |
| 旧引用读不到 | 不弹窗，配置照常保存；不调用 `unset`；toast「旧引用 UNKNOWN_KEY 的状态未能确认，可能仍保留在凭据存储中」 |
| 旧引用没有存储的密钥 | 不弹窗，配置照常保存；不调用 `unset`；toast 无附加说明 |
| 旧引用为空（首次设置密钥） | 不弹窗，不调用 `unset`；按普通字段修改保存 |
| 引用名没变（只改别的字段） | 不弹窗，不碰凭据存储 |
| `unset` 失败 | 中止保存：`mutate` 未被调用，路由仍指向旧引用名；toast「删除旧密钥失败：宿主拒绝删除（只读凭据）；路由配置未改动」 |

## 验收判据对照

| 判据（工单 #37） | 证据 |
| --- | --- |
| 保存前识别「引用名变了」：`plan.changed` 含 `apiKeyEnv`，且新旧 ref 都非空且不同 | `test/core/key-rename.test.mjs`「改引用名目标」四组；`test/client/key-rename.test.mjs`「引用名没变」「首次设置」 |
| 六种状态各自的判定 | `test/core/key-rename.test.mjs`：`unchanged` / `absent` / `movable` / `shared` / `readonly` / `unknown` |
| `keyRenameRemovesOldKey` 只在 `movable` 为真 | `test/core/key-rename.test.mjs`「只有 movable 才真的调用 `credentials.unset`」 |
| 共用判定复用 `routesSharingKeyRef` | `test/core/key-rename.test.mjs` 与 `test/client/key-rename.test.mjs`「共用」；客户端直接 import 该函数，没有第二套判定 |
| 确认弹窗文案 / `ariaLabel` / `badge` | `after-*.png`；`test/client/key-rename.test.mjs` 读回标题、正文、页脚、按钮文字 |
| 取消 → 配置未写、旧密钥未删 | `test/client/key-rename.test.mjs`「取消确认」断言 `mutations === 0`、`unset` 调用数 0 |
| 确认 → 先 `unset` 再 `mutate` | `assertDescribeThenUnset`：`unset` 之前只有 `describe`，之后紧跟 `mutate`，且只删一条 |
| `unset` 失败 → 中止保存、toast 报错 | `test/client/key-rename.test.mjs`「unset 失败」断言 `mutate` 未调用、配置仍是旧引用名 |
| 共用 / 只读 / 读不到 → 照常保存并 toast 说明 | 真实 DOM 测试三个场景 + 上文「其余状态」 |
| 旧 ref 为空 / 引用名没变 → 不弹窗 | 真实 DOM 测试「首次设置」「引用名没变」 |
| 既有 `route-delete` 六态文案与行为不变 | `test/client/route-delete.test.mjs`、`test/core/route-delete.test.mjs` 全部通过；`src/core/route-delete.js` 未改动 |
| `lib/client.js` 重建、`bundle.test.mjs` 通过 | 构建产物 SHA-256 如上；完整套件通过 |
| 全绿 / 18 PASS | 见下 |

## 验证

```text
$ node --test "test/**/*.test.mjs"
ℹ tests 858
ℹ pass 851
ℹ fail 0
ℹ skipped 7

$ node scripts/build-client.mjs   # 连续两次
e5ecc6da1aa8f4bb6ae65fb5dd2283b4acafdef1562743d32c89181a2323c3e2
e5ecc6da1aa8f4bb6ae65fb5dd2283b4acafdef1562743d32c89181a2323c3e2

$ node scripts/verify-package.mjs .
PASS 1 包名 … PASS 18 宿主 Config 模式（18/18）
```

工单给定基线 `1e53d7c` 的 790 项在改动前全部保留；本分支从 `origin/main` `09c7f18`（820 项）出发，套件 858 项，新增 38 项（`test/core/key-rename.test.mjs` 18 项 + `test/client/key-rename.test.mjs` 20 项，light / dark 各跑一遍），0 fail。宿主侧测试需要的 `@deepseek-ai/*` 包由仓库既有的安装锚点（`scripts/host-anchor.mjs`）从本机 DSH 安装解析，未新增仓库依赖。
