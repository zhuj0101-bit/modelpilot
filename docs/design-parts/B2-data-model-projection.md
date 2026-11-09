# B2 — 数据模型与投影（Data Model & Projection）

状态：设计定案 v1（供直接采用进代码）。日期：2026-11-10。
上游输入：`01-gap-fill.md`（U4 deepseek 字段集 / U5 runtime 降级 / U6 models.dev 映射）、a.md §3.B（StoredField 三态修正版）、任务事实基线（llm-pi-ai 与 llm-deepseek 两版已核字段集与解析语义）。

证据标签沿用 dsh-compat-audit 规则：[已核对-源码]（源码逐行核过）、[已核对-基线]（任务事实基线已核）、[推断-设计定案]（设计层决定，源码不约束）、[推断-命名]（纯命名）、[待验证-0.2.x]（需对宿主 0.2.x 实测）、[待验证-P3]（留 P3 运行时验证）。

---

## 1. 数据模型总览

[推断-设计定案] 五层管线，每层只依赖上一层：

```
models.dev / 宿主目录 / 用户输入 / 参数实测
        │  (parser: B3)
        ▼
   Evidence<T>  ── 单值 + 来源 + 时间，冲突仲裁的最小单位
        ▼
 CapabilitySnapshot ── 一个模型的"能力面"只读快照（目录侧事实）
        ▼
 ModelProfileV2 ── 用户可编辑档案（StoredField 三态 + ReasoningPolicy + WireProfile 池）
        ▼
 HostProjectionAdapter（per DriverId）
        ▼
 ProjectionResult ── settingsOps / appliedFields / profileOnlyFields / unsupportedControls / requestPreview / previewFidelity
        ▼
 mutate(ns, ops, expectedRevision)   ← 宿主 settings 写路径（SETTINGS_CONFLICT 在调用方重试）
```

关键语义约束（全部为后续规则表的公理）：

- **A1** [已核对-源码] pi-ai 模型条目 `modelFields = {name, contextWindow, maxTokens, input: text|image[], reasoningEfforts, compat(24字段)}`；`modelProfile = {id(required), ...modelFields}`；`modelOverride` 同集无 id。`MODALITIES = {text, image}`。
- **A2** [已核对-源码] pi-ai `resolveRouteModels`：`models` 非空 = **整体替换**路由目录；`modelOverrides` 与 `models` 互斥且只收已安装目录内 ID；重复 ID 拒绝；未知键物化时丢弃。
- **A3** [已核对-源码] pi-ai `reasoningEfforts` 解析：未声明 = 继承目录；`false` = 非推理（≠ 关掉上游思考）；`off: null` = 不发参数；`off: "<wire>"` = 发送该值；未声明档 pin 不支持；`xhigh`/`max` 必须显式声明；必须至少一个 off 以外档位；请求侧 `UNSUPPORTED_REASONING_EFFORT` 先于 IO 抛出。
- **A4** [已核对-源码] pi-ai `maxTokens` 双重身份：调用未显式给 `maxTokens` 时，条目值被物化为请求缺省预算 → 任何展示/预览必须三值分明（请求显式 / 条目物化 / 宿主缺省）。
- **A5** [已核对-源码/U4] deepseek `catalogModel = {id(required), name, description, contextWindow, maxTokens, inputModalities(default ["text"]), imagePixelBudget, imageMaxBytes, systemPromptUpdate, toolUpdate}`；路由级 `thinking(enabled|disabled)`、`reasoningEffort(off|low|high|max)`、`maxTokens(default 256e3)`、`defaultContextWindow(default 1e6)`、`models[]`。无 reasoningEfforts dict、无 compat、无 thinkingBudgets、无 modelOverrides。
- **A6** [已核对-基线/U4] deepseek 投影白名单 = `{name?, contextWindow?, maxTokens?, inputModalities?}` + 路由级 `reasoningEffort?`；**reasoningEfforts dict 输入 deepseek 投影必须报 unsupported**（档位系不同，禁止静默映射）。
- **A7** [已核对-基线] settings 写路径：pi-ai `providers.<id>.models.<String(i)>.<field>`；deepseek 的 models 数组同理在其自身 ns 下。写入经 `mutate(ns, ops, expectedRevision)`，冲突返回 `SETTINGS_CONFLICT`。
- **A8** [已核对-源码] budget（`thinkingBudgets{minimal,low,medium,high}`）仅 pi-ai 路由级，**无 per-model 承接点**。
- **A9** [已核对-基线] pi-ai 路由级还有 `apiKeyEnv(credential-ref)/displayName/api/baseURL/headers/reasoning/transport/timeoutMs/cacheRetention/defaultContextWindow(262144)/defaultMaxTokens(32768)/defaultInput(["text"])`；pi-ai 缺省值与 deepseek（256e3 / 1e6）不同。

---

## 2. TypeScript 类型定义（完整，可直接采用）

[推断-设计定案] 以下类型为本章交付物；命名前缀按 ModelPilot 包内约定不加前缀，调用方以 `import type` 引入。每个字段附 JSDoc 说明语义与来源。

