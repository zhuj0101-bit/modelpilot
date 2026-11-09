# B3 — 候选合成与来源（SourceRegistry / Parser / IdentityResolver / CandidateEngine / Rules / Memory / Intent）

状态：设计章节（纯设计，无实现）。上游依据：01-gap-fill.md（U2/U4/U6 实测结论）、b.md §5（IdentityResolver 匹配链定案）、R4/R5 产品需求。
证据标签沿用 dsh-compat-audit 规则：`[已核对-源码]` / `[已执行-探针]` / `[定案]` / `[推断-设计]` / `[待验证-P0]` 等。凡未标注者视为设计决策（[定案-设计]）。

---

## 0. 术语与不变式

- **ModelKey 五元组**：`{routeId, providerKind, protocol, rawModelId, resolvedModelId}`。R4 记忆与档案以 ModelKey 为键存储。
- **Candidate**：单个 DraftField 的一个取值提议，结构见 §4.2。
- **DraftField owner**：`generated | user-selected | user-edited`；伴随 `touched / locked` 布尔（R5）。
- **不变式 I1**：`rawModelId` 恒保留，任何解析、投影、存储都不改写它。
- **不变式 I2**：日期/区域/`-high`/`:free` 等后缀不剥离、不猜测；`auto`/`free` 别名不猜底模，只按原样保留并低置信标注。
- **不变式 I3**：冲突（多来源值不一致）**不合并、不静默择优**，一律并列展示并附原因（R5：只影响 pristine 字段）。
- **不变式 I4**：来源失败/数据异常**永不抛出中断候选合成**，降级为"该来源无候选 + Evidence 标注失败"。
- **不变式 I5**：预设（PresetSource）是**产品起点不是能力事实**——预设值永远不覆盖任何更高优先级候选，且 Evidence 上标 `preset` 而非 `declared`。

---

## 1. SourceRegistry（来源注册表）

### 1.1 定位

SourceRegistry 是候选合成前唯一的**外部事实采集层**。它不解析模型语义，只负责：拉取 → 校验 → 规范化 → 缓存 → 标注证据。每个来源实现统一接口：

```ts
interface ModelSource {
  id: "modelsdev" | "dsh-listing" | "local-profile" | "preset";
  /** 采集输入：路由上下文 / providerId 等 */
  fetch(ctx: SourceContext): Promise<SourceResult>;
  /** 本地缓存读取（不联网），供离线与降级路径 */
  readLocal(ctx?: Partial<SourceContext>): SourceResult | null;
}

interface SourceResult {
  schemaVersion: 1;
  sourceId: SourceId;
  fetchedAt: number;        // epoch ms
  digest?: string;          // 内容 sha256（去重与变更检测）
  status: "ok" | "stale" | "failed" | "empty";
  entries: NormalizedEntry[];   // 规范化条目
  evidence: Evidence;           // 源级证据（scope/source/freshness）
  errors?: SourceError[];       // 非致命错误清单（跳过的条目数等）
}
```

- **输入**：`SourceContext = { routeId, providerId?, protocol, settingsNs, signal }`。
- **输出**：`SourceResult`（schemaVersion=1，全部来源统一信封；parser 内部字段差异在 `NormalizedEntry` 上体现）。
- **失败模式**：网络失败/非 200 → `status:"failed"`；返回但解析全跳过 → `status:"empty"`；缓存命中但过期 → `status:"stale"`（附旧数据）。**任何失败不抛出**（不变式 I4），调用方（CandidateEngine）按 `status` 决定是否发起提示。
- **缓存策略**：各源自管（见 §1.2–§1.5），统一走 `dshCachePath("modelpilot", …)`。
- **证据标签**：源级 Evidence.scope = `"source"`；条目级 scope = `"entry"`。freshness 取 `fetchedAt`，缓存命中取缓存时 `fetchedAt`。

### 1.2 ModelsDevSource（models.dev v1）

[已执行-探针]（01-gap-fill U6）：端点 `https://models.dev/api.json`（HTTP 200 匿名；`api.models.dev` 子域不存在，v1 定死单端点）。

- **输入**：无需鉴权与参数；`SourceContext.signal` 透传 fetch 取消。
- **流程**：请求 → HTTP 200 校验 → JSON.parse → v1 parser（§2）→ digest 去重 → last-known-good 更新 → 返回。
- **输出**：`NormalizedEntry[]`，每条含 providerId / modelId / 实测字段映射结果（§2.1 表）。
- **失败模式**：
  - 非 200 / 网络错误 → `failed`，读 last-known-good 返回（`status:"stale"`，evidence 注明 `fallback: last-known-good`）；
  - JSON 坏 / 截断 / 结构不符（非 provider map）→ 同上，且**不覆盖 last-known-good**；
  - 部分条目非法 → 跳过非法条目，`status:"ok"`，`errors[]` 记录 `skipped:N`。
