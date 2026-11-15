# 可达性残留、失效标注与列表性能 — 视觉证据（工单 #34）

- 基线：工单给定 `1e53d7c`（四个问题的测试先红以它为准）；视觉证据的 Before 使用当前 `origin/main` `3fc4b6b`（`fix: 批量操作可见性与安全边界（工单 #33） (#74)` 的合并提交，树与功能提交 `7e9db4d` 相同），打包产物 `lib/client.js` SHA-256 `7a6fd6b181e93cb51a8af308e512e6cb9bcc946ec126e3206346b24cc4a56820`
- 变更：本分支功能提交 `349b0f9`，截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集，SHA-256 `b8d53fd9bdcda7fb5f1df626edb2d9583724758389bb5aace3eae754a6640a36`（连续两次构建同值）
- 环境：Chrome 152.0.7977.64 headless，截图视口 1440×1200、设备像素比 1；宿主 `--dsw-*` token 由仓库既有的 light / dark token 夹具提供，`color-scheme` 分别为 `light` / `dark`
- 场景：一条占位路由 `preview-chat`，`baseURL` 为 `https://preview.invalid/v1`，9 条模型：
  - `acme` 组 3 条，摘要完全相同（窗口 131K · 输出 8K · text · 4 档 → 提到组头）；
  - `jxf` 组 3 条，前两条与 `acme` 共享摘要，第三条 `jxf/dsv4-pro-reason` 是混合摘要（窗口 200K · 输出 66K · text / image · 非推理）；
  - `tx` 组 2 条与无斜杠的 `standalone` 1 条。
- 数据：没有真实凭据或私人内容；`baseURL` 是 `*.invalid` 占位地址。

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为 `1e53d7c` 的产物，after 为本分支产物），由与单测共用的最小 React 兼容渲染器渲染真实的 `Workbench` 组件树；路由数据、宿主 token、`configForms` 快照、`scope.subscribe` 推送与 `remote.llm` 夹具完全一致，before / after 两份页面只有 `lib/client.js` 不同。`test/client/grouped-view-fixes-harness.mjs`、`test/client/grouped-view-cleanup-harness.mjs` 与截图同源。

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例；折叠 / 展开、删除写入、新增模型与表单提交都是真实 DOM 操作，配置写入由 `configForms.mutate` 夹具记录。浏览器原生 `title` 悬停提示和读屏输出不会被页面截图捕获；`title` / `aria-label` / sr-only 文本由 DOM 探针逐字读回（见下）。截图页面只隐藏了探针输出用的 `<pre id="result">`，它是测试脚手架，不属于产品界面。

## 问题二：分组消失后的折叠清理（像素可见差异）

同一操作序列：折叠 `acme` 与 `jxf` → 通过 `scope.mutate` 删除 `acme` 全部 3 条模型（折叠中的行不在 DOM 里，界面无法点击；这里走宿主的真实写盘与订阅路径）→ 再从「新增模型」表单加回 `acme/new`。

| 文件 | 说明 |
| --- | --- |
| `before-light-cleanup.png` / `before-dark-cleanup.png` | 基线：删除 `acme` 后，搜索态 effect 把 **所有** 折叠状态清空，`jxf` 也被展开；6 条剩余模型全部显示 |
| `after-light-cleanup.png` / `after-dark-cleanup.png` | 变更后：只剔除已消失的 `acme` key，`jxf` 保持折叠；列表只显示 `tx` 2 条与 `standalone` 1 条 |
| `before-light-add.png` / `before-dark-add.png` | 基线：加回 `acme/new` 后 `acme` 展开，但 `jxf` 仍是被错误展开的；`jxf` 的 3 条行全部可见 |
| `after-light-add.png` / `after-dark-add.png` | 变更后：新建的 `acme` 组默认展开（`aria-expanded="true"`，`acme/new` 可见），无关的 `jxf` 仍折叠（`aria-expanded="false"`） |

DOM 探针（light / dark 相同）：折叠与展开全程 `scope.mutate` 只有两次调用，分别是删除 `acme` 的 `set` 与新增 `acme/new` 的 `set`；折叠状态本身从不写配置。`afterDelete` 的组集合是 `jxf / tx / 其他`，`acme` 不存在；`afterAdd` 的组集合是 `acme / jxf / tx / 其他`，`acme` 为 `true`、`jxf` 为 `false`。