```ts
// ============================================================
// B2 §2.0 — 基础词表
// ============================================================

/** 宿主 LLM 驱动标识；v1 两个，新增驱动 = 扩展此联合 + 注册一个 HostProjectionAdapter。[已核对-源码：llm-pi-ai / llm-deepseek 两版同构] */
export type DriverId = "pi-ai" | "deepseek";

/** 运行时判别用词表（与 DriverId 联合同步维护）。[推断-命名] */
export const DRIVER_IDS = ["pi-ai", "deepseek"] as const;

/** 类型守卫：任意字符串收敛为 DriverId。[推断-设计定案] */
export function isDriverId(v: string): v is DriverId {
  return (DRIVER_IDS as readonly string[]).includes(v);
}

/** settings 命名空间 id，与宿主 mutate(ns, ops, expectedRevision) 的 ns 一致；两驱动各自独立 ns。[已核对-基线 A7] */
export type SettingsNamespace = DriverId;

/** 线上协议方言归属；当前与 DriverId 一一对应，独立命名以便未来同驱动多方言。[推断-命名] */
export type WireProtocol = "pi-ai" | "deepseek";

/** 内置方言版本标识；方言规则变化时递增（pi-ai.v2 等），旧 profile 按版本迁移。[推断-命名] */
export type WireDialectId = "pi-ai.v1" | "deepseek.v1";

/** 模态词表：与宿主 MODALITIES = {text, image} 对齐；models.dev 的其他模态在 parser 全量保留、投影层裁剪。[已核对-源码 A1 / U6] */
export type Modality = "text" | "image";

/** 推理档位 id 词表：pi-ai 七档 ∪ deepseek 四档的并集；合法性一律按 DriverCapabilities.reasoningLevels 收敛，禁止跨方言直用。[已核对-源码 A3/A5] */
export type ReasoningLevelId =
  | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** 档案字段 id：ModelProfileV2.fields 的键与投影规则表的行键。[推断-设计定案] */
export type ProfileFieldId =
  | "displayName" | "contextWindow" | "maxTokens" | "inputModalities" | "outputModalities";

// ============================================================
// B2 §2.1 — 证据层（Origin / Evidence）
// ============================================================

/** 单值证据的三分类来源。[已核对-基线 U6 映射定案] */
export type Origin = "catalog-declared" | "user-declared" | "parameter-tested";

/** 来源：models.dev v1 快照；digest 用于内容去重（ETag 缺失时兜底）。[已核对-U6] */
export interface EvidenceSourceModelsDev {
  kind: "models-dev";
  /** 响应体 sha256（hex），内容级去重键。[已核对-U6：digest 去重兜底] */
  digest: string;
  /** 上游若返回 ETag 则记录，供 304 复验；未确认项，允许缺省。[待验证-0.2.x：304/ETag 头] */
  etag?: string;
}

/** 来源：宿主已安装目录（resolveRouteModels 展开后的路由目录条目）。[推断-设计定案] */
export interface EvidenceSourceHostCatalog {
  kind: "host-catalog";
  /** 证据所属驱动。[已核对-基线] */
  driverId: DriverId;
  /** 证据所属路由 id（pi-ai = provider 条目 id；deepseek = 单路由，惯例 "default"）。[推断-惯例] */
  routeId: string;
}

/** 来源：用户在 UI 手填。[推断-设计定案] */
export interface EvidenceSourceUserInput {
  kind: "user-input";
  /** 填写界面：候选表单 / 档案编辑器 / diff 确认页。[推断-命名] */
  surface: "candidate-form" | "profile-editor" | "diff-review";
}

/** 来源：参数实测（验证请求或 IO 探针）。首版 P0–P2 只有 validation-request；io-probe 留 P3。[已核对-U5] */
export interface EvidenceSourceProbe {
  kind: "probe";
  /** 探针种类：验证请求（可拒）或 IO 探针。[已核对-U5：按"可能被拒绝"设计] */
  probe: "validation-request" | "io-probe";
  /** 关联 ledger 的请求 id（via=agent/request 时必填），可审计。[已核对-U5] */
  requestId?: string;
}

/** 证据来源联合。[推断-设计定案] */
export type EvidenceSource =
  | EvidenceSourceModelsDev
  | EvidenceSourceHostCatalog
  | EvidenceSourceUserInput
  | EvidenceSourceProbe;

/** 证据包裹：进入档案的每个能力值都必须带来源与时间；投影警告、冲突仲裁、UI 角标全部读它，裸值禁止入档。[推断-设计定案] */
export interface Evidence<T> {
  /** 证据值本身（已归一化，如模态已裁剪到 {text,image}）。[推断-设计定案] */
  value: T;
  /** 三分类来源。[已核对-基线 U6] */
  origin: Origin;
  /** 观测时间 ISO8601；UI 据此显示"多久前的目录声明"。[推断-命名] */
  observedAt: string;
  /** 精确来源（可回溯到快照 digest / 路由 / 请求 ledger）。[推断-设计定案] */
  source: EvidenceSource;
}

// ============================================================
// B2 §2.2 — 能力快照层（ModelKey / CapabilitySnapshot）
// ============================================================

/** 模型全局键：档案与投影的寻址单位，五元组缺一不可。[已核对-基线（字段给定）] */
export interface ModelKey {
  /** ModelPilot 连接 id = 宿主 settings `providers.<id>` 的 provider id。[已核对-基线 A7] */
  connectionId: string;
  /** 驱动标识，决定用哪个 HostProjectionAdapter。[已核对-基线] */
  driverId: DriverId;
  /** 路由 id：pi-ai 惯例 = providerId（provider 条目即路由）；deepseek = "default"（单路由 ns）。[推断-惯例，待验证-0.2.x：pi-ai 是否存在单 provider 多路由形态] */
  routeId: string;
  /** 线上协议方言，目前恒等于 driverId。[推断-命名] */
  protocol: WireProtocol;
  /** 宿主目录/请求侧原始模型 id（未本地化、未改名）。[已核对-基线 A1/A5：id required] */
  rawModelId: string;
}

/** 推理能力面：来自 models.dev reasoning_options 或宿主目录归一。[已核对-U6 映射定案] */
export type ReasoningControl =
  | { kind: "effort"; /** 声明的档位集合（方言无关，投影时按方言收敛）。[已核对-U6] */ levels: ReasoningLevelId[] }
  | { kind: "toggle" }
  | { kind: "budget"; /** 预算下界（tokens），可缺省。[已核对-U6] */ min?: number; /** 预算上界（tokens），可缺省。[已核对-U6] */ max?: number };

/** 一个模型的推理能力声明。[已核对-U6] */
export interface ReasoningCapability {
  /** 能力面列表（可同时含 effort 与 budget 等）。[已核对-U6] */
  controls: ReasoningControl[];
  /** 档位系归属方言；缺省 = 未知（投影 deepseek 前必须先收敛，否则报 unsupported）。[推断-设计定案] */
  levelSystem?: WireProtocol;
}

/** 能力快照：目录侧只读事实，字段缺省 = 目录/源未声明（继承语义见 A3）。[推断-设计定案] */
export interface CapabilitySnapshot {
  /** 上下文窗口（tokens）。pi-ai 继承链：条目 → defaultContextWindow(262144)；deepseek：条目 → 1e6。[已核对-源码 A9/A5] */
  context?: Evidence<number>;
  /** 输出上限（tokens）。注意 A4 双重身份：条目值会被物化为请求缺省预算；pi-ai 继承 defaultMaxTokens(32768)，deepseek 256e3。[已核对-源码] */
  outputLimit?: Evidence<number>;
  /** 输入模态。pi-ai 条目字段名 `input`，deepseek `inputModalities`；投影层负责改名。[已核对-源码 A1/A5] */
  inputModalities?: Evidence<Modality[]>;
  /** 输出模态。两驱动条目级均无宿主字段 → 恒 profile-only。[已核对-基线 A1/A5 + 三分类] */
  outputModalities?: Evidence<Modality[]>;
  /** 推理能力。pi-ai 目录未声明 = 继承（A3）；deepseek 目录只有路由级四值枚举（A5）。[已核对-源码] */
  reasoning?: Evidence<ReasoningCapability>;
}

// ============================================================
// B2 §2.3 — 档案层（StoredField / ReasoningPolicy / WireProfile / ModelProfileV2）
// ============================================================

/** 档案字段三态（a.md §3.B 修正版）。[已核对-基线（三态给定）；映射语义为设计定案] */
export type StoredField<T> =
  | { state: "value"; /** 用户显式值：投影为写入/覆盖宿主键。[推断-设计定案] */ value: T }
  | { state: "inherit" } // 未显式设置：跟随宿主条目/路由缺省；投影为删除 override 键（若存在），无键则 no-op。[推断-设计定案]
  | { state: "cleared" }; // 显式清除"该模型有此能力"的声明：有 wire 空值表达的字段写空值表达（pi-ai reasoningEfforts=false）；无 wire 空值表达的字段（contextWindow/maxTokens/input）退化为删键 + cleared-lossy 警告。[推断-设计定案]

/** 推理策略：方言无关的用户意图；落地方言由 WireProfile + projectReasoning 完成。[已核对-基线（四态给定）] */
export type ReasoningPolicy =
  | { mode: "inherit" } // 继承目录/路由声明：pi-ai = 删 reasoningEfforts 键；deepseek = 不写路由级推理字段。[推断-设计定案]
  | { mode: "disabled"; /** 表达"非推理"所用 wire profile。[推断-设计定案] */ wireProfileId: string }
  | { mode: "effort"; /** 缺省档位（用户请求未指定时）；缺省 = 路由缺省，方言可能要求显式（deepseek）。[已核对-基线] */ defaultLevel?: ReasoningLevelId; /** 表达档位映射所用 wire profile。[推断-设计定案] */ wireProfileId: string }
  | { mode: "budget"; /** 预算 tokens（单值意图）。[已核对-基线] */ tokens: number; /** 表达预算所用 wire profile。[推断-设计定案] */ wireProfileId: string };

/** pi-ai effortMap 形态：键 ⊆ 七档；值 string（wire 值）或 null（仅 off 允许 null = 不发参数）。[已核对-源码 A3] */
export interface WireEffortMap {
  /** off 档 wire 值；null = 请求不发 reasoning 参数；字符串 = 发送该值。[已核对-源码 A3] */
  off?: string | null;
  /** minimal 档 wire 值（仅 pi-ai 有此档）。[已核对-源码 A1] */
  minimal?: string;
  /** low 档 wire 值。[已核对-源码 A1] */
  low?: string;
  /** medium 档 wire 值（deepseek 无此档）。[已核对-源码 A5] */
  medium?: string;
  /** high 档 wire 值。[已核对-源码 A1] */
  high?: string;
  /** xhigh 档 wire 值；被策略引用时必须显式声明（A3/R5）。[已核对-源码 A3] */
  xhigh?: string;
  /** max 档 wire 值；被策略引用时必须显式声明（A3/R5）。[已核对-源码 A3] */
  max?: string;
}

/** pi-ai 路由级 thinkingBudgets 形态（四桶，无 per-model 承接点）。[已核对-源码 A8] */
export interface ThinkingBudgets {
  /** minimal 桶预算 tokens。[已核对-源码 A8] */
  minimal?: number;
  /** low 桶预算 tokens。[已核对-源码 A8] */
  low?: number;
  /** medium 桶预算 tokens。[已核对-源码 A8] */
  medium?: number;
  /** high 桶预算 tokens。[已核对-源码 A8] */
  high?: number;
}

/** "关闭推理"的方言表达：pi-ai 有两种（effort-off / omit-param），deepseek 有两种（thinking-disabled / effort-off）。[已核对-源码 A3/A5] */
export type WireDisableSpec =
  | { /** 方言归属。[推断-设计定案] */ protocol: "pi-ai"; /** 写 off:"<wire>"（推理模型但显式最低档）。[已核对-源码 A3] */ kind: "effort-off"; /** off 档发送的 wire 字符串。[已核对-源码 A3] */ wire: string }
  | { /** 方言归属。[推断-设计定案] */ protocol: "pi-ai"; /** 写 off:null = 请求侧省略参数（≠ false 非推理）。[已核对-源码 A3] */ kind: "omit-param" }
  | { /** 方言归属。[推断-设计定案] */ protocol: "deepseek"; /** 路由级 thinking:"disabled"。[已核对-源码 A5] */ kind: "thinking-disabled" }
  | { /** 方言归属。[推断-设计定案] */ protocol: "deepseek"; /** 路由级 reasoningEffort:"off"。[已核对-源码 A5] */ kind: "effort-off" };

/** wire profile 控制面：一个方言内"如何表达推理意图"的具体参数。[已核对-基线（三键给定）] */
export interface WireControls {
  /** effort 档位 → wire 值映射；仅 pi-ai 方言（deepseek 无 effort dict → 禁止出现，校验拒绝）。[已核对-源码 A3/A6] */
  effortMap?: WireEffortMap;
  /** 关闭推理的表达；必须与 protocol 同方言。[已核对-源码 A3/A5] */
  disable?: WireDisableSpec;
  /** 路由级预算；仅 pi-ai（路径固定 thinkingBudgets）。v1 投影不写路由（route-write-would-leak），仅存档 + parameter-tested 档案承载。[已核对-源码 A8 + 推断-设计定案] */
  budget?: { /** 固定路径标识（无 per-model 承接点的自证）。[已核对-源码 A8] */ path: "route.thinkingBudgets"; /** 四桶值快照。[已核对-源码 A8] */ values: ThinkingBudgets };
}

/** wire profile 来源：目录声明 / 用户手选 / 参数实测。[已核对-基线（三值给定）] */
export type WireProvenance = "catalog-declared" | "user-selected" | "parameter-tested";

/** 线上档案：把方言无关的 ReasoningPolicy 翻译成具体 wire 参数的"词典"。[已核对-基线（字段给定）] */
export interface WireProfile {
  /** profile id（档案内唯一）。[已核对-基线] */
  id: string;
  /** schema 版本，当前恒 1。[推断-命名] */
  version: 1;
  /** 方言归属；controls 必须与本 protocol 自洽（校验器强制）。[推断-设计定案] */
  protocol: WireProtocol;
  /** 方言版本标识。[推断-命名] */
  dialect: WireDialectId;
  /** 来源三分类（与 Origin 词表不同名：user-selected ≠ user-declared，前者指"用户选了哪个表达方式"）。[已核对-基线] */
  provenance: WireProvenance;
  /** 控制面。[已核对-基线] */
  controls: WireControls;
}

/** 用户可投影的宿主字段集（三态）。[推断-设计定案] */
export interface ProfileFields {
  /** 展示名 → pi-ai `name` / deepseek `name`。[已核对-源码 A1/A5] */
  displayName: StoredField<string>;
  /** 上下文窗口 → 两驱动同名 `contextWindow`。[已核对-源码 A1/A5] */
  contextWindow: StoredField<number>;
  /** 输出上限 → 两驱动同名 `maxTokens`；注意 A4 双重身份展示义务。[已核对-源码] */
  maxTokens: StoredField<number>;
  /** 输入模态 → pi-ai `input` / deepseek `inputModalities`；值域恒 ⊆ {text,image}。[已核对-源码 A1/A5] */
  inputModalities: StoredField<Modality[]>;
  /** 输出模态 → 两驱动均无条目字段，恒 profile-only。[已核对-基线] */
  outputModalities: StoredField<Modality[]>;
}

/** 模型档案 v2：ModelPilot 的持久化核心实体。[已核对-基线（实体给定）] */
export interface ModelProfileV2 {
  /** schema 版本，当前 2。[推断-命名] */
  schemaVersion: 2;
  /** 全局键。[已核对-基线] */
  key: ModelKey;
  /** 宿主可投影字段（三态）。[推断-设计定案] */
  fields: ProfileFields;
  /** 推理策略（三态包裹；state=inherit 时忽略内层 mode）。[推断-设计定案] */
  reasoning: StoredField<ReasoningPolicy>;
  /** 可用 wire profile 池（含 selectedWireProfileId 指向项）。[已核对-基线] */
  wireProfiles: Record<string, WireProfile>;
  /** 当前选用 wire profile id；缺省 = 池内首个 catalog-declared。[推断-设计定案] */
  selectedWireProfileId?: string;
  /** pi-ai 模型级 compat 快照（24 字段）；v1 只存不投影（白名单外），P2 评估直写。[已核对-源码 A1 + 推断-设计定案] */
  compat?: StoredField<Record<string, boolean | number | string>>;
  /** deepseek 条目独有字段快照；v1 只存不投影（插件白名单不写，U4）。[已核对-U4] */
  deepseekExtras?: {
    /** 目录描述文案（UI 展示）。[已核对-U4] */
    description?: string;
    /** 图片像素预算（offload 链路用）。[已核对-U4] */
    imagePixelBudget?: number;
    /** 图片字节上限（offload 链路用）。[已核对-U4] */
    imageMaxBytes?: number;
    /** system prompt 更新策略，目录实测值域 "in-history"。[已核对-U4] */
    systemPromptUpdate?: "in-history";
    /** 工具更新策略。[已核对-U4] */
    toolUpdate?: "in-history" | "addition-only";
  };
  /** 档案级自由备注（审计线索）。[推断-命名] */
  notes?: string[];
  /** 最后修改时间 ISO8601。[推断-命名] */
  updatedAt: string;
}

// ============================================================
// B2 §2.4 — 投影产物层（SettingsOp / ProjectionResult / Preview）
// ============================================================

/** settings 写操作：路径式 set/remove，交宿主 mutate(ns, ops, expectedRevision)。[已核对-基线 A7；op 具体编码待验证-0.2.x] */
export interface SettingsOp {
  /** set = 写值；remove = 删键。[推断-设计定案] */
  kind: "set" | "remove";
  /** 目标命名空间（pi-ai / deepseek 各自 ns）。[已核对-基线 A7] */
  ns: SettingsNamespace;
  /** ns 根起算点分路径；models 索引段为十进制字符串，如 `providers.acme.models.0.contextWindow`。[已核对-基线 A7：String(i)] */
  path: string;
  /** kind="set" 的值；kind="remove" 必须省略。[推断-设计定案] */
  value?: unknown;
}

/** 已应用字段记录：审计与 UI 对账。[推断-设计定案] */
export interface AppliedFieldRecord {
  /** 档案字段或 reasoning。[推断-设计定案] */
  field: ProfileFieldId | "reasoning";
  /** 实际写入的 settings 路径。[推断-设计定案] */
  wirePath: string;
  /** 对应 ops 下标（顺序敏感）。[推断-设计定案] */
  opIndex: number;
  /** 值来源。[已核对-基线] */
  origin: Origin;
}

/** profile-only 原因码。[推断-设计定案] */
export type ProfileOnlyReason =
  | "no-per-model-slot"       // 宿主无条目级承接点（budget → pi-ai 路由级 / deepseek 无）。[已核对-源码 A8/A5]
  | "host-field-absent"       // 宿主条目无此字段（outputModalities）。[已核对-基线]
  | "out-of-whitelist-v1"     // v1 白名单外（compat、deepseekExtras、未知协议字段）。[已核对-U4]
  | "route-write-would-leak"; // 只能路由级写且会波及同路由其他模型，默认不写（budget、deepseek 路由级 reasoning 的可选档）。[推断-设计定案]

/** 仅档案字段记录。[推断-设计定案] */
export interface ProfileOnlyRecord {
  /** 字段或控制项。[推断-设计定案] */
  field: ProfileFieldId | "reasoning" | "budget" | "compat" | "deepseekExtras" | "unknownProtocolField";
  /** 归类原因。[推断-设计定案] */
  reason: ProfileOnlyReason;
}

/** 投影拒绝原因码（unsupportedControls 用）。[推断-设计定案] */
export type UnsupportedReasonCode =
  | "efforts-dict-not-in-dialect"   // reasoningEfforts dict 输入 deepseek：档位系不同，禁止静默映射。[已核对-基线 A6]
  | "level-not-in-dialect"          // 策略档位 ∉ 驱动档位系（如 medium → deepseek）。[已核对-基线 A6]
  | "level-required"                // 方言要求显式档位而策略缺省（deepseek effort 无 defaultLevel）。[推断-设计定案]
  | "no-per-model-slot"             // 无条目级承接点（budget）。[已核对-源码 A8]
  | "missing-route-prerequisites"   // hand-declared 路由缺 api+baseURL，整体拒写。[已核对-基线（兜底规则给定）]
  | "duplicate-model-id"            // 目标条目 id 与现有 models 重复，宿主拒绝 → 客户端预检拒绝。[已核对-源码 A2]
  | "overrides-channel-conflict"    // 路由已用非空 modelOverrides，未知 ID 无法走 overrides 通道且 models 与之互斥。[已核对-源码 A2]
  | "route-write-rejected"          // 路由级写入被策略禁止（route-scope 开关关闭）。[推断-设计定案]
  | "unknown-protocol-field";       // 未知协议字段，不猜路径。[推断-设计定案]

/** 不可投影控制项记录。[推断-设计定案] */
export interface UnsupportedControl {
  /** 被拒控制项。[推断-设计定案] */
  control: ProfileFieldId | "reasoning" | "budget";
  /** 拒绝原因码。[推断-设计定案] */
  code: UnsupportedReasonCode;
  /** 人读详情（UI 提示文案素材）。[推断-设计定案] */
  detail: string;
}

/** 投影警告码（非阻塞，UI 必须展示）。[推断-设计定案] */
export type ProjectionWarningCode =
  | "catalog-replacement"        // pi-ai models 非空数组整体替换路由目录：目录中其他模型将从该路由消失。[已核对-源码 A2]
  | "models-overrides-exclusive" // modelOverrides 与 models 互斥警示。[已核对-源码 A2]
  | "unknown-key-dropped"        // 白名单外键写入后会被宿主物化丢弃。[已核对-源码 A2]
  | "cleared-lossy"              // cleared 无 wire 空值表达，退化为删键。[推断-设计定案]
  | "budget-route-level"         // budget 需路由级写入才生效，同路由其他模型受影响。[已核对-源码 A8]
  | "route-level-reasoning"      // deepseek 推理是路由级：影响该 models[] 全体。[已核对-源码 A5]
  | "hand-declared-no-catalog"   // hand-declared 路由无目录背书：能力值全靠用户/实测。[已核对-基线]
  | "max-tokens-default-budget"; // 条目 maxTokens 将被物化为请求缺省预算（A4 三值展示义务）。[已核对-源码 A4]

/** 投影警告。[推断-设计定案] */
export interface ProjectionWarning {
  /** 警告码。[推断-设计定案] */
  code: ProjectionWarningCode;
  /** 人读详情。[推断-设计定案] */
  detail: string;
  /** 关联 settings 路径（可缺省）。[推断-命名] */
  path?: string;
}

/** 请求侧推理参数预览。[推断-设计定案] */
export type ReasoningWire =
  | { /** 不发送。[推断-设计定案] */ sent: false; /** 不发原因：非推理 / off:null / thinking:disabled / 路由未声明。[已核对-源码 A3/A5] */ why: "non-reasoning" | "off-null-omit" | "thinking-disabled" | "route-omit" }
  | { /** 发送。[推断-设计定案] */ sent: true; /** 参数名：pi-ai reasoningEffort / deepseek thinking 或 reasoningEffort。[已核对-源码 A3/A5] */ param: "reasoningEffort" | "thinking"; /** 发送值。[已核对-源码] */ value: string | boolean | number };

/** 请求预览：把投影结果"翻译回一次调用"给用户看。[推断-设计定案] */
export interface RequestPreview {
  /** 驱动。[已核对-基线] */
  driverId: DriverId;
  /** 本次调用将使用的 wire 模型 id。[已核对-基线] */
  modelWireId: string;
  /** 推理参数预览。[推断-设计定案] */
  reasoningWire: ReasoningWire;
  /** maxTokens wire 值（请求显式时为请求值）。[已核对-源码 A4] */
  maxTokensWire?: number;
  /** A4 三值语义：请求显式 / 条目值物化为缺省预算 / 宿主路由缺省。[已核对-源码 A4] */
  maxTokensResolution: "request-explicit" | "profile-default" | "host-default";
  /** 合并后的路由级可见字段快照（displayName/api/baseURL 等，凭据字段必须脱敏）。[推断-设计定案] */
  mergedRouteFields: Record<string, unknown>;
  /** 预览备注（警告的人读形态）。[推断-命名] */
  notes: string[];
}

/** 预览保真度。[推断-设计定案] */
export type PreviewFidelity =
  | "exact"          // 完整复刻 resolveRouteModels + resolveModelReasoning 语义（基于 hostState 全量快照）。[推断-设计定案]
  | "merged-approx"  // 路由级合并近似（hostState 不完整，如缺目录快照）。[推断-设计定案]
  | "static-only";   // 无请求侧验证，仅静态推导（P0–P2 常态）。[已核对-U5]

/** 投影结果（settingsOps/appliedFields/profileOnlyFields/unsupportedControls/requestPreview/previewFidelity 六字段为任务给定对外契约；warnings 为引擎汇总扩展字段，收纳各 adapter 产物）。[已核对-基线（六字段给定）+ 推断-设计定案（warnings 扩展）] */
export interface ProjectionResult {
  /** settings 操作序列（顺序敏感：先决条件 → 条目 → 路由级 → 清理）。[推断-设计定案] */
  settingsOps: SettingsOp[];
  /** 已应用字段。[推断-设计定案] */
  appliedFields: AppliedFieldRecord[];
  /** 仅档案字段。[推断-设计定案] */
  profileOnlyFields: ProfileOnlyRecord[];
  /** 不可投影控制项（含整体拒写）。[推断-设计定案] */
  unsupportedControls: UnsupportedControl[];
  /** 非阻塞警告。[推断-设计定案] */
  warnings: ProjectionWarning[];
  /** 请求预览。[推断-设计定案] */
  requestPreview: RequestPreview;
  /** 预览保真度。[推断-设计定案] */
  previewFidelity: PreviewFidelity;
}

// ============================================================
// B2 §2.5 — 宿主状态与驱动能力
// ============================================================

/** 宿主 models 数组现有条目快照。[推断-设计定案] */
export interface HostModelEntry {
  /** 数组下标（settings 路径 String(i) 用）。[已核对-基线 A7] */
  index: number;
  /** 条目 id（pi-ai modelProfile.id / deepseek catalogModel.id）；手工条目可能缺省。[已核对-源码 A1/A5] */
  id?: string;
  /** 原始键值（投影 diff 用）。[推断-设计定案] */
  raw: Record<string, unknown>;
}

/** 宿主路由现状快照：toSettingsOps 的输入事实。[推断-设计定案] */
export interface HostRouteState {
  /** 命名空间。[已核对-基线 A7] */
  ns: SettingsNamespace;
  /** provider id（settings providers.<id>）。[已核对-基线 A7] */
  providerId: string;
  /** provider 条目是否已存在（不存在时仅允许"新建 hand-declared"流程）。[推断-设计定案] */
  exists: boolean;
  /** 未知路由：provider 存在但 routeId ∉ 已安装目录路由集合，或用户手工新建。[已核对-基线（hand-declared 给定）] */
  handDeclared: boolean;
  /** pi-ai 路由级 api（API 适配种类）。[已核对-基线 A9] */
  api?: string;
  /** 路由级 baseURL。[已核对-基线 A9] */
  baseURL?: string;
  /** 现有 models 数组快照。[推断-设计定案] */
  models: HostModelEntry[];
  /** pi-ai 现有 modelOverrides（与 models 互斥的判据）。[已核对-源码 A2] */
  modelOverrides?: Record<string, Record<string, unknown>>;
  /** 路由级字段快照（thinkingBudgets / reasoningEffort / thinking / defaults…，凭据脱敏）。[推断-设计定案] */
  routeLevel: Record<string, unknown>;
  /** 读取时的 settings revision，透传 mutate 防 SETTINGS_CONFLICT。[已核对-基线 A7] */
  revision: number;
}

/** 驱动能力声明：投影器的静态事实表（规则表的机器可读形态）。[推断-设计定案] */
export interface DriverCapabilities {
  /** 驱动 id。[已核对-基线] */
  driverId: DriverId;
  /** 方言。[推断-命名] */
  protocol: WireProtocol;
  /** 条目级可投影字段白名单（顺序即 UI 展示序）。[已核对-U4（deepseek 白名单）+ A1] */
  perModelFields: readonly ProfileFieldId[];
  /** 推理是否路由级（pi-ai 条目级 dict + 路由级 thinkingBudgets；deepseek 纯路由级）。[已核对-源码 A3/A5/A8] */
  routeLevelReasoning: boolean;
  /** 本方言档位系（pi-ai 七档；deepseek 四档 off|low|high|max）。[已核对-源码 A1/A5] */
  reasoningLevels: readonly ReasoningLevelId[];
  /** 是否支持条目级 effortMap（pi-ai true；deepseek false）。[已核对-源码 A3/A6] */
  supportsEffortMap: boolean;
  /** 是否支持条目级 modelOverrides（pi-ai true；deepseek false）。[已核对-源码 A2/A5] */
  supportsPerModelOverrides: boolean;
  /** 是否存在路由级 budget 承接点（pi-ai thinkingBudgets；deepseek 无）。[已核对-源码 A8/A5] */
  supportsRouteBudgets: boolean;
  /** 路由级缺省值（展示与"继承态"计算）。[已核对-源码 A9/A5] */
  defaults: {
    /** pi-ai 32768 / deepseek 256e3。[已核对-源码 A9/A5] */
    maxTokens: number;
    /** pi-ai 262144 / deepseek 1e6。[已核对-源码 A9/A5] */
    contextWindow: number;
    /** pi-ai ["text"] / deepseek ["text"]。[已核对-源码 A9/A5] */
    inputModalities: readonly Modality[];
  };
  /** models 非空数组是否整体替换路由目录（pi-ai true；deepseek models[] 即目录本身，视作 true）。[已核对-源码 A2/A5] */
  modelsArrayReplacesCatalog: boolean;
  /** 写 models 前必须存在的路由先决字段（hand-declared 兜底：api + baseURL）。[已核对-基线（兜底规则给定）] */
  requiresRoutePrerequisites: readonly ("api" | "baseURL")[];
}

// ============================================================
// B2 §2.6 — 校验与推理投影产物
// ============================================================

/** 字段校验结果。[推断-设计定案] */
export type FieldValidation =
  | { ok: true; /** 归一化后的值（如模态裁剪、数字取整）。[推断-设计定案] */ normalized?: unknown; /** 非阻塞警告（裁剪/降级告知）。[推断-设计定案] */ warnings: ProjectionWarning[] }
  | { ok: false; /** 校验失败码。[推断-设计定案] */ code: FieldValidationCode; /** 人读详情。[推断-设计定案] */ detail: string };

/** 字段校验失败码。[推断-设计定案] */
export type FieldValidationCode =
  | "type-mismatch"          // 类型不符（数字字段给了字符串等）。[推断-设计定案]
  | "not-positive-int"       // 需正整数（contextWindow/maxTokens/budget.tokens）。[推断-设计定案]
  | "modality-unknown"       // 出现 {text,image} 之外模态（parser 保留、投影拒绝/裁剪）。[已核对-源码 A1]
  | "modality-empty"         // 模态数组为空。[推断-设计定案]
  | "effort-value-type"      // effortMap 值类型非法（必须 string；仅 off 可 null）。[已核对-源码 A3]
  | "effort-null-on-non-off" // 非 off 档出现 null。[已核对-源码 A3]
  | "effort-map-off-only"    // dict 只含 off 档（宿主拒绝条件 R2）。[已核对-源码 A3]
  | "level-unknown"          // 引用了未声明且目录也没有的档位（宿主"未声明档 pin 不支持"）。[已核对-源码 A3]
  | "duplicate-model-id"     // models/modelOverrides 内 id 重复。[已核对-源码 A2]
  | "unknown-field";         // 白名单外字段（进入 validateField 即拒绝，防误写）。[已核对-U4]

/** projectReasoning 成功产物：fieldOps 必有，routeOps 仅方言需要路由级表达时出现。[推断-设计定案] */
export interface ReasoningProjectionOk {
  /** 条目级 ops（pi-ai reasoningEfforts 写/删）。[已核对-源码 A3] */
  fieldOps: SettingsOp[];
  /** 路由级 ops（deepseek thinking/reasoningEffort；pi-ai 仅在显式 route-scope 开启时承载 thinkingBudgets）。[已核对-源码 A5/A8] */
  routeOps?: SettingsOp[];
  /** 备注（语义差异提示，如 false ≠ off:null）。[已核对-源码 A3] */
  notes?: string[];
}

/** projectReasoning 失败产物：{unsupported, reason} 字面形态。[已核对-基线（形态给定）] */
export interface ReasoningProjectionUnsupported {
  /** 恒 true，判别用。[推断-设计定案] */
  unsupported: true;
  /** 拒绝原因码。[推断-设计定案] */
  code: UnsupportedReasonCode;
  /** 人读原因。[已核对-基线] */
  reason: string;
}

/** 推理策略投影结果：成功给 fieldOps，失败给 unsupported + reason（任务给定字面形态）。[已核对-基线] */
export type ReasoningProjection =
  | (ReasoningProjectionOk & { unsupported?: undefined })
  | (ReasoningProjectionUnsupported & { fieldOps?: undefined; routeOps?: undefined; notes?: undefined });

/** projectReasoning 的驱动侧事实视图（HostRouteState + 目录快照的推理切片）。[推断-设计定案] */
export interface DriverRouteFacts {
  /** 路由 id。[推断-惯例] */
  routeId: string;
  /** 方言。[推断-命名] */
  protocol: WireProtocol;
  /** 条目当前已声明档位（pi-ai dict keys；deepseek 无条目级）。[已核对-源码 A3] */
  declaredLevels?: readonly ReasoningLevelId[];
  /** 目录声明的档位（继承来源；hand-declared 为空）。[已核对-源码 A3：未声明=继承目录] */
  catalogDeclaredLevels?: readonly ReasoningLevelId[];
  /** deepseek 路由级 thinking 现值。[已核对-源码 A5] */
  thinking?: "enabled" | "disabled";
  /** deepseek 路由级 reasoningEffort 现值。[已核对-源码 A5] */
  routeReasoningEffort?: "off" | "low" | "high" | "max";
  /** pi-ai 路由级 thinkingBudgets 现值。[已核对-源码 A8] */
  thinkingBudgets?: ThinkingBudgets;
}

// ============================================================
// B2 §2.7 — HostProjectionAdapter 接口
// ============================================================

/** toSettingsOps 的返回：任务给定形态 {ops, warnings}；完整 ProjectionResult 由投影引擎（B3）汇总各 adapter 产物后组装。[已核对-基线] */
export interface ProjectionBatch {
  /** settings 操作序列。[推断-设计定案] */
  ops: SettingsOp[];
  /** 非阻塞警告。[推断-设计定案] */
  warnings: ProjectionWarning[];
}

/**
 * 宿主投影适配器：每驱动一个实现，纯函数、无 IO、无宿主调用；
 * 所有事实经入参（HostRouteState / DriverRouteFacts）注入，便于单测与 diff 预演。[推断-设计定案]
 */
export interface HostProjectionAdapter {
  /** 驱动 id（注册键）。[推断-设计定案] */
  readonly driverId: DriverId;

  /** 驱动能力声明（规则表的机器可读形态）。任务书形态 capabilities(driverId) 由注册表函数 driverCapabilities(driverId) 提供。[推断-设计定案] */
  capabilities(): DriverCapabilities;

  /** 单字段校验（编辑器即时反馈 + 投影前复检）；key 用于方言相关校验（如 hand-declared 判定）。[推断-设计定案] */
  validateField(key: ModelKey, field: ProfileFieldId, value: unknown): FieldValidation;

  /** 全量投影：profile + 宿主现状 → settings ops。整体拒写时 ops=[] 且在 ProjectionResult.unsupportedControls 表达（由引擎组装）。[已核对-基线 A7] */
  toSettingsOps(profile: ModelProfileV2, hostState: HostRouteState, revision: number): ProjectionBatch;

  /** 推理策略投影：成功 {fieldOps(,routeOps,notes)}，失败 {unsupported, reason}。必须复刻宿主拒绝条件在客户端先行校验（§4.R 清单）。[已核对-源码 A3] */
  projectReasoning(policy: ReasoningPolicy, driver: DriverRouteFacts): ReasoningProjection;
}

/** 驱动注册表：driverCapabilities(driverId) 即任务书 capabilities(driverId) 形态；实现由 B3 装配（pi-ai / deepseek 各一份字面量表），此处仅声明契约。[推断-设计定案] */
export declare function driverCapabilities(driverId: DriverId): DriverCapabilities;
```

