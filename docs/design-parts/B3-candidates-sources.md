# B3 — 候选合成与来源（SourceRegistry / Parser / IdentityResolver / CandidateEngine / Rules / Memory / Intent）

状态：设计章节（纯设计，无实现）。上游依据：`01-gap-fill.md`（U2／U4／U6 的实测结论）、b.md §5（身份解析器匹配链的定案）、R4／R5 的产品需求。
证据标签沿用 dsh-compat-audit 的规则：`[已核对-源码]` / `[已执行-探针]` / `[定案]` / `[推断-设计]` / `[待验证-P0]` 等。未标注的一律视为设计决策（[定案-设计]）。

---

## 0. 术语与不变式

- **ModelKey 五元组**：`{routeId, providerKind, protocol, rawModelId, resolvedModelId}`。R4 的记忆与档案都以 ModelKey 为键存储。
- **候选（Candidate）**：对单个 DraftField 提出的一个取值建议，结构见 §4.2。
- **DraftField 的 owner**：`generated | user-selected | user-edited`；同时伴随 `touched / locked` 两个布尔（R5）。
- **不变式 I1**：`rawModelId` 恒保留，任何解析、投影、存储都不改写它。
- **不变式 I2**：日期／区域／`-high`／`:free` 等后缀不剥离、不猜测；`auto`／`free` 别名不猜底模，只按原样保留并做低置信标注。
- **不变式 I3**：冲突（多来源取值不一致）**不合并、不静默择优**，一律并列展示并附原因（R5：只影响未触碰字段）。
- **不变式 I4**：来源失败／数据异常**永不抛出中断候选合成**，降级为"该来源无候选 + 证据标注失败"。
- **不变式 I5**：预设（PresetSource）是**产品起点而不是能力事实**——预设值永远不覆盖任何更高优先级的候选，且证据上标 `preset` 而不是 `declared`。

---

## 1. SourceRegistry（来源注册表）

### 1.1 定位

来源注册表是候选合成之前唯一的**外部事实采集层**。它不解析模型语义，只负责：拉取 → 校验 → 规范化 → 缓存 → 标注证据。每个来源实现统一的接口：

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
- **输出**：`SourceResult`（`schemaVersion=1`，所有来源统一信封；解析器内部的字段差异体现在 `NormalizedEntry` 上）。
- **失败模式**：网络失败／非 200 → `status:"failed"`；有返回但解析全部跳过 → `status:"empty"`；缓存命中但已过期 → `status:"stale"`（附旧数据）。**任何失败都不抛出**（不变式 I4），调用方（候选引擎）按 `status` 决定是否发起提示。
- **缓存策略**：各来源自管（见 §1.2–§1.5），统一走 `dshCachePath("modelpilot", …)`。
- **证据标签**：来源级 `Evidence.scope = "source"`；条目级 `scope = "entry"`。新鲜度取 `fetchedAt`，缓存命中时取缓存时的 `fetchedAt`。

### 1.2 ModelsDevSource（models.dev v1）

[已执行-探针]（01-gap-fill U6）：端点 `https://models.dev/api.json`（HTTP 200，匿名；`api.models.dev` 子域不存在，v1 定死单端点）。

- **输入**：无需鉴权与参数；`SourceContext.signal` 透传给 fetch 做取消。
- **流程**：请求 → 校验 HTTP 200 → `JSON.parse` → v1 解析器（§2）→ 摘要去重 → 更新最后可用快照 → 返回。
- **输出**：`NormalizedEntry[]`，每条包含 `providerId`／`modelId`／实测字段的映射结果（§2.1 表）。
- **失败模式**：
 - 非 200／网络错误 → `failed`，改读最后可用快照返回（`status:"stale"`，证据注明 `fallback: last-known-good`）；
 - JSON 损坏／截断／结构不符（不是提供方映射）→ 同上，且**不覆盖最后可用快照**；
 - 部分条目非法 → 跳过非法条目，`status:"ok"`，`errors[]` 记 `skipped:N`。