## 问题一 / 问题四：行容器属性（像素相同，语义变化）

这两处改的是行容器的可访问名与悬停提示，不改变任何可见像素；同一详细模式场景的前后截图逐字节相同：

| 文件 | SHA-256 |
| --- | --- |
| `before-light-detailed.png` / `after-light-detailed.png` | 均为 `8eef680167953d0cb23b117f5acac481b124237bc044a683780cfbc91c935999` |
| `before-dark-detailed.png` / `after-dark-detailed.png` | 均为 `569a52ea799b8a94a40117736f887dd360a4169adbc9be62f54803dd9da83674` |

这里的「Before / After」以 DOM 探针为准：

| 读回项（`acme/zeta`） | 基线 `1e53d7c` | 变更后 |
| --- | --- | --- |
| 行容器 `aria-label` | `模型 acme/zeta。窗口 131K · 输出 8K · text · 4 档` | `null`（不存在） |
| 行容器 `title`（详细） | `acme/zeta` | `null`（不存在） |
| 摘要 span `title`（详细） | `窗口：模型声明 131K\n输出：模型声明 8K\n模态：模型声明 text\n推理档位：模型声明 4 档` | 同左（保留） |
| 短 id `title`（详细） | `null` | `null`（不重复挂） |
| 紧凑 sr-only 摘要 | `窗口 131K · 输出 8K · text · 4 档` | 同左（保留） |
| 紧凑行容器 `title` | `null` | `null` |
| sr-only 节点数（详细） | `0` | `0` |

理由：行容器是无 `role` 的 `div`，映射到 ARIA `generic` 角色；ARIA 1.2 禁止 `generic` 拥有可访问名，所以基线的行级 `aria-label` 在浏览器无障碍树里会被丢弃，真正生效的只有紧凑模式的 sr-only 节点。变更按工单推荐方案 A 删掉这半死代码，摘要不再有第二个来源；详细模式的 `title={modelKey}` 也一并删除，悬停说明只由摘要 span 保留。方案 B（加 `role="group"` 保留 `aria-label`）不采用：它为命名而改变每一行的语义，摘要也只剩可访问名一个通道。

## 问题三：`planBulkFields` 的选中扫描

纯逻辑改动，无视觉变化。`test/core/model-bulk.test.mjs` 用 2000 条模型、选中 1000 条断言：返回值仍是完整 2000 条、未选中的 1000 条为同一引用、选中项字段已改；另一个用例直接观察 `Array.prototype.includes` 的调用次数，基线为 2000 次，变更后为 0 次（`selected.has(index)`）。既有 `changed` 的 index/id 顺序断言全部保持通过。

## 验证

```text
$ node --test "test/**/*.test.mjs"
ℹ tests 820
ℹ pass 813
ℹ fail 0
ℹ skipped 7

$ node scripts/build-client.mjs   # 连续两次
b8d53fd9bdcda7fb5f1df626edb2d9583724758389bb5aace3eae754a6640a36
b8d53fd9bdcda7fb5f1df626edb2d9583724758389bb5aace3eae754a6640a36

$ node scripts/verify-package.mjs .
PASS 1 … PASS 18（18/18）
```

工单给定基线 `1e53d7c` 的 790 项在改动前全绿；本分支 rebase 到当前 main 后完整套件 820 项（`#33` 新增 25 项 + 本单 5 项），全部通过。新增 / 更新的测试：

- `test/client/grouped-view-fixes.test.mjs`：更新紧凑 / 详细模式断言，新增「行容器没有 aria-label / title」「阅读顺序」「源码只有一个 sr-only 摘要来源」；
- `test/client/grouped-view-cleanup.test.mjs` + `grouped-view-cleanup-harness.mjs`：light / dark 各 1 项，覆盖折叠 → 删除全组 → 重建同名组；
- `test/core/model-bulk.test.mjs`：新增 2000 / 1000 引用与字段断言、`Set.has` 扫描次数断言。

## 本批没有做

- 没有继续给行容器加 `role="group"`（方案 B），也没有把摘要移进行级可访问名；
- 没有改变组头共享摘要与行内摘要的既有去重规则；
- 没有改 `planBulkDelete`、批量删除的写入语义或任何配置路径；
- 没有新增依赖或改 `package.json`。