---

## 3. HostProjectionAdapter 接口设计说明

[推断-设计定案] 五条设计决定：

1. **纯函数、事实注入**：adapter 不读宿主、不发请求；`HostRouteState`/`DriverRouteFacts` 由调用方（B3 投影引擎）准备。这样 diff 预演（"写了会怎样"）与真实写共用同一条代码路径，SETTINGS_CONFLICT 重试也只发生在引擎层。
2. **职责切分**：`validateField` 服务编辑器即时校验（字段级）；`projectReasoning` 服务推理策略（跨条目/路由两级，语义最险）；`toSettingsOps` 服务整体落盘（组装 + 副作用警告）。三层复用同一套字段词表（`ProfileFieldId`），禁止 adapter 私有词表。
3. **整体拒写不走异常**：`toSettingsOps` 返回 `{ops, warnings}`（任务给定形态）；拒写（缺先决条件 / 重复 ID / overrides 冲突）表现为 `ops: []`，原因由引擎归入 `ProjectionResult.unsupportedControls`（code 复用 `UnsupportedReasonCode`）。保持返回形态稳定，UI 不需要两套错误通道。
4. **capabilities 静态化**：`DriverCapabilities` 是常量表，pi-ai/deepseek 各一份字面量；规则表（§4/§5）是它的人读投影，两者必须同步修改（B3 侧加一致性测试：表驱动断言 capabilities 与文档表格行一致）。
5. **reasoning 拒绝优先于一切写**：`projectReasoning` 的失败会让引擎丢弃本次全部 ops（推理写坏一条 → pi-ai 路由整体解析失败，代价是整路由模型不可用，见 §4.R）。