- **缓存策略**：
 - 落点 `dshCachePath("modelpilot", "models-dev-v1.json")`；
 - **24 小时软 TTL**：过期不删，标记 `stale` 继续可用，后台可再拉；
 - **最后可用快照（last-known-good）**：只有解析器完整成功才覆写缓存文件；坏 JSON／截断／结构异常一律保留旧档；
 - **摘要去重**：对响应体算 sha256，与缓存内的摘要相同则不重写文件、只刷新 `fetchedAt`（避免无谓写盘与界面闪变）；
 - **ETag／304**：响应头带 `ETag` 时，请求回传 `If-None-Match`；收到 304 就沿用缓存并刷新 `fetchedAt`；没有 ETag 或头不支持时退化为纯摘要兜底（[待验证-P0]：304／ETag 头尚未逐项确认，摘要兜底保证正确性）。
- **证据标签**：来源级 `scope:"source", source:"models.dev/api.json"`，新鲜度 = `fetchedAt`；条目级字段证据按 §2.1 映射（多为 `declared`）。

### 1.3 DshListingSource（宿主 discovery 的封装）

[已核对-源码]（两版一致）：`ctx.remote.llm.discoverModels(settingsNs, request)`。
- **目录路由**：直接返回 `{id, name, contextWindow, maxTokens, inputModalities}[]`，不联网；
- **自定义路由**：`GET {baseURL}/models`（anthropic 走 `/v1/models?limit=1000`），行结构为 `{id, name, contextWindow?, maxTokens?}`，**没有 inputModalities**——自定义探测路径拿不到模态信息。

- **输入**：`settingsNs` + 当前路由配置（`baseURL`／协议）。
- **输出**：与目录路由一一对应的 `NormalizedEntry`；自定义路由条目的 `inputModalities = undefined`。
- **失败模式**：discover 抛错／超时 → `failed`；自定义路由的 `/models` 返回 404／401 → `failed`（证据注明 HTTP 状态）。空列表 → `empty`。
- **缓存策略**：**不做本地缓存**（discovery 本身就是宿主的实时面；自定义路由重复探测的成本可以接受，而且结果可能随远端账号／权限变化）。v1 可选做会话级记忆（同一 `settingsNs` + 同一配置哈希内 TTL 60 秒），防止界面连续触发抖动。
- **证据标签**：
 - 目录路由条目：`scope:"entry", source:"dsh-discovery:catalog"`，字段证据为 `declared`；
 - 自定义路由条目：`source:"dsh-discovery:custom"`；因为没有模态信息，**证据要降级**——`inputModalities` 维度标注 `missing: "custom-route-no-modality"`，置信度相应降一档（§4.2），界面提示"自定义路由探测不返回模态信息"。

### 1.4 LocalProfileSource（本地档案）

- **输入**：ModelKey（五元组，见 §6）。
- **输出**：该键上一次保存的草稿快照（全部 DraftField 值 + 用户当时的 owner／touched 标记）。
- **失败模式**：没有档案 → `empty`（这不算失败）；存储损坏 → `failed`，并触发一次重建扫描（尽力而为）。
- **缓存策略**：它本身就是本地存储（DSH settings 持久层），没有二级缓存；读取是同步的。
- **证据标签**：`scope:"entry", source:"local-profile"`，字段证据标 `observed`（用户曾确认过）+ `staleIfOlderThan`（档案保存时间距今 > 30 天时给出新鲜度降级提示，只提示、不改行为）。

### 1.5 PresetSource（三档预设）

[定案]（产品事实）：三档预设——
| 预设 | contextWindow | maxTokens | input | 模板 |
| --- | --- | --- | --- | --- |
| 基础 | 32768 | 4096 | text | inherit |
| 编码 | 131072 | 8192 | text | 另选 |
| 长对话 | 262144 | 16384 | text | 另选 |

- **输入**：`presetId`（`basic | coding | longchat`）。
- **输出**：固定的 DraftField 值组 + `templateId`。
- **失败模式**：未知的 `presetId` → `failed`（调用方 bug 级别，开发期断言）。
- **缓存策略**：内联常量，无缓存。
- **证据标签**：所有字段证据为 `scope:"entry", source:"preset", status:"preset"`——**绝不冒充 `declared`**（不变式 I5：预设是起点不是能力事实；界面上展示为"推荐起点"而不是"模型能力"）。