- **缓存策略**：
  - 落点 `dshCachePath("modelpilot", "models-dev-v1.json")`；
  - **24h 软 TTL**：过期不删，标记 `stale` 继续可用，后台可再拉；
  - **last-known-good**：只有 parser 完整成功才覆写缓存文件；坏 JSON/截断/结构异常一律保留旧档；
  - **digest 去重**：对响应体算 sha256，与缓存内 digest 相同则不重写文件、仅刷新 `fetchedAt`（避免无谓写盘与 UI 闪变）；
  - **ETag/304**：响应头带 `ETag` 则随请求回传 `If-None-Match`；304 时沿用缓存并刷新 fetchedAt；无 ETag 或头不支持时退化为纯 digest 兜底（[待验证-P0]：304/ETag 头未逐项确认，digest 兜底保证正确性）。
- **证据标签**：源级 `scope:"source", source:"models.dev/api.json"`，freshness=fetchedAt；条目级字段证据按 §2.1 映射（多为 `declared`）。

### 1.3 DshListingSource（宿主 discovery 封装）

[已核对-源码]（两版一致）：`ctx.remote.llm.discoverModels(settingsNs, request)`。
- **catalog 路由**：直接返回 `{id, name, contextWindow, maxTokens, inputModalities}[]`，不联网；
- **自定义路由**：`GET {baseURL}/models`（anthropic 走 `/v1/models?limit=1000`），行结构 `{id, name, contextWindow?, maxTokens?}`，**无 inputModalities**——自定义探测路径没有模态信息。

- **输入**：settingsNs + 当前路由配置（baseURL/协议）。
- **输出**：与 catalog 路由一一对应的 `NormalizedEntry`；自定义路由条目 `inputModalities = undefined`。
- **失败模式**：discover 抛错/超时 → `failed`；自定义路由 `/models` 404/401 → `failed`（evidence 注明 HTTP 状态）。空列表 → `empty`。
- **缓存策略**：**无本地缓存**（discovery 本身就是宿主实时面；自定义路由重复探测成本可接受，且结果可能随远端账号/权限变化）。v1 可选做会话级 memo（同 settingsNs + 同配置 hash 内 TTL 60s），防 UI 连续触发抖动。
- **证据标签**：
  - catalog 路由条目：`scope:"entry", source:"dsh-discovery:catalog"`，字段证据 `declared`；
  - 自定义路由条目：`source:"dsh-discovery:custom"`；因无模态信息，**Evidence 降级**——`inputModalities` 维度标注 `missing: "custom-route-no-modality"`，confidence 相应降一档（§4.2），UI 提示"自定义路由探测不返回模态信息"。

### 1.4 LocalProfileSource（本地档案）

- **输入**：ModelKey（五元组，见 §6）。
- **输出**：该 key 上一次保存的 Draft 快照（全部 DraftField 值 + 用户当时的 owner/touched 标记）。
- **失败模式**：无档案 → `empty`（不是失败）；存储损坏 → `failed` 并触发一次重建扫描（尽力而为）。
- **缓存策略**：本身即本地存储（DSH settings 持久层），无二级缓存；读取同步。
- **证据标签**：`scope:"entry", source:"local-profile"`，字段证据标 `observed`（用户曾确认过）+ `staleIfOlderThan`（档案保存时间距今 > 30 天时 freshness 降级提示，仅提示不改行为）。

### 1.5 PresetSource（预设三档）

[定案]（产品事实）：三档预设——
| 预设 | contextWindow | maxTokens | input | 模板 |
| --- | --- | --- | --- | --- |
| 基础 | 32768 | 4096 | text | inherit |
| 编码 | 131072 | 8192 | text | 另选 |
| 长对话 | 262144 | 16384 | text | 另选 |

- **输入**：presetId（`basic | coding | longchat`）。
- **输出**：固定 DraftField 值组 + `templateId`。
- **失败模式**：未知 presetId → `failed`（调用方 bug 级，开发期断言）。
- **缓存策略**：内联常量，无缓存。
- **证据标签**：所有字段证据 `scope:"entry", source:"preset", status:"preset"`——**绝不冒充 `declared`**（不变式 I5：预设是起点不是能力事实；UI 上展示为"推荐起点"而非"模型能力"）。

### 1.6 来源优先与事实等级

CandidateEngine 合成时按来源可信度排序（仅影响 confidence 初值，不改变并列展示义务）：

1. `local-profile`（用户亲自确认过的历史事实）→ observed
2. `dsh-listing:catalog`（宿主目录，declarative）→ declared
3. `modelsdev`（第三方目录，declarative）→ declared
4. `dsh-listing:custom`（远端 /models 探测，无模态）→ declared（模态维度 missing）
5. `preset`（产品推荐起点）→ preset

