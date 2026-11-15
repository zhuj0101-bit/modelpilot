# 全部路由总览与批量密钥状态 — 视觉证据（工单 #24）

- 基线：`75b3815`（`origin/main`，`feat: 推理档位支持自定义 API 参数值（工单 #23） (#49)`），打包产物 `lib/client.js` SHA-256 `880d867539f0e97dd54bbbd358bf76bf9987db482ccfe0ddba923f2c9307c716`
- 变更：本分支 `agent/routes-overview-8fcc83d369ab`（截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集，SHA-256 `474872a86266810e254a685dc1fdd325b082b60ac611c099b0c1cd108cd25031`）
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless（CDP `Page.captureScreenshot`），1440×1400 视口，设备像素比 1
- 场景：设置 → ModelPilot，六条占位路由（`zeta-chat` / `alpha-chat` / `beta-relay` / `gamma-local` / `delta-claude` / `epsilon-relay`），三条已配置密钥、三条未配置，其中 `delta-claude` 与 `epsilon-relay` 共用 `SHARED_API_KEY`
- 数据：两个独立临时 DSH profile；除 `lib/client.js` 版本外，provider、模型、凭据状态、视口与主题完全一致。`baseURL` 是 `https://preview.invalid/v1` / `http://127.0.0.1:11434/v1` 占位地址，没有访问任何模型服务；`apiKeyEnv` 只是引用名，凭据值是 `preview-*-value` 占位串，不是真实密钥

## 采集方式

截图不是 mockup：两个临时 DSH Web preview 实例分别链接基线 `75b3815` 的仓库副本与本分支的工作树，页面里跑的是真实打包产物 `lib/client.js`、真实宿主 `--dsw-*` token 与真实 `configForms` / `credentials.describe` 管道。打开设置、切换 ModelPilot、展开 / 收起总览、点行切换、切换浅色 / 深色都是真实 DOM 操作。

局限：实例使用临时 profile 与占位路由，不是用户的生产 DSH；`credentials.describe` 读到的是 `.credentials.yaml` 中写入的三条占位引用，其余引用显示未配置。凭据值从未被读取或显示。

## Light 主题：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-light.png` | 基线：ModelPilot 页面顶部直接是「当前路由」卡片；要比较六条路由的密钥状态，只能一条条切换后点开「路由设置」看 |
| `after-light-collapsed-fresh.png` | 变更后、首次打开：出现默认折叠的「▶ 全部路由（6 条）」；按验收 14，从未展开时不发 `describe`，因此还没有密钥计数 |
| `after-light-expanded.png` | 展开后：一次批量 `describe` 查完 5 个去重引用（`delta-claude` / `epsilon-relay` 共用 `SHARED_API_KEY` 只查一次）。行按路由 id 字母序；`gamma-local` 模型数为 0 显示「未设置」、协议为空显示「未指定」；密钥三态用「● 已配置 / ○ 未配置」区分；当前行 `zeta-chat` 有左侧品牌色竖线与「当前」徽标 |
| `after-light-collapsed-loaded.png` | 查询过一次后再折叠：摘要保留「全部路由（6 条 · 3 条密钥已配 · 3 条未配）」，并停止后续请求；再次展开才会重新读 |
| `after-light-switched-beta.png` | 点 `beta-relay` 行：总览保持展开，「当前」移到 `beta-relay`，下方「当前路由」下拉框、「路由设置 · 2 个模型」与「该路由的模型（2 条）」同步切换 |

## Dark 主题：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-dark.png` | 基线：与 light 同一场景，深色下同样没有总览 |
| `after-dark-expanded.png` | 变更后：同一份数据与交互在深色 token 下渲染；三种密钥状态的圆点、表头、hover 底色、当前行竖线都跟随 `--dsw-*` token |
| `after-dark-collapsed-loaded.png` | 折叠摘要保留三态计数，行为与 light 一致 |

## 默认折叠与摘要计数

工单同时要求「标题带一行摘要：全部路由（N 条 · X 条密钥已配 · Y 条未配）」与「总览折叠时不发 describe 请求」。两者在「首次打开、尚未展开」这一帧不可同时成立：没有查询就没有密钥状态，伪造计数会违反「未查询 ≠ 未配置」。因此：

- 首次打开（`idle`）：只显示「全部路由（6 条）」；
- 展开查询中（`loading`）：标题与表体都显示「正在读取密钥状态…」，不显示「未配置」；
- 查询完成后再折叠：摘要显示完整三态计数（`after-light-collapsed-loaded.png` / `after-dark-collapsed-loaded.png`）；
- 某一批读取失败（`partial`）：摘要追加「Z 条未知」，该批及之后显示「? 未知」，已成功批次不受影响，并提供「重试」。

## 密钥三态：文案 + 字形 + 颜色

| 状态 | 判定 | 显示 | 说明 |
| --- | --- | --- | --- |
| 已配置 | `configured === true` | `● 已配置` | 绿色描边 + 淡绿底 |
| 未配置 | `configured === false` | `○ 未配置` | 中性描边 + 无底色 |
| 未知 | 请求失败 / 该 ref 不在返回里 | `? 未知` | 告警色描边 + 淡告警底；绝不显示成「未配置」 |

