# ModelPilot — v2 开发方案（定稿）

日期：2026-11-10。状态：**定稿，可开工**。本文合并 B1–B5 五路设计（`docs/design-parts/`），裁决对齐点（`ALIGNMENT-LEDGER.md`），全部宿主断言来自 dsh-compat-audit（0.2.0-rc.2 / 0.2.1-rc.2 双版实测）与 gap-fill（docs/01-gap-fill.md）、p0-evidence-notes.md（N1–N8）。
证据标签：[已核对-源码] / [已执行-探针] / [已核对-基线]（引用审计报告）/ [推断-设计定案] / [待验证-*]。

---

## 1. 产品定义与首版边界

**ModelPilot = DSH 模型配置助手插件**：输入模型 ID，结合可信目录（models.dev + 宿主 discovery）、本地档案与预设，生成可解释的模型配置；用户选择后回填草稿，经字段级最小 patch 应用到 DSH。

三类结果分离（承袭 b.md，审计维持）：**能力事实 Capability**（来源宣称什么）/ **用户配置 Profile**（用户要什么）/ **执行投影 Projection**（driver 实际接受什么、发出什么）。

首版边界（a.md 四项必修全部吸收）：

1. **原生回填提前 P0**：slot 无 draft 注入面（两版 slot 载荷逐字稳定 [已核对-基线]），首版双入口 = provider-card/footer 槽入口 + 自注册 `settings.section` 工作台（id `modelpilot.workbench`）；NativeFormBridge 为可选增强且默认关闭（B4-OQ3 保守默认），失败显式降级不静默。
2. **三态数据结构**：`StoredField<T> = value | inherit | cleared`（B2 §2，tsc strict 通过）；清空不复用 0/false/[]；`cleared-lossy` 仅在字段无 wire 空值表达时退化为删键并告警。
3. **推理承诺收敛**：effort 档位映射可真实投影（客户端 R1–R7 预检复刻 [已核对-源码]）；budget 只存档案（profile-only，`no-per-model-slot`）；继承≠保证 wire 无控制字段。
4. **保存复杂度收敛**：无自动重试、无跨 namespace 回滚；档案/宿主分项状态；失败重读由用户触发。

**明确不做**：per-model budget 写宿主、全后台任务统一默认（RuntimePolicyAdapter 属 P3+，按 U5 可拒设计）、重写 LLM driver、patch driver/React 私有状态、依赖任何现有第三方插件。

## 2. 分层架构

```text
┌───────────────────── Client（dsh.client web 注入）─────────────────────┐
│ WorkbenchApp（settings.section 注册）  DraftStore（generation/touched/ │
│ 屏A 配置工作台 │ 屏B 档案规则 │ 屏C 诊断）      locked/pristine+rebase）│
│ provider-card 旁挂入口按钮 │ footer 完整入口（仅导航携上下文）          │
│ NativeFormBridge（默认关）│ Locale(modelpilot zh/en)                   │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ modelAssistant Remote（SRC-mode P0 → strict manifest P1）
┌──────────────────────────▼──── Host（cordis 插件 Host 半）─────────────┐
│ ModelAssistantService extends TypertRemoteService (ns=modelAssistant)  │
│   listTargets resolve prepareApply commitApply                        │
│   listProfiles saveProfile previewWire verifySelected(P3)             │
│ ResolveService：SourceRegistry(models.dev/dsh-listing/local/preset)   │
│   → IdentityResolver(五级链) → CandidateEngine(8级合成) → 规则引擎     │
│ ReasoningCompiler：ReasoningPolicy × WireProfile → reasoningEfforts   │
│ HostProjectionAdapter：pi-ai / deepseek(U4) / hand-declared 兜底      │
│ ApplyService：prepare/commit + planId 幂等 + lastApplied 指纹撤销      │
│ SettingsWriter：describe→op 组装→revision 围栏→重试一次→per-ns FIFO   │
│ ProfileRepository(自有 ns=modelpilot) / CacheStore(dshCachePath)      │
│ VerifyTransport：configure 轨(0.2.1 三参) / precheck 轨(0.2.0 两参)    │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
        models.dev api.json（匿名）        DSH settings（pi-ai/deepseek ns）
```

## 3. 模块职责表