### 1.6 来源优先级与事实等级

候选引擎合成时按来源可信度排序（只影响置信度初值，不改变并列展示的义务）：

1. `local-profile`（用户亲自确认过的历史事实）→ `observed`
2. `dsh-listing:catalog`（宿主目录，声明型）→ `declared`
3. `modelsdev`（第三方目录，声明型）→ `declared`
4. `dsh-listing:custom`（远端 `/models` 探测，无模态）→ `declared`（模态维度标记 missing）
5. `preset`（产品推荐起点）→ `preset`

同级来源（2 与 3）取值冲突时，**不排序择优**，并列展示，由用户裁决（不变式 I3）。这个排序只用于：候选的默认选择、置信度初值、界面提示的强度。

---

## 2. models.dev v1 解析器规范

[已执行-探针] 全部字段以下列实测为准（01-gap-fill U6）。`schemaVersion = 1`；升级 `schemaVersion` 时必须重写解析器并重新生成 fixture。

### 2.1 字段映射表（models.dev 的 Model → NormalizedEntry）

| models.dev 字段（实测） | → NormalizedEntry / 证据 | 备注 |
| --- | --- | --- |
| 顶层 `{<providerId>: {id, env[], npm, api, name, doc?, models{}}}` | 逐提供方展开；`provider.id`／`api`／`env` → `ModelKey.routeId` 候选 + 端点提示 | `env[]` 只提示需要的环境变量名，不存值 |
| `model.id` | `modelId`（必填，缺失就跳过该条目） | 原样保留，含日期／区域／后缀 |
| `model.name` | `name` | 缺失时回退 `id` |
| `model.description` | `description`（诊断展示） | — |
| `model.limit.context` | `context: {tokens, semantics}` | 有 `limit.input` 时 `semantics:"input"`；否则 `semantics:"combined"` |
| `model.limit.output` | `outputLimit` | — |
| `model.modalities.input[]` | `inputModalities` | 解析器保留全量（可能含 audio 等），**由投影层再裁剪到 pi-ai 的 text／image** |
| `model.modalities.output[]` | `outputModalities` | 同上 |
| `model.reasoning` + `model.reasoning_options[]` | `reasoning: {controls:[…]}` | `effort`→`efforts=values`；`toggle`→`toggle`；`budget_tokens`→`budget{min,max}`。只入档案与诊断，**不投影宿主**（宿主投影字段集见 U4） |
| `model.status:"deprecated"` | `status:"deprecated"` → 冲突提示 | 不阻塞候选；界面显示"上游标记已弃用" |
| `model.cost`（含 tiers） | 诊断屏专用字段 | **不入配置、不入候选** |
| `model.release_date` / `model.last_updated` | `observedAt`（取两者中较新的） | 新鲜度的依据之一 |
| `model.canonical_model_id` | `canonicalModelId` | 供身份解析器做二级解析（§3.4） |
| `model.family` / `attachment` / `tool_call` / `structured_output` / `temperature` / `open_weights` / `experimental` | 保留为 `meta`（诊断与规则匹配可读） | 不直接映射到 DraftField |
| 提供方 `doc` | 诊断屏链接 | — |

### 2.2 校验与容错规则

- **非法条目跳过，不让整体失败**：单条 Model 缺 `id`、`limit.context` 不是正整数、`modalities.input` 不是数组等 → 丢弃该条目并计数；提供方级 `models` 缺失／不是对象 → 丢弃该提供方；顶层不是对象 → 整体 `failed`（走最后可用快照）。
- **坏目录不替换最后可用快照**：`JSON.parse` 抛错、响应截断（末尾没有完整的 `}`）、顶层结构不符 → 缓存文件原样保留。
- **大小／结构异常阈值**（防投毒与内存放大；[推断-设计] 阈值为保守默认，见开放问题 Q1）：
 - 响应体 > 10 MB → 视为异常，拒绝解析（正常量级约 150KB+）；
 - 条目总数 > 5000，或单个提供方的 models > 1000 → 拒绝（超出即视为结构异常，整体 `failed`）；
 - 单条目序列化 > 64 KB → 跳过该条目；
 - `reasoning_options` 数组长度 > 8 → 只取前 8 个控制项并记告警；
 - 数值字段（`context`／`output`／`budget` 的 min/max）超过 `Number.MAX_SAFE_INTEGER` 或为负 → 跳过该条目。