---

## 4. pi-ai 投影规则表

[已核对-源码] 字段词表对照（档案字段 → wire 路径；`<P>` = providerId，`<i>` = models 数组下标十进制字符串）：

| 档案字段 | wire 路径 | 校验（validateField） | 副作用 / 警告 | 分类 |
| --- | --- | --- | --- | --- |
| displayName | `providers.<P>.models.<i>.name` | 非空 string | 无 | host |
| contextWindow | `providers.<P>.models.<i>.contextWindow` | 正整数 | 无（展示时叠加继承链 defaultContextWindow=262144） | host |
| maxTokens | `providers.<P>.models.<i>.maxTokens` | 正整数 | `max-tokens-default-budget`（A4：调用未显式给 maxTokens 时条目值物化为缺省预算，预览必须三值分明） | host |
| inputModalities | `providers.<P>.models.<i>.input` | 数组 ⊆ {text,image}、非空、去重 | 未知模态裁剪并警告（parser 全量保留） | host |
| reasoning = disabled | `providers.<P>.models.<i>.reasoningEfforts = false` | 见 R 清单 | `false` = 非推理 ≠ `off:null`（不发参数）；UI 必须区分两种"关" | host |
| reasoning = effort | `providers.<P>.models.<i>.reasoningEfforts = <dict>` | 见 R 清单（effortMap 投影） | 见 R 清单 | host |
| reasoning = inherit | remove `providers.<P>.models.<i>.reasoningEfforts`（若存在） | — | 无键则 no-op | host |
| reasoning = budget | 无条目承接点 | — | profile-only（`no-per-model-slot`）+ `budget-route-level` 警告；可选路由级写 `providers.<P>.thinkingBudgets`，默认关闭（`route-write-would-leak`：波及同路由全部模型） | profile-only |
| outputModalities | 无宿主字段 | — | profile-only（`host-field-absent`） | profile-only |
| compat（24 字段） | `providers.<P>.models.<i>.compat.*`（可写） | 逐字段词表 P2 建 | v1 白名单外 → profile-only（`out-of-whitelist-v1`），只存不写 | profile-only（v1） |
| deepseekExtras / 未知协议字段 | 不猜路径 | `unknown-field` | profile-only（`out-of-whitelist-v1` / `unknown-protocol-field`） | profile-only |