同级来源（2 vs 3）值冲突时，**不排序择优**，并列展示，由用户裁决（不变式 I3）。此排序只用于：候选默认选择、confidence 初值、UI 提示强度。

---

## 2. models.dev v1 Parser 规范

[已执行-探针] 全部字段以下列实测为准（01-gap-fill U6）。`schemaVersion = 1`；升级 schemaVersion 时必须重写 parser 并重新生成 fixture。

### 2.1 字段映射表（models.dev Model → NormalizedEntry）

| models.dev 字段（实测） | → NormalizedEntry / Evidence | 备注 |
| --- | --- | --- |
| 顶层 `{<providerId>: {id, env[], npm, api, name, doc?, models{}}}` | 逐 provider 展开；`provider.id`/`api`/`env` → `ModelKey.routeId 候选 + 端点提示` | `env[]` 仅提示需要的环境变量名，不存值 |
| `model.id` | `modelId`（必填，缺失即跳过该条目） | 原样保留，含日期/区域/后缀 |
| `model.name` | `name` | 缺失回退 `id` |
| `model.description` | `description`（诊断展示） | — |
| `model.limit.context` | `context: {tokens, semantics}` | 有 `limit.input` 时 `semantics:"input"`；否则 `semantics:"combined"` |
| `model.limit.output` | `outputLimit` | — |
| `model.modalities.input[]` | `inputModalities` | parser 保留全量（可能含 audio 等），**投影层再裁剪到 pi-ai 的 text/image** |
| `model.modalities.output[]` | `outputModalities` | 同上 |
| `model.reasoning` + `model.reasoning_options[]` | `reasoning: {controls:[…]}` | `effort`→`efforts=values`；`toggle`→`toggle`；`budget_tokens`→`budget{min,max}`。仅入档案与诊断，**不投影宿主**（宿主投影字段集见 U4） |
| `model.status:"deprecated"` | `status:"deprecated"` → 冲突提示 | 不阻塞候选；UI 显示"上游标记已弃用" |
| `model.cost`（含 tiers） | 诊断屏专用字段 | **不入配置、不入候选** |
| `model.release_date` / `model.last_updated` | `observedAt`（取两者较新者） | freshness 依据之一 |
| `model.canonical_model_id` | `canonicalModelId` | 供 IdentityResolver 二级解析（§3.4） |
| `model.family` / `attachment` / `tool_call` / `structured_output` / `temperature` / `open_weights` / `experimental` | 保留为 `meta`（诊断与规则匹配可读） | 不直接映射 DraftField |
| provider `doc` | 诊断屏链接 | — |

### 2.2 校验与容错规则

- **非法条目跳过，不整体失败**：单条 Model 缺 `id`、`limit.context` 非正整数、`modalities.input` 非数组等 → 丢弃该条目并计数；provider 级 `models` 缺失/非对象 → 丢弃该 provider；顶层非对象 → 整体 `failed`（走 last-known-good）。
- **坏 catalog 不替换 last-good**：JSON.parse 抛错、响应截断（末尾无完整 `}`）、顶层结构不符 → 缓存文件原样保留。
- **大小/结构异常阈值**（防投毒与内存放大，[推断-设计] 阈值为保守默认，Open Questions Q1）：
  - 响应体 > 10 MB → 视为异常，拒绝解析（正常 ~150KB+ 量级）；
  - 条目总数 > 5000 或单 provider models > 1000 → 拒绝（超出即视为结构异常，整体 failed）；
  - 单条目序列化 > 64 KB → 跳过该条目；
  - `reasoning_options` 数组长度 > 8 → 只取前 8 个 control 并记 warning；
  - 数值字段（context/output/budget min/max）超 `Number.MAX_SAFE_INTEGER` 或为负 → 条目跳过。
- **digest 去重**：parser 成功后计算整文档 digest，与缓存 digest 相同 → 只更新 `fetchedAt`，不重写 entries（§1.2）。
- **错误计数回传**：`SourceResult.errors[]` 每项 `{code:"skipped-entry"|"skipped-provider"|"oversize"|"bad-json", count, sampleId?}`，供诊断屏展示。

### 2.3 parser 输出 NormalizedEntry 结构

```ts
interface NormalizedEntry {
  schemaVersion: 1;
  sourceId: SourceId;
  providerId: string;          // models.dev provider id / dsh 路由 providerId
  modelId: string;             // 原样 rawModelId
  name?: string;
  context?: { tokens: number; semantics: "input" | "combined" };
  outputLimit?: number;
  inputModalities?: string[];  // 全量，投影层裁剪
  outputModalities?: string[];
  reasoning?: { controls: Array<
    | { type: "toggle" }
    | { type: "effort"; values: string[] }
    | { type: "budget"; min?: number; max?: number }> };
  status?: "deprecated";
  canonicalModelId?: string;
  observedAt?: string;         // ISO 日期
  meta?: Record<string, unknown>; // family/attachment/tool_call/…
}
```