- **摘要去重**：解析成功后计算整份文档的摘要，与缓存摘要相同 → 只更新 `fetchedAt`，不重写 entries（§1.2）。
- **错误计数回传**：`SourceResult.errors[]` 的每项为 `{code:"skipped-entry"|"skipped-provider"|"oversize"|"bad-json", count, sampleId?}`，供诊断屏展示。

### 2.3 解析器输出的 NormalizedEntry 结构

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

## 3. IdentityResolver（身份解析器，五级匹配链）

[定案]（b.md §5）。输入：`{routeId, providerId?, protocol, rawModelId}` + 各来源的结果。输出：`Resolution = { level, resolvedModelId, evidence, confidence, alternatives[] }`。**`rawModelId` 恒保留**（I1）；每一级只提出 `resolvedModelId` 建议，不改动 `rawModelId`。

### 3.0 置信标记约定

每一级都产出 `confidence: "high" | "medium" | "low"` 与 `evidence.scope`。级数越靠后置信越低；多级同时命中时**取最高一级的结果作主解，其余进 `alternatives[]` 并列展示**（不合并，I3）。

### 3.1 第 1 级 — 本地档案

- 算法：用完整的 ModelKey 查本地档案来源；命中 → `resolvedModelId = 档案内的 resolvedModelId`（档案保存值）。
- 证据：`scope:"local-profile"`，置信度 = **`high`**（用户曾确认过的组合），附档案时间戳。
- 注意：档案命中之后仍要继续跑第 2／3 级做**交叉校验**；若目录侧该键已不存在（例如模型下线），产出冲突提示并列展示（不覆盖档案，I3）。

### 3.2 第 2 级 — 路由元数据精确匹配

- 算法：在宿主目录来源返回的条目里，`entry.modelId === rawModelId`（**区分大小写的全等**）→ 命中。
- 证据：`scope:"route-metadata"`，置信度 = **`high`**。
- 目录路由与自定义路由都参与；自定义路由命中时，模态维度的 `missing` 标注随行附上。

### 3.3 第 3 级 — 同一提供方的目录条目（含 `canonical_model_id` 关系）

- 算法：
 1. 在 `providerId` 相同的目录条目（modelsdev 与 dsh-listing 的合并域）内做**规范化等值**比较：`norm(id) = lowercase(trim(id))`；`norm(rawModelId) === norm(entry.modelId)` 即命中。
 2. **`canonical_model_id` 的二级解析**：若条目带 `canonicalModelId` 且指向同一提供方内的另一条目 → 解析目标为那个 `canonical` 条目（例如快照条目／别名条目指向主条目）；`resolvedModelId = canonical 条目的 modelId`，并保留 `via: "canonical"` 标记。
 3. 命中多个不同目标（规范化后撞车）→ 全部进 `alternatives`，主解取 `modelsdev` 里 `canonical` 关系明确的那个，否则取 dsh-listing（来源优先见 §1.6），置信度 = **`medium`**。
- 证据：`scope:"provider-catalog"`（含 `via:"casefold"` 或 `via:"canonical"`），置信度 = **`medium`**。

### 3.4 第 4 级 — 用户规则

- 算法：加载规则库（§5），按优先级精确 > 路由 > 协议 > 全局逐级匹配（见 §5.3）；第一条命中的规则生效。
- 输出：规则可以改写 `resolvedModelId`（路由级规则带 `mapTo`），也可以只给 DraftField 预设（`usePresetId`）。
- 证据：`scope:"user-rule", ruleId`，置信度 = **`high`**（用户的显式意志，即便匹配本身是模糊的）——规则由用户自己维护，其意志高于启发式。
- 与第 1／2 级冲突时：规则不覆盖已经 `high` 的精确解／档案解，但**并列展示并提示规则存在**（用户可以删规则；I3 并列不合并）。