| 模块 | 输入/输出 | 不承担 |
| --- | --- | --- |
| SourceRegistry | provider/model → 统一 SourceResult 信封（schemaVersion=1, status ok/stale/failed/empty） | 失败不抛出（I4）；预设不冒充 declared（I5） |
| ModelsDevSource | api.json → NormalizedEntry[]（B3 §2 映射表） | 坏 catalog 不覆盖 last-known-good；阈值 10MB/5000 条 |
| DshListingSource | discoverModels → 目录行 | 自定义路由无模态 → Evidence 降级标注 |
| IdentityResolver | ModelKey → 五级链命中（档案→exact→目录+canonical→规则→fuzzy） | 不猜 auto/free 底模；不剥离日期/区域后缀 |
| CandidateEngine | 事实+档案+规则 → 字段级 Candidate[]（8 级合成序） | touched/locked 短路；冲突并列不合并 |
| ReasoningCompiler | ReasoningPolicy × driver 方言 → reasoningEfforts dict / 路由级值 | 档位系不同必拒（deepseek `efforts-dict-not-in-dialect`）；不静默映射 |
| HostProjectionAdapter | Profile + hostState → ProjectionResult（纯函数） | 不发请求；拒写走 `ops:[]` 不走异常；reasoning 拒绝丢全部 ops |
| ApplyService | ProjectionResult + revisions → CommitResult 分项 | 两 ns 非原子；不伪装全部成功 |
| SettingsWriter | ops + expectedRevision → 写结果 + ledger | 不缓存数组下标（按 modelId 定位）；不重放旧 ops |
| ProfileRepository | ModelProfileV2 → 自有 ns（modelpilot） | 不存密钥/headers |
| CacheStore | 目录快照 → dshCachePath("modelpilot",…) | 不用 agentsHome 系（0.2.1 增量不依赖） |
| VerifyTransport | 配置 → driver-confirmed 预览/验证证据 | 只服务插件自身请求；不改写他调用 |
| WorkbenchUI | 草稿/候选/计划 → 三屏 | 预览未 driver-confirmed 一律 logical-only 徽章，禁"将发送"文案 |

## 4. 核心数据结构（TypeScript 定稿）

B2 §2 全量类型为准（tsc --noEmit --strict 通过），此处列承重定义；完整版在 B2 文档，实施时将其提取为 `src/core/domain.ts`。

```ts
export type DriverId = "pi-ai" | "deepseek";

export interface ModelKey {
  connectionId: string;   // settings namespace（llm-pi-ai / llm-deepseek）
  driverId: DriverId;
  routeId: string;        // providers.<id>（pi-ai）或 deepseek 路由
  protocol: string;       // openai-completions | openai-responses | anthropic-messages | deepseek-messages…
  rawModelId: string;     // 原样保留，不剥离任何后缀
}

export type EvidenceStatus = "declared" | "parameter-accepted" | "unknown" | "conflict";
export type Origin = "route-metadata" | "models-dev" | "explicit-alias" | "user-profile"
  | "protocol-template" | "fallback-preset" | "canonical-alias";

export interface Evidence<T> {
  status: EvidenceStatus;
  value?: T;
  origin?: Origin;
  sourceUrl?: string;
  observedAt?: string;
  sourceVersion?: string;
  scope?: "model" | "deployment" | "route";
  missing?: string;          // Evidence 降级原因（如自定义 discovery 无模态）
}

/** 三态（a.md §3.B 修正版，B2 定稿）。cleared-lossy 见 B2 §4。 */
export type StoredField<T> =
  | { state: "value"; value: T; origin: Origin; locked: boolean }
  | { state: "inherit" }                      // 投影 = 删 override 键（若有），否则 no-op
  | { state: "cleared" };                     // 有 wire 空值表达→写空值表达；否则删键+cleared-lossy 警告

export type ReasoningPolicy =
  | { mode: "inherit" }
  | { mode: "disabled"; wireProfileId: string }                 // pi-ai: reasoningEfforts=false 语义
  | { mode: "effort"; defaultLevel?: string; wireProfileId: string }
  | { mode: "budget"; tokens: number; wireProfileId: string };  // 恒 profile-only（P0–P2）

export interface ProjectionResult {
  settingsOps: SettingsOp[];
  appliedFields: string[];
  profileOnlyFields: string[];      // 原因码见 B2 ProfileOnlyReason
  unsupportedControls: UnsupportedControl[];
  requestPreview?: RequestPreview;
  previewFidelity: "driver-confirmed" | "logical-only";
  warnings: ProjectionWarning[];    // 含 catalog-replacement（P1-1 闸门）
}
```

`SettingsOp`（B1 §3.2 三类模板）：`appendModelRow(ns, routeId, modelRow)` / `setModelField(ns, routeId, modelId, field, value)` / `unsetModelField | unsetModelRow`，路径正典 `["providers", providerId, "models", String(i), field]` [已核对-源码 walker 10/10]。

## 5. Remote 接口表（namespace=modelAssistant）