### 4.1 models / modelOverrides 通道规则

[已核对-源码 A2]

- **models 非空 = 整体替换路由目录**：向目录路由（`handDeclared=false` 且原无 models 数组）写入新条目时，宿主目录里其他模型将从该路由消失 → 强制 `catalog-replacement` 警告，UI 侧（B4 diff-review）必须显式确认后才允许落盘；引擎在未确认状态返回 ops=[]。
- **追加语义**：路由已有 models 数组时，投影 = 读取 `hostState.models` → 追加本条目（下标 = 现有长度）→ 整体回写数组；不重排既有条目（保持用户既有序与既有 settings 下标稳定）。
- **互斥**：`hostState.modelOverrides` 非空时写 models → `models-overrides-exclusive` 警告；且未知 ID 无法走 modelOverrides 通道（只收已安装目录内 ID）→ 若同时 `handDeclared=false` 且 overrides 非空，整体拒写（`overrides-channel-conflict`），提示用户改走新建 hand-declared provider。
- **重复 ID**：`rawModelId` 已存在于 `hostState.models`（或 override 键集）→ 拒写（`duplicate-model-id`）；同名不同大小写视为重复（宿主按字面匹配，保守等同）。
- **未知键丢弃**：档案中白名单外字段若被用户期待写入 → `unknown-key-dropped` 警告（宿主物化时丢弃）。