---

## 3. IdentityResolver（五级匹配链）

[定案]（b.md §5）。输入：`{routeId, providerId?, protocol, rawModelId}` + 各 SourceResult。输出：`Resolution = { level, resolvedModelId, evidence, confidence, alternatives[] }`。**rawModelId 恒保留**（I1）；每级只产生 `resolvedModelId` 建议，不改动 rawModelId。

### 3.0 置信标记约定

每级产出：`confidence: "high" | "medium" | "low"` 与 `evidence.scope`。level 越靠后置信越低；多级同时命中时**取最高级结果为主解，其余进 `alternatives[]` 并列展示**（不合并，I3）。

### 3.1 Level 1 — 本地档案（local profile）

- 算法：以完整 ModelKey 查 LocalProfileSource；命中 → `resolvedModelId = 档案内 resolvedModelId`（档案保存值）。
- Evidence：`scope:"local-profile"`，confidence=**high**（用户曾确认过的组合），附档案时间戳。
- 注意：档案命中后仍继续跑 Level 2/3 做**交叉校验**，若目录侧该 key 已不存在（如模型下线），产出冲突提示并列（不覆盖档案，I3）。

### 3.2 Level 2 — exact 路由元数据（route metadata exact）

- 算法：DshListingSource 返回的条目中，`entry.modelId === rawModelId`（**大小写敏感全等**）→ 命中。
- Evidence：`scope:"route-metadata"`，confidence=**high**。
- catalog 路由与自定义路由都参与；自定义路由命中时模态维度 `missing` 标注随行。

### 3.3 Level 3 — 同 provider 目录条目（含 canonical_model_id 关系）

- 算法：
  1. 在 providerId 相同的目录条目（modelsdev 与 dsh-listing 合并域）内做**规范化等值**比较：`norm(id) = lowercase(trim(id))`；`norm(rawModelId) === norm(entry.modelId)` → 命中。
  2. **canonical_model_id 二级解析**：若条目存在 `canonicalModelId` 且指向同 provider 内另一条目 → 解析目标为 canonical 条目（如快照/别名条目指向主条目）；`resolvedModelId = canonical 条目的 modelId`，并保留 `via: "canonical"` 标记。
  3. 命中多个不同目标（norm 撞车）→ 全部进 alternatives，level 主解取 modelsdev 的 canonical 关系明确者，否则取 dsh-listing（来源优先 §1.6），confidence=**medium**。
- Evidence：`scope:"provider-catalog"`（含 `via:"casefold"` 或 `via:"canonical"`），confidence=**medium**。

### 3.4 Level 4 — 用户规则（user rules）

- 算法：加载规则库（§5），按优先级 exact > route > protocol > global 逐级匹配（见 §5.3）；首个命中规则生效。
- 输出：规则可改写 resolvedModelId（`route` 级规则含 `mapTo`），或仅给 DraftField 预设（`usePresetId`）。
- Evidence：`scope:"user-rule", ruleId`，confidence=**high**（用户显式意志，即使匹配是模糊的）——规则本身由用户维护，其意志高于启发式。
- 与 Level 1/2 冲突时：规则不覆盖已 high 的 exact/档案解，但**并列展示并提示规则存在**（用户可删规则；I3 并列不合并）。

### 3.5 Level 5 — family / fuzzy 低置信候选

- 算法：
  1. **family 匹配**：modelsdev 条目 `meta.family` 与 rawModelId 前缀（按 `-` 分段的前 1–2 段）一致 → 候选；
  2. **fuzzy 匹配**：norm 后做前缀/包含匹配（`rawModelId.startsWith(entryId)` 或反向），最多取 5 个候选，按编辑距离排序。
- Evidence：`scope:"fuzzy"`，confidence=**low**；UI 明示"低置信建议，请确认"。
- **auto/free 别名特殊处理**（I2）：`rawModelId ∈ {auto, free}` 或含 `:free` 后缀 → 不做 fuzzy，直接产出"请选择具体模型"的 proposal（§4.4），不猜底模。

### 3.6 匹配链总流程

```
resolve(ctx, sources):
  L1 = profile(ctx.ModelKey)            # high
  L2 = exactRouteMeta(ctx.rawModelId)   # high
  L3 = providerCatalogNorm(ctx)         # medium (casefold / canonical)
  L4 = userRules(ctx)                   # high (user will)
  L5 = familyFuzzy(ctx)                 # low
  primary = 最高 level 且非 empty 的结果
  alternatives = 其余非 empty 结果（并列展示）
  if all empty → unresolved → 进入 §4.4 proposal 流程
```

冲突语义：任何两级给出**不同** resolvedModelId → 两者都保留：主解按 level/confidence，次解入 alternatives，UI 并列 + 原因（scope 标签）。**永不自动合并或择优覆盖**（I3）。