### 3.5 第 5 级 — family／模糊的低置信候选

- 算法：
 1. **family 匹配**：modelsdev 条目的 `meta.family` 与 `rawModelId` 前缀（按 `-` 分段后的前 1–2 段）一致 → 作为候选；
 2. **模糊匹配**：规范化后做前缀／包含匹配（`rawModelId.startsWith(entryId)` 或反向），最多取 5 个候选，按编辑距离排序。
- 证据：`scope:"fuzzy"`，置信度 = **`low`**；界面明示"低置信建议，请确认"。
- **`auto`／`free` 别名的特殊处理**（I2）：`rawModelId ∈ {auto, free}` 或带 `:free` 后缀 → 不做模糊匹配，直接产出"请选择具体模型"的建议（§4.4），不猜底模。

### 3.6 匹配链的总流程

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

冲突语义：任何两级给出**不同**的 `resolvedModelId` → 两者都保留：主解按 level／置信度确定，次解进备选，界面并列展示 + 原因（scope 标签）。**永不自动合并，也不择优覆盖**（I3）。

---

## 4. CandidateEngine（候选合成引擎）

### 4.1 字段级合成顺序

对每个 DraftField（`contextWindow`／`maxTokens`／`inputModalities`／`reasoningEfforts`／…），候选按以下先后顺序合成（先出现的优先作为默认值，后面的作为备选）：

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

注意：第 3 与第 4 项同为 `declared`，冲突时**并列不择优**（I3）；默认选中按 §1.6 的顺序（路由目录优先于 models.dev，因为宿主目录更贴近实际路由行为）。第 8 级的兜底用 pi-ai 的默认值 `{contextWindow: 262144, maxTokens: 32768, input: ["text"]}`，证据 `scope:"builtin-default"`，置信度 = `low`。

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

- **置信度初值**：按 §1.6 的来源顺序 + 证据降级（自定义路由无模态 → 该字段候选降一档；模糊匹配 → `low`）。
- **去重（dedupe）**：取值完全相同的候选合并为一条，`origin`／`evidence` 保留为数组（界面可以展示"两个来源一致"）。
- **排序（rank）**：置信度 > 来源优先序 > `observedAt` 新的优先；置信度与来源序都相同时保持稳定顺序（不引入随机性）。

### 4.3 冲突展示（不合并）

同一字段的多个候选取值不等 → 全部保留：主候选 = 排序第一；其余按顺序展示在界面的"其他来源值"区，每项附 `{origin, evidence.scope, observedAt}`。用户选定任意一个 → 该字段转为 `user-selected`（R5 的 owner 变更）。

### 4.4 未知模型必须产出建议

当身份解析器判定为未解析（§3.6 全空）或模糊匹配没有候选时，**必须产出一条建议而不是留空字段**：

- `resolvedModelId = rawModelId`（原样透传，I1——不猜、不剥后缀）；
- DraftField 全部落到 pi-ai 兜底 + 预设默认值（`owner=generated`）；
- 界面顶部出现"未识别模型"提示条：附上模糊匹配的邻近候选（若有）+ "仍要使用原样 ID"按钮 + 提示可以保存规则（引导进入 §5 的规则编辑）；
- 这条建议照常进入 R4 记忆（用户确认之后，同一个键第二次输入就直接命中档案，不再提示）。

### 4.5 与宿主投影的边界

候选引擎只产出 DraftField 候选；投影到 pi-ai／deepseek 时的裁剪规则（`inputModalities`→text／image、`reasoningEfforts` 的档位系校验、`reasoning_controls` 不投影等）属于 B 系列的其他章节（U4 的投影定案），本章不重复定义，只在证据上保留全量供投影层读取。

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