`test/client/route-overview.test.mjs` 在 light / dark 两套宿主 token 下断言三种圆点与文案对比度均 ≥ 4.5（计算有效背景后的最差值）：

- light：已配置 `14.16` / `16.38`，未配置 `16.38` / `16.38`，未知 `11.23` / `16.38`
- dark：已配置 `9.91` / `13.03`，未配置 `13.03` / `13.03`，未知 `5.90` / `13.03`

行 hover 复用模型行的 `ROW_HOVER_MS = 120`，测试断言 `transition-property: background-color`、`transition-duration: 0.12s` 且 hover 后底色变化。

## 验收判据对照

| 判据 | 证据 |
| --- | --- |
| 1 路由设置卡片上方的折叠区，默认折叠 | `after-light-collapsed-fresh.png`、`after-dark-*`；DOM 断言 `▶ 全部路由（6 条）` |
| 2 每行：路由 id / 模型数 / 密钥 / 协议 / 切换按钮 | `after-light-expanded.png`；DOM 断言五列文案 |
| 3 行按路由 id 字母序 | `test/client/route-overview.test.mjs` 断言 `alpha-chat … zeta-chat`（夹具插入顺序故意以 `zeta-chat` 开头） |
| 4 模型数 0 显示「未设置」 | `gamma-local` 行 |
| 5 协议为空显示「未指定」 | `gamma-local` 行 |
| 6 单次 `describe` ≤ 64 个 ref | `describeBatches` 纯测试 + 浏览器断言 |
| 7 65 条 → 恰好 2 次（64 + 1） | 浏览器夹具 `batch65`，断言 `[64, 1]` |
| 8 128 条 → 恰好 2 次（64 + 64） | 浏览器夹具 `batch128`，断言 `[64, 64]` |
| 9 `apiKeyEnv` 为空用 `deriveKeyRef(routeId)` | `beta-relay` / `gamma-local` / 新增路由的 `THETA_ADDED_API_KEY`；DOM 断言 describe 参数 |
| 10 共用引用只查一次 | `delta-claude` / `epsilon-relay` → `SHARED_API_KEY` 只出现一次 |
| 11 某批失败 → 该批及之后「? 未知」，已成功不受影响 | `partial` 夹具：第一批 64 条已配置、第 65 条未知；重试后恢复 |
| 12 三态文案与圆点可区分（颜色 + 文案） | 上表与 `after-light-expanded.png`；测试断言字形 / 底色 / 描边不同 |
| 13 增删路由 / 改 apiKeyEnv / 设置清除密钥后自动刷新 | 浏览器夹具逐步断言新的 describe 参数与行文案；`after-light-switched-beta.png` |
| 14 折叠时不发 describe | 浏览器断言折叠前后 `describe` 调用次数不变 |
| 15 展开查询中显示「正在读取密钥状态…」，不显示「未配置」 | 延迟 400ms 的 `loading` 夹具；断言页面文本不含「未配置」 |
| 16 点行切换路由，下方同步 | `after-light-switched-beta.png`：下拉框、路由设置摘要、模型列表一起切到 `beta-relay` |
| 17 点当前行不做任何事 | 浏览器夹具点击当前行后选择器与 describe 次数不变 |
| 18 切换后总览保持展开 | `after-light-switched-beta.png` 中总览仍展开 |
| 19 既有 516 项测试通过 | `node --test 'test/**/*.test.mjs'`：566 tests，560 pass，6 skipped，0 fail |
| 20 新增 ≥ 20 项，总数 ≥ 536 | 新增 50 项（19 项纯规则 + 31 项真实 DOM），总数 566 |
| 21 产物可重现 + verify-package 18/18 | 连续两次构建 SHA-256 相同；`node scripts/verify-package.mjs .` 18/18 PASS |
| 22 三态圆点与文案对比度 ≥ 4.5；行 hover 反馈 | 上述对比度数值与 hover 断言 |

## 测试与产物验证

```text
$ node --test 'test/**/*.test.mjs'
ℹ tests 566
ℹ pass 560
ℹ fail 0
ℹ skipped 6

$ node scripts/build-client.mjs   # 连续两次
474872a86266810e254a685dc1fdd325b082b60ac611c099b0c1cd108cd25031

$ node scripts/verify-package.mjs .
PASS 1 包名 … PASS 18 宿主 Config 模式
```

新增测试：

- `test/core/route-overview.test.mjs`：19 项纯规则（引用名回落、字母序、去重、64 分批、三态判定、摘要文案、未知不混入未配）；
- `test/client/route-overview.test.mjs`：31 项真实 DOM（light / dark 各 12 项，partial 两种主题各 2 项，loading 1 项，65 / 128 条分批 2 项）。

## 本批没有做

- 总览只读：不编辑路由字段、不显示密钥明文或部分明文；编辑仍在下方「路由设置」卡片；
- `deriveKeyRef` 未改，直接复用 `src/core/api-key.js` 的宿主镜像规则；
- 没有新建独立设置页 slot；总览仍是 ModelPilot 单页的一部分，放在「当前路由」区块上方（该区块内含「路由设置」卡片）。