| 接口 | 输入 | 输出 | P 级 |
| --- | --- | --- | --- |
| echo | {message, delayMs?} | {message, caps: VersionCapabilities} | P0-02 |
| listTargets | — | RouteTarget[]（路由/driver/协议/允许字段/caps） | P1 |
| resolve | ModelKey + draftGeneration | ResolveAnswer（facts/候选/匹配轨迹/catalog 版本） | P1 |
| prepareApply | Profile+selectedFields+revisions | ApplyPlan（planId/patch diff/unsupported/分项/警告） | P1 |
| commitApply | planId+确认（含 catalog ack） | CommitResult（档案/宿主/ledger 分项 + 新 revision） | P1 |
| listProfiles / saveProfile | 过滤 / ModelProfileV2 | 档案与 revision | P1 |
| previewWire | Profile+请求上下文摘要 | logical/driver-confirmed 预览与约束 | P2 |
| verifySelected | route+已选配置+显式预算 | accepted/unsupported/unknown 证据 | P3 |

承载：`class ModelAssistantService extends TypertRemoteService`（`super(ctx, "modelAssistant")`）+ `@Remote("echo")` 装饰器，gateway SRC fallback 直达（N1）；`signal` 尾参可选（SRC 约束：必须是最后参数）[已核对-源码]。错误判别按 `RemoteError.code`：`gateway/*` 透传、`SETTINGS_CONFLICT`、业务码 `modelAssistant/*`（如 `driver/efforts-not-in-dialect`）。**不做** strict manifest 依赖（P1 增强，形状见 N2；client-face 是否需 `./remote` manifest 为 OQ-B1-1，P0-02 echo 实测双路径后定）。

## 6. DSH 集成点清单（每点标注版本适用性）

| # | 集成点 | 版本适用 | 证据 |
| --- | --- | --- | --- |
| J1 | settings `mutate(ns, ops, expectedRevision)` + `SETTINGS_CONFLICT` | 两版逐字同 | [已核对-基线 02-S1][探针 10/10] |
| J2 | 数组写正典 `providers.<id>.models.<String(i)>.<field>`；pi-ai providers volatile 级联 | 两版同 | [已核对-基线] |
| J3 | slots：provider-card {provider,configured,keyConfigured} / footer {} / settings.section 注册 | 两版同（slots 包与 slots.d.ts MD5 相同，U2/N3） | [已核对-源码] |
| J4 | prepareCall 双轨（`prepareCall.length>=3` 探测；0.2.0=resolveCallConfig 预检） | 分叉唯一功能级 | [已核对-源码 + 探针输出] |
| J5 | discovery（catalog 直返 / GET {baseURL}/models） | 两版逐字同 | [已核对-基线 02-S3] |
| J6 | selectModel 双副作用（并选显式披露；普通保存零调用） | 两版逐字同 | [已核对-基线 02-S5] |
| J7 | dshCachePath（纯 segment 用法） | 0.2.1 超集兼容 | [已核对-基线 02-S7] |
| J8 | Remote 注册（TypertRemoteService+@Remote；SRC fallback；manifest P1） | 0.2.0 实测 + 0.2.1 注册面同构（U3） | [已核对-源码] |
| J9 | 插件 manifest（Config+volatile；ns=entry id `modelpilot`；`settings.configure({auto:false})` try/catch 包裹） | 两版同构（OQ-B1-5 双版签名留 P0 探测） | [已核对-源码 N6] |
| J10 | peerDependencies `">=0.2.0-rc.2 <0.2.2-0"`（N7 实测选定；`^…||^…` 会放进 0.2.2-rc.1，弃用） | 安装期兼容 | [已执行-探针 N7] |
| J11 | plugin add 本地路径/tgz 安装链（desktop profile 保留检查） | 0.2.0 实测 | [已核对-源码 N8] |
| J12 | agent/request waterfall（**P0–P2 不用**；P3+ 按可拒设计：自检探测+降级+ledger via） | 两版同；强制力未验 | [推断][待验证-P3] |

## 7. 关键设计裁决（合并期定案）