- `match.routeId`：精确等于路由 id；缺省 = 匹配所有路由（全局级）。
- `match.rawModelId`：**glob**（`*` 通配，单段；不支持 `?`／`[]`／`**`，见 5.3 的 glob 限制）；缺省 = 匹配所有模型。
- `usePresetId`：必须存在于预设的三档之中；非法值 → 规则加载时报错并跳过该规则（单条规则失败不影响整体）。
- `reasoningProfileId`：可为空，指向推理档案（由 B 系列另章定义），这里只校验存在性。
- `unknownPolicy`：v1 只有 `"keep-raw"`——遇到 schema 未知字段时保留原样并在诊断屏提示，**不丢弃、不猜语义**。

### 5.2 优先级

`exact > route > protocol > global`（[定案] b.md §5）。判定规则：

1. **精确（exact）**：`match.routeId` 存在 **且** `match.rawModelId` 存在（无通配，或通配但全等）；
2. **路由（route）**：只有 `match.routeId` 存在；
3. **协议（protocol）**：（v1 预留）当 match 含 protocol 字段时归到这一级——v1 的 schema 未定义 protocol 匹配字段，这一级只在排序器里占位；
4. **全局（global）**：两者都缺省。

同一 id 的规则重复加载 → 后者覆盖前者并告警；同一优先级有多条命中 → **全部并列展示命中原因**（"规则 A 与规则 B 同时匹配：A 因 routeId 精确、B 因 glob 前缀"），执行顺序按规则数组的顺序（用户可见、可拖动排序的确定序），不静默取其一。

### 5.3 glob 限制

- 只支持 `*`（匹配除 `/` 之外的任意字符——模型 id 不含 `/`，实际上就是任意后缀）；只允许出现在**末尾**（前缀匹配语义），`*` 出现在中间／开头 → 该规则加载时报 `invalid-glob` 并跳过；
- 长度上限：`match.rawModelId` ≤ 128 字符；规则数组 ≤ 200 条；单条规则的 JSON ≤ 2 KB；
- 规则 id 全局唯一；`match` 两个字段都缺省的规则视为全局规则，且要求显式写 `note`（防止误配成全局）。

### 5.4 规则与匹配链的关系

规则在第 4 级被消费（§3.4）；规则产出的 `usePresetId` 同时进入候选引擎的合成序（§4.1 的第 5 级）。规则命中**永不覆盖** touched／locked 的字段（R5 优先级最高，见 §7）。

---

## 6. R4 记忆键设计（ModelKey → 存储键）

### 6.1 ModelKey 与规范化

ModelKey 五元组：`{routeId, providerKind, protocol, rawModelId, resolvedModelId}`。

- **存储键的规范化**：`storageKey = sha256(JSON.stringify([{routeId, providerKind, protocol, rawModelId, resolvedModelId}]))` —— 五元组按固定字段序序列化后整体哈希；`resolvedModelId` 参与键（同 raw、不同 resolved 视为两条不同的记忆——例如模糊修正之后就是两条独立档案）。
- `rawModelId` **原样参与哈希**（保留大小写与后缀，I1；`DeepSeek-Chat` 与 `deepseek-chat` 是两条记忆——避免键层的信息损失；若实测撞库过多可以加二级索引，[待验证-P0] 观察项）。
- **脱敏**：ModelKey 与档案内容**不含 API key、headers、baseURL 的凭据段**；`routeId` 是路由标识而不是密钥；审计面可以明文读取五元组原文（可逆——保留原键值的明文映射表 `storageKey → ModelKey 明文`，便于界面展示与清理，不含任何 secret 字段）。

### 6.2 档案内容与命中预填流程

档案（每个 `storageKey` 一条）：

```ts
interface ModelProfileEntry {
  storageKey: string;
  modelKeyPlain: ModelKey;      // 明文五元组（无 secret）
  savedAt: number;
  draftFields: Record<DraftFieldId, { value: unknown; owner: Owner; touched: boolean; locked: boolean }>;
  resolvedVia?: Resolution["level"];  // 当时解析级别
}

```

命中后的预填流程：

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