---

## 4. CandidateEngine（候选合成引擎）

### 4.1 字段级合成顺序

对每个 DraftField（contextWindow / maxTokens / inputModalities / reasoningEfforts / …），候选按以下优先顺序合成（先生成者优先作为默认值，后者作 alternatives）：

```
1. touched/locked 保持  →  若字段已 touched/locked，跳过全部合成（R5）
2. 档案（LocalProfileSource）    → observed, high
3. route 声明（DshListingSource 条目字段）
4. provider 目录（ModelsDevSource 条目字段）
5. 规则预设（usePresetId 指向的 PresetSource 值）
6. 模板（长对话/编码等 draft 模板字段，若启用）
7. 预设三档默认（PresetSource，产品起点）
8. pi-ai 兜底常量（32768 / 32768*8=262144? 否——pi-ai 默认 262144/32768/text）
```

注意：3 与 4 同为 `declared`，冲突时**并列不择优**（I3）；默认选中按 §1.6 顺序（route 目录优先于 models.dev，因宿主目录更贴近实际路由行为）。第 8 级兜底用 pi-ai 默认 `{contextWindow: 262144, maxTokens: 32768, input: ["text"]}`，Evidence `scope:"builtin-default"`，confidence=low。

合成伪代码：

```
synthesize(field, ctx, sources):
  if ctx.intent.isTouched(field) or ctx.intent.isLocked(field): return keep-current
  cands = []
  if profile = sources.profile.get(ctx.ModelKey):
      cands.push(candidate(profile[field], origin:"profile", evidence:profile.evidence))
  for src in [dshListing, modelsDev]:
      if v = src.entryFor(ctx)?.[field]:
          cands.push(candidate(v, origin:src.id, evidence:src.evidence))
  if rule = ctx.matchedRule?.usePresetId:
      cands.push(candidate(preset(rule)[field], origin:"rule-preset", evidence:rule.evidence))
  if template = ctx.draftTemplate?.[field]:
      cands.push(candidate(template, origin:"template"))
  cands.push(candidate(piAiDefault[field], origin:"builtin", evidence:{scope:"builtin-default"}))
  dedupe(cands)                      # 相同值合并 origin 列表
  return rank(cands)                 # 见 §4.3
```

### 4.2 候选对象结构

```ts
interface Candidate<T = unknown> {
  value: T;
  origin: "profile" | "dsh-listing" | "modelsdev" | "rule-preset" | "template" | "preset" | "builtin";
  evidence: {
    scope: "local-profile" | "route-metadata" | "provider-catalog" | "user-rule"
         | "fuzzy" | "preset" | "builtin-default";
    source: string;          // 具体来源标识（models.dev/api.json、dsh-discovery:custom…）
    observedAt?: string;
    status: "declared" | "observed" | "preset" | "inferred";
    missing?: string;        // 如 "custom-route-no-modality"
  };
  confidence: "high" | "medium" | "low";
  via?: "canonical" | "casefold" | "fuzzy";
}
```

- **confidence 初值**：按 §1.6 来源序 + Evidence 降级（自定义路由无模态 → 该字段候选降一档；fuzzy → low）。
- **dedupe**：值全等的候选合并为一条，`origin`/`evidence` 保留数组（UI 可展示"两个来源一致"）。
- **rank**：confidence > 来源优先序 > observedAt 新者优先；同 confidence 同来源序 → 保持稳定序（不引入随机性）。

### 4.3 冲突展示（不合并）

同字段多候选值不等 → 全部保留：主候选 = rank 第一；其余按序展示于 UI 的"其他来源值"区，每项附 `{origin, evidence.scope, observedAt}`。用户选择任一 → 该字段转 `user-selected`（R5 owner 变更）。

### 4.4 未知模型必产 proposal

当 IdentityResolver unresolved（§3.6 all empty）或 fuzzy 无候选时，**必产 proposal 而非空字段**：

- `resolvedModelId = rawModelId`（原样透传，I1——不猜、不剥后缀）；
- DraftField 全部落到 pi-ai 兜底 + 预设默认值（owner=generated）；
- UI 顶部出"未识别模型"提示条：附 fuzzy 邻近候选（若有）+ "仍要使用原样 ID"按钮 + 提示可保存规则（引导进 §5 规则编辑）；
- 该 proposal 照常进入 R4 记忆（用户确认后，同 key 二次输入直接命中档案，不再提示）。

### 4.5 与宿主投影的边界

CandidateEngine 只产 DraftField 候选；投影到 pi-ai / deepseek 的裁剪规则（inputModalities→text/image、reasoningEfforts 档位系校验、reasoning_controls 不投影等）属于 B 系列其他章节（U4 投影定案），本章节不重复定义，只在 Evidence 上保留全量以供投影层读取。

---

## 5. 规则引擎（结构化规则）