### 4.2 reasoningEfforts 合法性预检（R 清单）

[已核对-源码 A3] 目标：**在客户端先行复刻宿主 `resolveModelReasoning` 的全部拒绝条件**，避免写入后路由整体解析失败（一条坏 dict 报废整个路由的模型目录）。违反任一条 → `projectReasoning` 返回 unsupported（或 validateField 拒绝），不产生 ops：

- **R1 形态**：值只能是 `false` 或对象；对象键 ⊆ {off,minimal,low,medium,high,xhigh,max}，值 string 或 null。非 off 键为 null → 拒（`effort-null-on-non-off`）；off 以外档值必须 string（`effort-value-type`）。
- **R2 非空档**：对象至少含一个 off 以外档位键 → 否则拒（`effort-map-off-only`）。
- **R3 off 双义**：`off: null` = 请求不发参数；`off: "<wire>"` = 发送该值。两者都合法，但 UI 必须展示差异（这是"推理模型但不发参数"与"非推理 false"的第三种态）。
- **R4 档位引用**：`policy.effort.defaultLevel` 若 ∉ 写入 dict 键 且 ∉ `driver.catalogDeclaredLevels` → 拒（`level-unknown`；宿主侧 = "未声明档 pin 不支持"，请求期 `UNSUPPORTED_REASONING_EFFORT` 先于 IO 抛出）。
- **R5 xhigh/max 显式**：`defaultLevel ∈ {xhigh, max}` 时写入 dict **必须显式含该档**（`level-unknown` 拒；即使目录看似声明也要求显式，保守策略 [推断-设计定案]）。
- **R6 disabled 表达**：`policy.mode="disabled"` → 写 `reasoningEfforts: false`；严禁翻译成 `off: null`（语义不同：false=非推理模型；off:null=推理模型但请求省略参数）。
- **R7 wireProfile 自洽**：所选 `WireProfile.protocol !== "pi-ai"` → 拒（`efforts-dict-not-in-dialect` 同码复用，detail 指明方言错配）。