1. **catalog-replacement 闸门**（B2×B5 合成）：引擎侧 `ProjectionWarning{code:"catalog-replacement", removedCatalogIds[]}`，未确认时 `ops=[]`；UI 确认记 `{planId, ackAt}` 绑定（表单一动即作废）；B5 强制继续=二次勾选+可撤销兜底。
2. **五级链命名统一表**（R-N3）：引擎名（B3）↔ UI 名（B4）：local-profile→档案 / route-exact→exact / catalog(+canonical_model_id)→目录 / user-rule→规则 / fuzzy→模糊。
3. **写链"重试一次"语义**（A2）：= 重读 describe + 按 modelId 重定位 + 重 diff 后重提；语义变化（值漂移/行消失）转人工三列对比（我的意图/现值/差异）。
4. **deepseek 白名单 P1 才开**（OQ-B1-6/U4 残余）：投影规则已定稿（五字段+路由级 reasoningEffort 四值+必拒 efforts-dict），运行时验证后启用。
5. **撤销不依赖 revision**：lastApplied 指纹（sha256(path+规范化值)）+ matchKey（模型 id）重定位；当前值指纹不匹配=外部改过=不覆盖。
6. **ledger 三处同构**：以 B5 §8 schema 为准（ts/planId/ns/op/path/before/after/via/result/meta），B1 双落点（ns 环形 200 条 + ledger.jsonl 5MB 轮转）、失败也记、via 首版 "ui"。
7. **peer range**（N7）：`">=0.2.0-rc.2 <0.2.2-0"`。
8. **预览纪律**（B4 硬约束）：数据唯一来源 previewWire；driver-confirmed 随 generation 失效降级；`requestSucceeded ≠ controlAcknowledged` 两列分立。

## 8. 里程碑

### P0 — SDK PoC（出口 = 五任务全绿）

| 任务 | 产出 | 出口判据 |
| --- | --- | --- |
| P0-01 脚手架 | 仓库+package.json（J10 range）+cordis.patch.yml+Config 导出+空工作台 slot | 结构校验脚本通过；`settings.section` 注册形态编译通过 |
| P0-02 echo | ModelAssistantService+@Remote echo；bindTypertRemote 形状单测 | 单测过（manifest 形状/绑定对象/endpoint 构造）；[待验证] 实机往返与 OQ-B1-1/OQ-B1-2 |
| P0-03 settings mutate 集成测试 | 对 fixture schema 跑 walker 全用例 + revision 冲突 + 三类 op 模板 | 全用例过（对齐审计探针 10/10 + 冲突/重试） |
| P0-04 双轨探测单测 | version-capabilities.ts + 两轨 VerifyTransport 用例（fixture 双版本签名） | 探测矩阵过（2 参→precheck；3 参→configure） |
| P0-05 parser fixture | models.dev v1 parser + F1–F20 fixture（B3 §9 清单） | F1–F20 全过 + errors[] 计数准确 |

### P1 — 核心闭环：ResolveService 全链 + ApplyService + 档案 + 工作台屏A 骨架。出口：tflow/tierflow 无目录也产草稿；字段级写路径双机探针绿；冲突可恢复。
### P2 — 正式 MVP：previewWire、discovery 接入、屏B/C、deepseek 白名单启用（OQ-B1-6 验证后）、strict manifest（可选）。出口：添加→记忆→再应用闭环；ledger 完整。
### P3 — 推理增强：verifySelected（双轨实测证据）、RuntimePolicyAdapter（agent/request 可拒设计+自检）、budget 档案升级评估。出口：accepted/unsupported/unknown 证据真实；未支持诚实标记。
### P4 — 可选增强：NativeFormBridge（正式 hook 优先）、批量、导入导出、v2 source。

## 9. Open Questions（未决 + 保守默认 + 重估触发）

| # | 问题 | 保守默认 | 重估触发 |
| --- | --- | --- | --- |
| Q1 | client-face 是否需 `./remote` manifest（B1-OQ1） | 假设需要；echo 双路径实测 | P0-02 实机 |
| Q2 | SRC-mode 尾参 signal 自动注入（B1-OQ2） | 方法容忍 signal 缺席；取消尽力而为 | P0-02 实机 |
| Q3 | `configure({auto:false})` 双版签名（B1-OQ5） | try/catch 降级 | P0 实机 |
| Q4 | deepseek 路由级运行时行为（B1-OQ6/U4） | pi-ai 白名单先行 | P1 双机验证 |
| Q5 | mutate op 编码细节（B2-Q1）/ deepseek thinking 与 effort:off 优先级（B2-Q3）/ 路由级 reasoning 叠加（B2-Q8） | 预检宁严勿松；路由级写默认关闭 | P1 投影器实现前宿主核证 |
| Q6 | models.dev ETag/304 头（B3-Q2） | digest 去重兜底 | 首次真实缓存周期 |
| Q7 | 跨 section 深链导航（B4-OQ1） | 打开默认屏+横幅带上下文 | P1 宿主路由能力核证 |
| Q8 | agent/request 强制力（U5） | P3 前不依赖；自检+降级 | P3 |
| Q9 | ledger 容量/双窗口自动化（B5-OQ） | 500 条+JSONL；首轮人工 | P2 实测 |

**执行原则**：探测失败=能力不可用+显式降级，绝不静默；版本判断集中 `version-capabilities.ts`；零宿主写入、零真实模型请求、零真实凭据贯穿全项目。