### 5.1 规则 schema

```jsonc
{
  "schemaVersion": 1,
  "unknownPolicy": "keep-raw",          // 未知字段策略：keep-raw（默认，原样保留+提示）
  "defaultPresetId": "basic",           // 全局默认预设（可空）
  "rules": [
    {
      "id": "rule-uuid-or-slug",
      "match": { "routeId": "deepseek", "rawModelId": "deepseek-chat*" },
      "usePresetId": "coding",
      "reasoningProfileId": "budget-8k", // 可空
      "note": "人类可读原因（UI 展示用）"
    }
  ]
}
```

- `match.routeId`：精确等于路由 id；缺省 = 匹配所有路由（global 级）。
- `match.rawModelId`：**glob**（`*` 通配，单段；不支持 `?`/`[]`/`**`，见 5.3 glob 限制）；缺省 = 匹配所有模型。
- `usePresetId`：必须存在于 PresetSource 三档；非法值 → 规则加载报错并跳过该规则（单规则失败不整体失败）。
- `reasoningProfileId`：可空，指向 reasoning 档案（B 系列另章定义），仅校验存在性。
- `unknownPolicy`：v1 仅 `"keep-raw"`——遇到 schema 未知字段时保留原样并在诊断屏提示，**不丢弃、不猜测语义**。

### 5.2 优先级

`exact > route > protocol > global`（[定案] b.md §5）。判定规则：

1. **exact**：`match.routeId` 存在 **且** `match.rawModelId` 存在（无通配或通配但全等）；
2. **route**：仅 `match.routeId` 存在；
3. **protocol**：（v1 预留）match 含 protocol 字段时归此级——v1 schema 未定义 protocol 匹配字段，此级仅在排序器中占位；
4. **global**：两者皆缺省。

同 id 规则重复加载 → 后者覆盖前者并告警；同优先级多条命中 → **全部并列展示命中原因**（"规则 A 与规则 B 同时匹配：A 因 routeId 精确、B 因 glob 前缀"），执行顺序按规则数组序（用户可见、可拖动排序的确定序），不静默取一。

### 5.3 glob 限制

- 仅支持 `*`（匹配除 `/` 外任意字符——模型 id 不含 `/`，实际即任意后缀）；仅允许出现在**末尾**（前缀匹配语义），`*` 出现在中间/开头 → 该规则加载报 `invalid-glob`，跳过该规则；
- 长度上限：`match.rawModelId` ≤ 128 字符；规则数组 ≤ 200 条；单条规则 JSON ≤ 2 KB；
- 规则 id 全局唯一；`match` 两字段皆缺省的规则视为 global 且要求显式 `note`（防误配全局）。

### 5.4 规则与匹配链的关系

规则在 IdentityResolver Level 4 消费（§3.4）；规则产出的 `usePresetId` 同时进入 CandidateEngine 合成序（§4.1 第 5 级）。规则命中**永不覆盖** touched/locked 字段（R5 优先级最高，见 §7）。

---

## 6. R4 记忆键设计（ModelKey → 存储键）

### 6.1 ModelKey 与规范化

ModelKey 五元组：`{routeId, providerKind, protocol, rawModelId, resolvedModelId}`。

- **存储键规范化**：`storageKey = sha256(JSON.stringify([{routeId, providerKind, protocol, rawModelId, resolvedModelId}]))` —— 五元组按固定字段序序列化后整体哈希；`resolvedModelId` 参与键（同 raw 不同 resolved 视为不同记忆——例如 fuzzy 修正后是两条独立档案）。
- `rawModelId` **原样参与哈希**（保留大小写与后缀，I1；`DeepSeek-Chat` 与 `deepseek-chat` 是两条记忆——避免键层信息损失；若实测撞库过多可加二级索引，[待验证-P0] 观察项）。
- **脱敏**：ModelKey 与档案内容**不含 API key、headers、baseURL 凭据段**；`routeId` 是路由标识非密钥；审计面明文可读五元组原文（可逆——保留原键值的明文映射表 `storageKey → ModelKey 明文`，便于 UI 展示与清理，不含任何 secret 字段）。

### 6.2 档案内容与命中预填流程

档案（每 storageKey 一条）：

```ts
interface ModelProfileEntry {
  storageKey: string;
  modelKeyPlain: ModelKey;      // 明文五元组（无 secret）
  savedAt: number;
  draftFields: Record<DraftFieldId, { value: unknown; owner: Owner; touched: boolean; locked: boolean }>;
  resolvedVia?: Resolution["level"];  // 当时解析级别
}
```

命中预填流程：