- 同一个键第二次输入**直接命中预填**（R4 定案）；命中不阻止目录刷新（未触碰字段的晚到结果仍可更新，见 §7.2）。
- 写入时机：用户显式保存，或首次验证请求成功（P0 用显式保存，自动写入留作开放问题 Q4）。

---

## 7. R5 的 intent 跟踪

### 7.1 touched／locked 的维护时机

| 事件 | touched | locked |
| --- | --- | --- |
| 用户在界面上修改任一 DraftField 的值 | 该字段 +touched | — |
| 用户点字段的"锁定"控件 | （保持） | +locked |
| 用户解锁 | — | -locked |
| 用户从候选备选中选定一个值 | +touched（owner→user-selected） | — |
| 用户又改回与候选主值相同 | touched 保留（防抖动；除非显式"重置为建议"） | — |
| 保存档案 → 重新打开 | 按档案回填 touched／locked（§6.2） | 同左 |
| `generation` 更换（路由／ID／draftId 变化） | 整组重置为新代次的初始状态 | 同左 |

`owner` 与 touched／locked 的关系：`user-edited ⇒ touched`；`user-selected ⇒ touched`；`generated` 既可未触碰也可 touched（未触碰 = 用户没碰过，晚到的结果可以覆盖）。

### 7.2 晚到响应的合并算法

目录结果（宿主目录来源／models.dev 来源）晚于用户开始编辑才到达时：

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

要点：晚到的结果**只能影响未触碰字段**；冲突进并列池供用户查看；identity 层（`resolvedModelId`／备选）可以随时刷新，因为它是展示与建议层，不是用户输入层。

### 7.3 `generation` 的取消

- **`generation` = (`routeId`, `rawModelId`, `draftId`)** 三元组；任一变化 → `generation` 递增。
- 所有异步的来源请求（`SourceContext.signal`）与候选引擎的合成任务都绑定 `generation`；响应回来时若 `generation` 不匹配 → 直接丢弃（不合并、不更新界面、不写档案）。
- 界面取消／关闭草稿 → 触发 abort signal；已经 in-flight 的写入（档案保存）以 `generation` 校验兜底。
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
| §1.2 §2 | [已执行-探针] | U6 实测的端点与字段 |
| §1.3 | [已核对-源码] | discovery 两版一致 |
| §1.5 | [定案] | 三档预设的产品事实 |
| §3 | [定案] | b.md §5 的匹配链 |
| §4.1 第 8 级 | [已核对-源码] | pi-ai 默认 262144/32768/text |
| §1.2 的 ETag／304 | [待验证-P0] | 摘要兜底已定案 |
| §2.2 阈值、§6.1 大小写键、§6.2 自动写档 | [推断-设计] / 开放问题 | 保守默认 |

## 9. 开放问题与保守默认

- **Q1 解析阈值**：10 MB／5000 条目／每个提供方 1000 个 models 这些阈值属于保守估计（实测响应在 ~150KB+ 量级）。默认：按 §2.2 执行；后续若合法增长触发误杀，按观测调整并记录变更。
- **Q2 ETag／304**：若实测 models.dev 不返回 ETag → 永远走摘要去重（当前的默认行为，没有行为差异）。
- **Q3 同级冲突的默认选中**：路由目录与 models.dev 取值冲突时，主解默认取路由目录（宿主面更贴近实际行为）；若实测发现 models.dev 更准的案例 ≥ 3 次，就反转默认并在诊断屏记录。
- **Q4 档案自动写入**：P0 只做显式保存；"验证请求成功后自动写档"留到 P1 决策（涉及 R4 噪音与便利性的权衡）。
- **Q5 规则的 protocol 级**：v1 只占位不实现；等多协议路由实践之后再补 `match.protocol` 字段。
- **Q6 storageKey 的明文映射表**：默认保留明文映射（可逆、便于界面与清理）；若审计要求不可逆存储，就切换为纯哈希 + 列表侧缓存明文（改动局限在 §6.1）。

**保守默认的总原则**：所有未定参数都取"最不惊讶"的一侧——坏数据不覆盖好缓存、冲突不合并、用户输入永不覆盖、未知结构保留并提示（`unknownPolicy: keep-raw`）。