### 4.3 路由级字段（pi-ai）

[已核对-基线 A9] `apiKeyEnv / displayName / api / baseURL / headers / reasoning / transport / timeoutMs / cacheRetention / defaultContextWindow / defaultMaxTokens / defaultInput` 属连接管理层（B1/B3 域），B2 投影器**只读不写**；`thinkingBudgets` 是唯一预算承接点但为路由级 → 默认 profile-only（见上表 budget 行）。

---

## 5. deepseek 投影规则表

[已核对-源码/U4 A5/A6] 白名单五项 + 路由级推理：

| 档案字段 | wire 路径 | 校验 | 副作用 / 警告 | 分类 |
| --- | --- | --- | --- | --- |
| displayName | `providers.<P>.models.<i>.name` | 非空 string | 无 | host |
| contextWindow | `providers.<P>.models.<i>.contextWindow` | 正整数 | 展示继承链 defaultContextWindow=1e6 | host |
| maxTokens | `providers.<P>.models.<i>.maxTokens` | 正整数 | 展示路由缺省 256e3；同样受 A4 类"缺省预算"语义影响（deepseek 路由级 maxTokens 缺省）[推断-设计定案] | host |
| inputModalities | `providers.<P>.models.<i>.inputModalities` | 数组 ⊆ {text,image}、非空、去重；缺省 ["text"] | 未知模态裁剪 | host |
| reasoning = effort | `providers.<P>.reasoningEffort = <level>` | level ∈ {off,low,high,max}；policy 无 defaultLevel → 拒（`level-required`） | `route-level-reasoning` 警告：影响该 models[] 全体条目 | host（路由级） |
| reasoning = disabled | `providers.<P>.thinking = "disabled"` | — | `route-level-reasoning` 警告；与 `reasoningEffort:"off"` 的取舍见 5.1 | host（路由级） |
| reasoning = inherit | 不写任何路由级推理键（若现值存在且源于本档案则 remove） | — | 无 | host |
| reasoning（输入为 reasoningEfforts dict） | — | — | **`efforts-dict-not-in-dialect` 拒**：档位系不同（七档 vs 四档，无 minimal/medium/xhigh），禁止静默映射 [已核对-基线 A6] | unsupported |
| reasoning = budget | 无任何承接点（无 thinkingBudgets） | — | profile-only（`no-per-model-slot`） | profile-only |
| outputModalities | 无宿主字段 | — | profile-only（`host-field-absent`） | profile-only |
| deepseekExtras（description/imagePixelBudget/imageMaxBytes/systemPromptUpdate/toolUpdate） | 可写但插件白名单不写 | — | profile-only（`out-of-whitelist-v1`，U4：保持最小写入面） | profile-only |
| compat | 本方言无此字段 | — | 输入即 `unknown-protocol-field`（若档案源自 pi-ai 复制） | profile-only |

### 5.1 deepseek 推理投影细则

[已核对-源码 A5 + 推断-设计定案]