```
onDraftOpen(routeCtx, rawModelId):
  key = ModelKey(routeCtx, rawModelId)             # resolvedModelId 先填 rawModelId 占位
  entry = profileStore.get(storageKey(key))
  if entry:
      for f in entry.draftFields:
          if f.locked or f.touched or f.owner != "generated":
              prefill(f, owner: f.owner, locked: f.locked, touched: f.touched)  # 原样回填标记
          else:
              prefill(f, owner:"generated")
      emit UI hint: "已按历史档案预填（savedAt …）"
      # 目录结果晚到时仍按 §7 算法合并（pristine 字段可被刷新）
  else:
      走正常 CandidateEngine 合成（§4）
  # 用户点击"保存档案"或首次成功验证请求后 → 写入/更新档案（R4 触发点）
```

- 同 key 二次输入**直接命中预填**（R4 定案）；命中不阻止目录刷新（pristine 字段晚到结果仍可更新，见 §7.2）。
- 写入时机：用户显式保存 / 首次验证请求成功（P0 用显式保存，自动写入留 Open Question Q4）。

---

## 7. R5 intent 跟踪

### 7.1 touched / locked 维护时机

| 事件 | touched | locked |
| --- | --- | --- |
| 用户在 UI 修改任一 DraftField 值 | 该字段 +touched | — |
| 用户点字段"锁定"控件 | （保持） | +locked |
| 用户解锁 | — | -locked |
| 用户从候选 alternatives 中选定一值 | +touched（owner→user-selected） | — |
| 用户再改回与候选主值相同 | touched 保留（防抖动；除非显式"重置为建议"） | — |
| 保存档案 → 重新打开 | 按档案回填 touched/locked（§6.2） | 同左 |
| generation 更换（route/ID/draftId 变） | 整组重置为新 generation 的初始状态 | 同左 |

`owner` 与 touched/locked 的关系：`user-edited ⇒ touched`；`user-selected ⇒ touched`；`generated` 可 pristine 可 touched（pristine = 未被用户碰过，晚到结果可覆盖）。

### 7.2 晚到响应合并算法

目录结果（DshListingSource / ModelsDevSource）晚于用户开始编辑到达时：

```
onLateSourceResult(result, generation):
  if generation != currentGeneration: drop            # 旧 generation 响应直接丢弃
  for (field, cand) in result.candidates:
      state = intent(field)
      if state.locked:      continue                  # 锁定字段永不覆盖
      if state.touched:     continue                  # 已改字段永不覆盖（R5 定案）
      # pristine generated 字段：可用更优候选刷新
      if rank(cand) > rank(current[field].candidate):
          apply(field, cand, owner:"generated", evidence:cand.evidence)
      else if rank(cand) == rank(current[field].candidate) and cand.value != current.value:
          conflictPool[field].add(cand)             # 并列池，提示不覆盖
  if result.introducesNewResolution(resolution):     # 例如 exact 命中晚到
      refreshIdentity(resolution)                   # 更新 resolvedModelId 展示 + alternatives
      # resolvedModelId 变更不回改 rawModelId（I1）
```

要点：晚到结果**只能影响 pristine 字段**；冲突进并列池供用户查看；identity 层（resolvedModelId/alternatives）可随时刷新，因为它是展示与建议层而非用户输入层。

### 7.3 generation 取消

- **generation = (routeId, rawModelId, draftId)** 三元组；任一变更 → 递增 generation。
- 所有异步来源请求（SourceContext.signal）与 CandidateEngine 合成任务绑定 generation；响应回来 generation 不匹配 → 直接丢弃（不合并、不更新 UI、不写档案）。
- UI 取消/关闭 draft → abort signal 触发；已 in-flight 的写入（档案保存）以 generation 校验兜底。
- 伪代码：

```
newGeneration(reason):
  gen = ++currentGen
  abortAllSourceFetches()
  resetIntentSets()          # touched/locked 清空（新 draft 上下文）
  kickOffSynthesis(gen)      # 重新合成
```

---

## 8. 证据标签汇总

| 章节 | 标签 | 依据 |
| --- | --- | --- |
| §1.2 §2 | [已执行-探针] | U6 实测端点与字段 |
| §1.3 | [已核对-源码] | discovery 两版一致 |
| §1.5 | [定案] | 预设三档产品事实 |
| §3 | [定案] | b.md §5 匹配链 |
| §4.1 第 8 级 | [已核对-源码] | pi-ai 默认 262144/32768/text |
| §1.2 ETag/304 | [待验证-P0] | digest 兜底已定案 |
| §2.2 阈值、§6.1 大小写键、§6.2 自动写档 | [推断-设计] / Open Questions | 保守默认 |

## 9. Open Questions 与保守默认

