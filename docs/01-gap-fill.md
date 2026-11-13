# 01 — `Gap` `Fill`：U1–U6 补料与残余验证

日期：2026-11-10。方法与证据标签沿用 `dsh-compat-audit` 规则。补料材料：从 `npm` 公共注册表下载的 10 个包 × 2 个版本（0.2.0-rc.2 / 0.2.1-rc.2）的 `tgz`，解压于 `modelpilot-tmp-npm\extracted\<pkg>\<ver>\package\`。

## U1 源码可得性 — ✅ 关闭（公开发布，全量可得）

[已执行-探针] 对 9 个目标包逐一运行 `npm view @deepseek-ai/<pkg> versions --json`：**全部公开发布**，版本谱系完整（0.0.1-rc.1 → 0.2.2-rc.1），均含 0.2.0-rc.2 与 0.2.1-rc.2 精确版本。`npm pack` 实际下载 10 包 × 2 版本 = 20 个 `tgz`（含 `client-ui-settings-models` 作参照）。原始清单落盘 `modelpilot-tmp-u1-npm-versions.txt`。

**影响**：原审计中所有"仅 `zip` 部分"的[无法确认]（`ui-slots`、`typert` 链路、`llm-deepseek`）全部升级为可核对。后续跨版本结论不再需要"最近邻差异"近似，也不需要用户去另一台机器补打包。

## U2 `dsh-client-ui-slots` 0.2.1 — ✅ 关闭（两版逐字节相同）

[已核对-源码] `lib/index.js` 两版 MD5 **相同**（23,461 B，577 行，逐行 `diff` = 0）；仅 `lib/types/*.d.ts` 有少量注释增量（`index.d.ts` 51,503→51,719 B，`renderer.d.ts` 12,618→12,958 B，均为类型声明层）。`slots.inject / slots.register` 的签名与行为不变。

**结论**：插槽协议跨 0.2.0／0.2.1 完全稳定；B1／B4 设计可按单一签名面编写，无需兼容层。消费端证据（`settings-models` 两版同构的 `ctx.slots.inject("settings.section", …)` 调用）与之互相印证。

## U3 `typert` 链路 0.2.1 端到端 — ✅ 关闭（核心注册面不变，0.2.1 增量为纯追加）

[已核对-源码]

| 包 | 两版对比 | 判定 |
| --- | --- | --- |
| `dsh-typert-registry` | 导出集合相同（`TypertRegistry, default, typertEndpoint, typertKey, typertPackageKey`）；`register(contribution)`（0.2.0 L398 / 0.2.1 L453）与 `remotes.register→register(ctx, contribution)`（两版均自 L141 起）**区块逐字相同**；0.2.1 新增 `ctx.typert.resources`（资源种类线上字段登记，0.2.0 无）与 `lookups/contexts` 注释扩展；重复注册的错误串一致 | 核心注册面不变；**增量不破坏** |
| `dsh-typert-loader` | 导出集合相同（`Config, TYPERT_HOST_EXPORT, apply, inject, name, validateTypertManifest`）；行数 351→374（`./typert` 导出扫描与清单校验逻辑同一形态） | 不变（轻微增强） |
| `dsh-typert-protocol` | 0.2.1 **新增** `./remote-info`、`./remote-access` 子路径导出与 `principal` 模块；`Remote/RemoteError/RemoteScope/TypertRemoteService/remoteMethods` 主导出面维持 | 追加型 |
| `dsh-api-gateway` | 路由核心一致：`endpointOf(request.namespace, request.method)`（0.2.0 L963 / 0.2.1 L1170）；`typertRemote` 绑定扫描（binding.namespace 校验 → `remoteMethods(original)` 枚举 → `claims` 注册，0.2.0 L713-716 / 0.2.1 L902-905）同构；0.2.1 行数 1565→1830，新增 `resources` 解析 | 校验路径不变 |

**结论**：第三方 `Remote` 命名空间注册路径（`Service` `extends` TypertRemoteService → bindTypertRemote → `gateway` 的 `<namespace>/<method>` 路由）在两版**端到端成立**。B1 设计按 0.2.0 已验证的注册流程实现即可，0.2.1 无需特判；`remote-info` 仅可用于守卫／收窄，不作为依赖。

## U4 `llm-deepseek` 投影 — ✅ 关闭（两版同构 + 字段集已核）

[已核对-源码] `dsh-llm-deepseek` 两版（0.2.0 共 2283 行 / 0.2.1 共 2327 行）：

- `catalogModel` 条目字段（0.2.0 L297-308；0.2.1 重构为 `catalogModelFields` + `catalogModel = { id(required), ...catalogModelFields, inputModalities }` L312-315，**字段集相同**）：`id, name, description, contextWindow, maxTokens, inputModalities({text,image}[]), imagePixelBudget, imageMaxBytes, systemPromptUpdate("in-history"), toolUpdate("in-history"|"addition-only")`。
- `Config` 路由级（两版同）：`baseURL, thinking(enabled|disabled), reasoningEffort(off|low|high|max), maxTokens(default 256e3), defaultContextWindow(default 1e6), models[], streamIdleTimeoutMs, 文件/图片 offload 系列, retryPolicy`。
- **与 `pi-ai` 的差异（HostProjectionAdapter 的 `deepseek` 投影规则）**：
 1. 字段名不同：`inputModalities`（不是 `input`）；没有 `reasoningEfforts` 字典，推理是**路由级** `thinking: enabled|disabled` + `reasoningEffort: off|low|high|max` 四值枚举（档位集合≠`pi-ai` 的七档，无 `minimal`／`medium`／`xhigh`）；
 2. 默认值不同：`maxTokens` 256e3 ／ `contextWindow` 1e6（`pi-ai` 为 32768 ／ 262144）；
 3. 无兼容闸门、无 `thinkingBudgets`、无 `modelOverrides`／`models` 互斥结构（`deepseek` 是单路由 `models` 数组）；
 4. 模型行额外字段 `imagePixelBudget/imageMaxBytes/systemPromptUpdate/toolUpdate`，插件白名单**不写**这些（保持最小写入面）。
 - `deepseek` 白名单投影 = `{name?, contextWindow?, maxTokens?, inputModalities?}` + 路由级 `reasoningEffort?`（四值枚举校验后）；`reasoningEfforts` 字典输入到 `deepseek` 投影时必须**报不支持**（档位系不同，禁止静默映射）。
- 两版 `diff` 为 44 行增量（文件接口／`offload` 相关），模型 `schema` 与推理字段零变化 → 投影规则两版通用 [已核对-源码]。

## U5 agent/request 降级设计定案 — ✅ 关闭（设计定案，无需运行时验证）

采纳提示词定案并落进 B5／B2 的设计约束：`RuntimePolicyAdapter`（P3+）以 `agent/request` 瀑布流为通道，但**必须按"可能被拒绝／可能不触发"设计**：

1. 监听注册后做**自检探测**（发起一次自身代理的请求，验证监听确实被调用；未生效则界面显式降级为"仅档案"，不静默）；
2. 所有经此通道的改写记录到台账（`via=agent/request`），可审计、可关闭；
3. 任何下游拒绝（例如未来宿主不变量收紧）只导致"该通道不可用"，不影响 settings 写路径与验证请求；
4. 首版（P0–P2）不实现该适配器，仅在数据结构中预留 `scope` 字段。
 状态：设计级关闭；运行时行为留到 P3 验证（[待验证-P3]）。

## U6 models.dev 来源 — ✅ 关闭（端点／字段实测）

[已执行-探针] `https://models.dev/api.json`（HTTP 200，匿名无鉴权；`api.models.dev` 子域不存在——v1 解析器端点定死为 `models.dev/api.json`）。实测响应结构（约 150KB+，全文溢出到临时文件供解析器 `fixture` 提取）：

- 顶层 = 提供方映射：`{ <providerId>: { id, env[], npm, api, name, doc?, models: { <modelId>: Model } } }`。
- Model 关键字段（实测确认存在）：`id, name, description, family, attachment(bool), reasoning(bool), reasoning_options: [{type:"toggle"} | {type:"effort", values:[...]} | {type:"budget_tokens", min?, max?}], tool_call, structured_output, temperature, release_date, last_updated, modalities: {input[], output[]}, open_weights, limit: {context, input?, output}, cost: {input, output, cache_read, cache_write?, tiers?}, status?:"deprecated", canonical_model_id, experimental?`。

**v1 解析器字段映射定案**（→ 证据结构）：

| models.dev 字段 | → 证据 |
| --- | --- |
| `limit.context` | `context: {tokens, semantics:"combined"}`，`status`=`declared`（models.dev 未区分输入／合并时按合并标注，语义未知兜底：若同时有 `limit.input` 则 `semantics`="`input`"） |
| `limit.output` | `outputLimit`，`declared` |
| `modalities.input[]` | `inputModalities`，`declared`（`pi-ai` 只认 `text`／`image`，解析器保留全量、投影层裁剪） |
| `modalities.output[]` | `outputModalities`，`declared` |
| `reasoning` + `reasoning_options` | `reasoning: {controls:[...]}`：`effort`→`efforts`=`values`；`toggle`→`toggle`；`budget_tokens`→`budget`{min,max}（仅入档案，不投影宿主） |
| `status:"deprecated"` | 冲突提示（不阻塞候选） |
| `cost` | 诊断屏展示，不入配置 |
| `release_date/last_updated` | `observedAt` |
| 提供方 `id/api/env` | `ModelKey.routeId` 候选 + 端点提示 |

缓存落点：`dshCachePath("modelpilot", "models-dev-v1.json")`；TTL 24h 软失效 + 保留最后可用快照（坏 JSON／截断不覆盖）；响应头若提供 ETag／304 则用之，否则按内容摘要去重。`fixture` 直接取本次响应节选（`llmtech`／`frogbot`／`crossmodel` 三个提供方，覆盖 effort／`toggle`／`budget` 三种 `reasoning_options` 与 deprecated／无推理变体）。

## 汇总

| U 项 | 状态 | 残余风险 |
| --- | --- | --- |
| U1 | ✅ 公开发布，20 个 tgz 补齐 | 无（后续版本另测） |
| U2 | ✅ 两版逐字节相同 | 无 |
| U3 | ✅ 注册面两版端到端一致，增量为追加型 | `remote-info` 等新导出不作为依赖（仅守卫用） |
| U4 | ✅ `deepseek` 字段集／默认值／档位系已核，两版同构 | 0.2.1 的 `deepseek` 运行时行为未跑（静态同构背书） |
| U5 | ✅ 设计定案 + 降级路径 | 运行时验证留 P3 [待验证-P3] |
| U6 | ✅ 端点／字段／映射定案，`fixture` 就绪 | 304／ETag 头未逐项确认（摘要去重兜底） |