---

## 10. P0-05 解析器 fixture 测试需求清单

fixture 来源：U6 的实测响应节选（`llmtech`／`frogbot`／`crossmodel` 三个提供方，01-gap-fill §U6 定案）。落盘在解析器测试目录，`schemaVersion=1` 固定。**必须覆盖的变体矩阵**：

| # | 变体 | 必须覆盖的点 | 断言要点 |
| --- | --- | --- | --- |
| F1 | `reasoning_options: [{type:"effort", values:[...]}]` | 档位型（≥2 个值） | 映射为 `reasoning.controls=[{type:"effort",values}]`；values 原样保留、不排序 |
| F2 | `reasoning_options: [{type:"toggle"}]` | toggle 型 | 映射为 `{type:"toggle"}`；没有 values 字段 |
| F3 | `reasoning_options: [{type:"budget_tokens", min, max}]` | 预算型（含 min／max 都存在、只有 min、只有 max、全部缺省共 4 个子变体） | 映射为 `{type:"budget", min?, max?}`；缺省的字段不出现在输出里 |
| F4 | `reasoning: true` 但 `reasoning_options` 缺失 | 没有 options 的推理模型 | 产出 `reasoning:{controls:[]}`，不报错 |
| F5 | `reasoning: false` 或字段缺失 | 无推理能力的模型 | 不产出 `reasoning` 键（或 controls 为空，与 F4 的输出一致化——实现取"不产出键"） |
| F6 | `status:"deprecated"` | 弃用标记 | 条目保留 + `status:"deprecated"`；候选合成不阻塞；产出冲突提示 |
| F7 | `limit.input` 存在 | `semantics=input` | `context.semantics="input"` |
| F8 | `limit.input` 缺失（只有 context／output） | `semantics=combined` | `context.semantics="combined"` |
| F9 | `limit.output` 缺失 | 无 outputLimit | `outputLimit` 键缺省，不填默认值 |
| F10 | `modalities.input` 含非 text／image（如 audio） | 全量保留 | 解析器保留 audio；断言"裁剪责任不在解析器，而在投影层" |
| F11 | `canonical_model_id` 指向同一提供方内存在的条目 | `canonical` 二级解析 | 身份解析器 L3 以 `via:"canonical"` 命中 |
| F12 | `canonical_model_id` 指向不存在的条目 | 悬空的 `canonical` | 忽略 `canonical`，条目正常保留 + 告警 |
| F13 | 大小写差异对（`Foo-Model` 与 `foo-model`） | 忽略大小写的等值 | L3 以 casefold 命中，两个条目都保留在目录里 |
| F14 | `:free`／`-high`／带日期后缀的 id | 后缀不剥离 | `rawModelId` 原样；模糊匹配允许前缀命中，但标 `low` |
| F15 | `auto`／`free` 裸别名 | 不猜底模 | L5 直接跳过模糊匹配 → 进入建议流程（§4.4） |
| F16 | 非法条目族：缺 id／context 非正数／modalities 非数组／reasoning_options 超 8 项 | 跳过与截断 | 计数进 `errors[]`；整体 status=ok |
| F17 | 顶层坏结构：非 JSON／截断／不是提供方映射／超 10 MB | 最后可用快照保护 | 缓存不覆写；`SourceResult=failed` + stale 回退 |
| F18 | 提供方缺 `models`／models 为空对象 | 空提供方 | 跳过该提供方（或产出空 entries + empty 标记）；不算整体失败 |
| F19 | 重复摘要（同一文档二次取回） | 摘要去重 | 不重写缓存文件，只刷新 `fetchedAt` |
| F20 | `cost`／`doc`／`family`／`attachment`／`experimental` 存在 | 诊断字段 | 进 meta／诊断，不出现在 DraftField 候选里 |

**fixture 文件组织**：每个变体一个最小 JSON 片段 + 一份合并的全量 fixture（从 U6 实测响应裁剪）；F17 这类坏文档单独建目录（不进正常加载路径）。P0-05 验收 = F1–F20 全部通过 + `errors[]` 计数准确。