- **Q1 解析阈值**：10 MB / 5000 条目 / 1000 models per provider 阈值为保守估计（实测响应 ~150KB+ 量级）。默认：按 §2.2 执行；后续若合法增长触发误杀，按观测调整并记录变更。
- **Q2 ETag/304**：若实测 models.dev 不返回 ETag → 永远走 digest 去重（现状默认，无行为差异）。
- **Q3 同级冲突默认选中**：route 目录 vs models.dev 值冲突时主解默认取 route 目录（宿主面更贴近实际行为）；若实测发现 models.dev 更准的案例 ≥ 3 次，反转默认并在诊断屏记录。
- **Q4 档案自动写入**：P0 仅显式保存；"验证请求成功后自动写档"留待 P1 决策（涉及 R4 噪音 vs 便利）。
- **Q5 规则 protocol 级**：v1 占位不实现；待多协议路由实践后补充 match.protocol 字段。
- **Q6 storageKey 明文映射表**：默认保留明文映射（可逆、便于 UI/清理）；若审计要求不可逆存储，切换为纯哈希 + 列表侧缓存明文（改动局限 §6.1）。

**保守默认总原则**：所有未定参数取"最不惊讶"侧——坏数据不覆盖好缓存、冲突不合并、用户输入永不覆盖、未知结构保留并提示（unknownPolicy: keep-raw）。

---

## 10. P0-05 parser fixture 测试需求清单

fixture 源：U6 实测响应节选（llmtech / frogbot / crossmodel 三 provider，01-gap-fill §U6 定案）。落盘于 parser 测试目录，schemaVersion=1 固定。**必须覆盖的变体矩阵**：

| # | 变体 | 必须覆盖点 | 断言要点 |
| --- | --- | --- | --- |
| F1 | `reasoning_options: [{type:"effort", values:[...]}]` | effort 型（≥2 个值） | 映射 `reasoning.controls=[{type:"effort",values}]`；values 原样保留不排序 |
| F2 | `reasoning_options: [{type:"toggle"}]` | toggle 型 | 映射 `{type:"toggle"}`；无 values 字段 |
| F3 | `reasoning_options: [{type:"budget_tokens", min, max}]` | budget 型（含 min/max 均存在、仅 min、仅 max、全缺省 4 个子变体） | 映射 `{type:"budget", min?, max?}`；缺省字段不出现在输出 |
| F4 | `reasoning: true` 但 `reasoning_options` 缺失 | 无 options 的 reasoning 模型 | 产出 `reasoning:{controls:[]}`，不报错 |
| F5 | `reasoning: false` / 字段缺失 | 无推理能力模型 | 不产出 `reasoning` 键（或 controls 空，与 F4 输出一致化——实现取"不产出键"） |
| F6 | `status:"deprecated"` | 弃用标记 | 条目保留 + `status:"deprecated"`；候选合成不阻塞；冲突提示产出 |
| F7 | `limit.input` 存在 | semantics=input | `context.semantics="input"` |
| F8 | `limit.input` 缺失（仅 context/output） | semantics=combined | `context.semantics="combined"` |
| F9 | `limit.output` 缺失 | 无 outputLimit | `outputLimit` 键缺省，不填默认值 |
| F10 | `modalities.input` 含非 text/image（如 audio） | 全量保留 | parser 保留 audio；断言投影层裁剪责任不在 parser |
| F11 | `canonical_model_id` 指向同 provider 存在条目 | canonical 二级解析 | IdentityResolver L3 `via:"canonical"` 命中 |
| F12 | `canonical_model_id` 指向不存在条目 | 悬空 canonical | 忽略 canonical，条目正常保留 + warning |
| F13 | 大小写差异对（`Foo-Model` vs `foo-model`） | casefold 等值 | L3 casefold 命中，双条目都保留在目录 |
| F14 | `:free` / `-high` / 日期后缀 id | 后缀不剥离 | rawModelId 原样；fuzzy 允许前缀命中但标 low |
| F15 | `auto` / `free` 裸别名 | 不猜底模 | L5 直接跳过 fuzzy → proposal 流程（§4.4） |
| F16 | 非法条目族：缺 id / context 非正数 / modalities 非数组 / reasoning_options 超 8 项 | 跳过与截断 | 计数进 `errors[]`；整体 status=ok |
| F17 | 顶层坏结构：非 JSON / 截断 / 非 provider map / 超 10 MB | last-good 保护 | 缓存不覆写；SourceResult=failed+stale 回退 |
| F18 | provider 缺 `models` / models 为空对象 | 空 provider | provider 跳过（或产出空 entries + empty 标记）；不视为整体失败 |
| F19 | 重复 digest（同文档二次 fetch） | digest 去重 | 不重写缓存文件，仅刷新 fetchedAt |
| F20 | `cost` / `doc` / `family` / `attachment` / `experimental` 存在 | 诊断字段 | 入 meta/诊断，不出现在 DraftField 候选 |

**fixture 文件组织**：每变体一个最小 JSON 片段 + 一份合并全量 fixture（从 U6 实测响应裁剪）；F17 类坏文档单独目录（不进入正常加载路径）。P0-05 验收 = 全部 F1–F20 通过 + errors[] 计数准确。