- **effort 档位校验**：`policy.effort.defaultLevel` 必须 ∈ {off,low,high,max}，否则 `level-not-in-dialect`（如 medium/xhigh/minimal）；**不做最近档映射**（medium→low 之类一律拒绝，理由同 A6：档位系不同禁止静默映射）。
- **disabled 主表达**：写路由级 `thinking: "disabled"`（与目录字段同形）；`reasoningEffort: "off"` 作为用户显式选择 `WireDisableSpec{protocol:"deepseek", kind:"effort-off"}` 时的替代表达。两者并存时的宿主优先级 [待验证-0.2.x]——保守默认：disabled 策略只写 `thinking`，不动 `reasoningEffort`，预览按"thinking 优先"标注。
- **路由级波及**：deepseek 单路由多模型时，路由级推理写影响全部条目 → 除警告外，B4 UI 需显示受影响模型清单（来自 `hostState.models`）。
- **models 数组**：deepseek `models[]` 即路由自身目录；追加规则同 §4.1 追加语义，重复 ID 拒绝（`duplicate-model-id`）；无 modelOverrides 通道（`supportsPerModelOverrides=false`）。

---

## 6. 未知路由兜底投影（hand-declared route）

[已核对-基线（兜底规则给定）+ 推断-设计定案]

**定义**：`hostState.handDeclared = true`（provider 存在但 routeId ∉ 已安装目录路由集合，或用户从零新建的 provider 条目）。

规则：

1. **先决条件**：必须同时具备 `api` 与 `baseURL`（`hostState.api` 与 `hostState.baseURL` 均为非空 string）才允许写任何 models 条目。缺失 → 整体拒写（`missing-route-prerequisites`，ops=[]）。v1 投影器**不代填**这两个字段——它们是连接身份，归 B1 连接管理域；投影器只在 UI 文案中指路。
2. **空路由追加**：`hostState.models` 为空/不存在 → 创建数组，本条目写 `models.0`（路径段 `String(0)`）；此场景无目录可丢，**不触发** `catalog-replacement`（无 catalog 可替换），改发 `hand-declared-no-catalog` 提示（能力值全部来自 user-declared / parameter-tested，UI 需标注"无目录背书"）。
3. **非空路由追加**：按 §4.1 追加语义执行（读现有数组 → 尾部追加 → 回写）；重复 ID 拒绝。
4. **hand-declared 上的目录继承失效**：`DriverRouteFacts.catalogDeclaredLevels` 视为空 → R4/R5 预检严格按写入 dict 判定，任何 `defaultLevel` 未在 dict 显式声明即拒（`level-unknown`）——hand-declared 没有目录兜底，宁严勿松。
5. **Evidence 要求**：hand-declared 条目的能力值若全部 `origin=user-declared`，预览保真度封顶 `static-only`；一旦用户跑过验证请求（U5 通道），相关 Evidence 升级 `parameter-tested`，保真度可到 `exact`。

---

## 7. 投影三分类判定表

[已核对-基线 + 推断-设计定案] 每个档案控制项的归宿：**可应用宿主**（进 settingsOps）/ **仅档案 profile-only**（存档不写）/ **需 runtime adapter（P3+）**。

| 控制项 | pi-ai | deepseek | 分类 | 阶段 |
| --- | --- | --- | --- | --- |
| displayName | 条目 `name` | 条目 `name` | host | P0 |
| contextWindow | 条目 `contextWindow` | 条目 `contextWindow` | host | P0 |
| maxTokens | 条目 `maxTokens`（A4 三值展示义务） | 条目 `maxTokens` | host | P0 |
| inputModalities | 条目 `input` | 条目 `inputModalities` | host | P0 |
| reasoning = disabled | 条目 `reasoningEfforts: false` | 路由 `thinking:"disabled"` | host | P0 |
| reasoning = effort（本方言档位） | 条目 `reasoningEfforts` dict | 路由 `reasoningEffort`（四值） | host | P0 |
| reasoning = effort（跨方言档位/dict） | —（收到他方言 dict 拒） | `efforts-dict-not-in-dialect` / `level-not-in-dialect` | unsupported（不投影） | P0 |
| reasoning = inherit | remove 条目键 | 不写路由键 | host | P0 |
| budget | 路由 `thinkingBudgets`（无条目承接点） | 无 | profile-only（`no-per-model-slot` + `budget-route-level`） | P0 存档；路由写 P2（显式 route-scope 开关） |
| outputModalities | 无条目字段 | 无条目字段 | profile-only（`host-field-absent`） | P0 |
| compat（pi-ai 24 字段） | 可写但 v1 白名单外 | 无此字段 | profile-only（`out-of-whitelist-v1`） | P2 评估直写 |
| deepseekExtras | — | 白名单不写 | profile-only（`out-of-whitelist-v1`） | P2 评估 |
| 未知协议字段（未来宿主新增键） | 不猜路径 | 不猜路径 | profile-only（`unknown-protocol-field`） | 持续 |
| 参数实测 wire 值回填（effortMap wire 值修正） | 需请求侧观测 | 需请求侧观测 | runtime adapter | P3+（U5 waterfall，按可拒设计） |
| 预算运行时执行（agent/request 改写） | waterfall 通道 | waterfall 通道 | runtime adapter | P3+（U5，自检探测 + ledger） |

---

## 8. Open Questions + 保守默认

### Open Questions

| # | 问题 | 标签 | 建议验证点 |
| --- | --- | --- | --- |
| Q1 | 宿主 `mutate` 的 op 具体编码（path/value 对 vs patch 对象）与本档 `SettingsOp` 的换算 | [待验证-0.2.x] | 读 settings 包 op 执行器源码；adapter 内做一次归一化即可隔离 |
| Q2 | pi-ai 单 provider 是否存在多路由形态（影响 ModelKey.routeId = providerId 的惯例） | [待验证-0.2.x] | resolveRouteModels 的路由键来源 |
| Q3 | deepseek `thinking` 与 `reasoningEffort:"off"` 并存时宿主优先级 | [待验证-0.2.x] | 请求构造器读取顺序 |
| Q4 | `cleared` 在 contextWindow/maxTokens/input 上"删键降级"是否满足 a.md §3.B 原意 | [推断-设计定案] | 与 a.md 作者对表；UI 需显式展示 lossy |
| Q5 | 单值 budget（policy.budget.tokens）→ 四桶 thinkingBudgets 的映射策略（写哪桶？其余桶缺省行为？） | [推断-设计定案→P2] | 仅在 route-scope 开启后设计 |
| Q6 | models.dev `outputModalities` 是否值得尝试写入 pi-ai `compat` 键曲线表达 | [待验证-0.2.x] | compat 24 字段语义表建立后判定 |
| Q7 | SETTINGS_CONFLICT 重试归属（引擎重试 vs 交还 UI）与 revision 刷新策略 | [推断-设计定案] | 引擎单次重读-重投影（≤2 次），仍冲突则交 UI |
| Q8 | pi-ai 条目级 `reasoning`（路由级字段之一）与条目 dict 的叠加语义是否需要投影器感知 | [待验证-0.2.x] | resolveModelReasoning 是否读路由级 reasoning |

### 保守默认（与上表冲突时按此收敛）

1. **未知字段一律 profile-only，不猜路径**——写错路径的代价（静默无效或解析失败）高于少写一个字段。
2. **档位系不同一律 unsupported，不做最近档/近似映射**——A6 红线，无例外。
3. **路由级写入默认关闭**——任何会波及同路由其他模型的操作（thinkingBudgets、deepseek 路由推理例外项）必须显式 route-scope 开关 + 受影响清单展示。
4. **cleared 无空值表达 → 删键 + lossy 警告**，绝不造宿主不存在的值（如写 0 或空串）。
5. **hand-declared 缺先决条件 → 整体拒写**，不部分落盘（半初始化路由比没有路由更难排查）。
6. **推理预检失败 → 丢弃全部 ops**，不让"其他字段先写进去"造成半态。
7. **预览保真度就低不就高**：证据不完整时标 `static-only` / `merged-approx`，UI 明示，不冒充 `exact`。
