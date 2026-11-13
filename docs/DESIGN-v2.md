# ModelPilot — v2 开发方案（定稿）

日期：2026-11-10。状态：**定稿，可开工**。本文合并 B1–B5 五路设计（`docs/design-parts/`），裁决对齐点（`ALIGNMENT-LEDGER.md`），全部宿主断言来自 dsh-compat-audit（0.2.0-rc.2 / 0.2.1-rc.2 双版实测）与 gap-fill（`docs/01-gap-fill.md`）、`p0-evidence-notes.md`（N1–N8）。
证据标签：[已核对-源码] / [已执行-探针] / [已核对-基线]（引用审计报告）/ [推断-设计定案] / [待验证-*]。

---

## 1. 产品定义与首版边界

**ModelPilot = DSH 的模型配置助手插件**：用户输入模型 ID，插件结合可信目录（models.dev + 宿主 `discovery`）、本地档案与预设，生成可解释的模型配置；用户选定后回填草稿，再经字段级最小补丁应用到 DSH。

三类结果分离（承袭 b.md，审计维持）：**能力事实**（来源宣称什么）／**用户档案**（用户要什么）／**执行投影**（驱动实际接受什么、发出什么）。

首版边界（a.md 的四个必修项全部吸收）：

1. **原生回填提前到 P0**：插槽没有草稿注入面（两版插槽载荷逐字稳定 [已核对-基线]），首版双入口 = `provider-card`／`footer` 插槽入口 + 自注册 `settings.section` 工作台（`id` 为 `modelpilot.workbench`）；`NativeFormBridge` 为可选增强且默认关闭（B4-OQ3 保守默认），失败时显式降级、不静默。
2. **三态数据结构**：`StoredField<T> = value | inherit | cleared`（B2 §2，`tsc` `strict` 通过）；清空不复用 0／`false`／[]；`cleared-lossy` 仅在字段没有线上空值表达时退化为删键并告警。
3. **推理承诺收敛**：档位映射可以真实投影（客户端 R1–R7 预检复刻 [已核对-源码]）；预算只存档案（仅档案，`no-per-model-slot`）；"继承"不等于保证线上没有控制字段。
4. **保存复杂度收敛**：无自动重试、无跨命名空间回滚；档案／宿主分项状态；失败后重读由用户触发。

**明确不做**：逐模型预算写宿主、把全后台任务统一成默认（`RuntimePolicyAdapter` 属 P3+，按 U5 的可拒设计）、重写 LLM 驱动、修改驱动／`React` 私有状态、依赖任何现有第三方插件。

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
| 来源注册表（SourceRegistry） | 提供方／模型 → 统一来源结果信封（`schemaVersion=1`，状态 ok/stale/failed/empty） | 失败不抛出（I4）；预设不冒充目录声明（I5） |
| models.dev 来源（ModelsDevSource） | `api.json` → `NormalizedEntry[]`（B3 §2 映射表） | 坏目录不覆盖最后可用快照；阈值 10MB／5000 条 |
| 宿主目录来源（DshListingSource） | `discoverModels` → 目录行 | 自定义路由无模态 → 证据降级标注 |
| 身份解析器（IdentityResolver） | `ModelKey` → 五级链命中（档案→精确→目录+规范化→规则→模糊） | 不猜 auto/free 底模；不剥离日期／区域后缀 |
| 候选引擎（CandidateEngine） | 事实 + 档案 + 规则 → 字段级候选数组（8 级合成序） | `touched`／`locked` 短路；冲突并列不合并 |
| 推理编译器（ReasoningCompiler） | 推理策略 × 驱动方言 → `reasoningEfforts` 字典／路由级值 | 档位系不同必拒（`deepseek` 的 `efforts-dict-not-in-dialect`）；不静默映射 |
| 宿主投影适配器（HostProjectionAdapter） | 档案 + 宿主状态 → `ProjectionResult`（纯函数） | 不发请求；拒写走 `ops:[]` 不走异常；推理被拒绝则丢弃全部操作 |
| 应用服务（ApplyService） | `ProjectionResult` + 修订号 → 分项提交结果 | 两命名空间非原子；不伪装全部成功 |
| 设置写入器（SettingsWriter） | 操作 + 期望修订号 → 写入结果 + 台账 | 不缓存数组下标（按模型 id 定位）；不重放旧操作 |
| 档案仓库（ProfileRepository） | `ModelProfileV2` → 自有命名空间（`modelpilot`） | 不存密钥／`headers` |
| 缓存存储（CacheStore） | 目录快照 → `dshCachePath("modelpilot",…)` | 不用 `agentsHome` 系（不依赖 0.2.1 增量） |
| 验证传输（VerifyTransport） | 配置 → 驱动确认的预览／验证证据 | 只服务插件自身请求；不改写他人调用 |
| 工作台界面（WorkbenchUI） | 草稿／候选／计划 → 三个屏 | 预览未经驱动确认一律 `logical-only` 徽章，禁用"将发送"文案 |

## 4. 核心数据结构（TypeScript 定稿）

以 B2 §2 的全量类型为准（`tsc --noEmit --strict` 通过），此处列承重定义；完整版在 B2 文档，实施时提取为 `src/core/domain.ts`。

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

`SettingsOp`（B1 §3.2 的三类模板）：`appendModelRow(ns, routeId, modelRow)` / `setModelField(ns, routeId, modelId, field, value)` / `unsetModelField | unsetModelRow`，路径正典 `["providers", providerId, "models", String(i), field]` [已核对-源码 `walker` 10/10]。

## 5. `Remote` 接口表（`namespace`=modelAssistant）

| 接口 | 输入 | 输出 | 阶段 |
| --- | --- | --- | --- |
| `echo` | `{message, delayMs?}` | `{message, caps: VersionCapabilities}` | P0-02 |
| `listTargets` | — | `RouteTarget[]`（路由／驱动／协议／允许字段／能力集） | P1 |
| `resolve` | `ModelKey` + 草稿代次 | `ResolveAnswer`（事实／候选／匹配轨迹／目录版本） | P1 |
| `prepareApply` | 档案 + 已选字段 + 修订号 | `ApplyPlan`（`planId`／补丁差异／未支持项／分项／告警） | P1 |
| `commitApply` | `planId` + 确认（含目录确认） | `CommitResult`（档案／宿主／台账分项 + 新修订号） | P1 |
| `listProfiles` / `saveProfile` | 过滤条件／`ModelProfileV2` | 档案与修订号 | P1 |
| `previewWire` | 档案 + 请求上下文摘要 | 逻辑级／驱动确认级预览与约束 | P2 |
| `verifySelected` | 路由 + 已选配置 + 显式预算 | 接受／未支持／未知三类证据 | P3 |

承载方式：`class ModelAssistantService extends TypertRemoteService`（`super(ctx, "modelAssistant")`）+ `@Remote("echo")` 装饰器，由 `gateway` 的源码回退直达（N1）；`signal` 尾参可选（源码模式约束：必须是最后一个参数）[已核对-源码]。错误按 `RemoteError.code` 判别：`gateway/*` 原样透传、`SETTINGS_CONFLICT`、业务码 `modelAssistant/*`（如 `driver/efforts-not-in-dialect`）。**不做**对严格清单的依赖（P1 增强，形状见 N2；`client` 面是否需要 `./remote` 清单为 OQ-B1-1，待 P0-02 的 `echo` 实测双路径后确定）。

## 6. DSH 集成点清单（每点标注版本适用性）

| # | 集成点 | 版本适用 | 证据 |
| --- | --- | --- | --- |
| J1 | `settings` 的 `mutate(ns, ops, expectedRevision)` + `SETTINGS_CONFLICT` | 两版逐字相同 | [已核对-基线 02-S1][探针 10/10] |
| J2 | 数组写正典 `providers.<id>.models.<String(i)>.<field>`；`pi-ai` 的 `providers` 易变级联 | 两版相同 | [已核对-基线] |
| J3 | 插槽：`provider-card` `{provider,configured,keyConfigured}` / `footer` `{}` / `settings.section` 注册 | 两版相同（插槽包与 `slots.d.ts` 的 MD5 相同，U2／N3） | [已核对-源码] |
| J4 | `prepareCall` 双轨（`prepareCall.length>=3` 探测；0.2.0 走 `resolveCallConfig` 预检） | 唯一功能级分叉 | [已核对-源码 + 探针输出] |
| J5 | `discovery`（目录直接返回／`GET {baseURL}/models`） | 两版逐字相同 | [已核对-基线 02-S3] |
| J6 | `selectModel` 的双副作用（并选需显式披露；普通保存零调用） | 两版逐字相同 | [已核对-基线 02-S5] |
| J7 | `dshCachePath`（纯分段用法） | 0.2.1 为超集，兼容 | [已核对-基线 02-S7] |
| J8 | `Remote` 注册（`TypertRemoteService` + `@Remote`；源码回退；清单 P1） | 0.2.0 实测 + 0.2.1 注册面同构（U3） | [已核对-源码] |
| J9 | 插件清单（`Config` + 易变；命名空间 = 条目 id `modelpilot`；`settings.configure({auto:false})` 用 try/catch 包裹） | 两版同构（OQ-B1-5 的双版签名留 P0 探测） | [已核对-源码 N6] |
| J10 | 对等依赖 `">=0.2.0-rc.2 <0.2.2-0"`（N7 实测选定；`^…||^…` 会放进 0.2.2-rc.1，已弃用） | 安装期兼容 | [已执行-探针 N7] |
| J11 | 插件安装链（本地路径／`tgz`，桌面档案有保留检查） | 0.2.0 实测 | [已核对-源码 N8] |
| J12 | `agent/request` 瀑布流（**P0–P2 不用**；P3+ 按可拒设计：自检探测 + 降级 + 台账 `via`） | 两版相同；强制力未验 | [推断][待验证-P3] |

## 7. 关键设计裁决（合并期定案）

1. **目录替换闸门**（B2×B5 合成）：引擎侧产出 `ProjectionWarning{code:"catalog-replacement", removedCatalogIds[]}`，未确认时 `ops=[]`；界面确认记为 `{planId, ackAt}` 绑定（表单一动即作废）；B5 的"强制继续"= 二次勾选 + 可撤销兜底。
2. **五级链命名统一表**（R-N3）：引擎名（B3）↔ 界面名（B4）：本地档案→档案 / 路由精确→精确 / 目录（+规范化 id）→目录 / 用户规则→规则 / 模糊→模糊。
3. **写链"重试一次"语义**（A2）：= 重读 `describe` + 按模型 id 重定位 + 重算差异后重新提交；语义发生变化（值漂移／行消失）转人工三列对比（我的意图／现值／差异）。
4. **`deepseek` 白名单到 P1 才开**（OQ-B1-6／U4 残余）：投影规则已定稿（五字段 + 路由级 `reasoningEffort` 四值 + 必拒 `efforts-dict`），运行时验证后再启用。
5. **撤销不依赖修订号**：按 `lastApplied` 指纹（`sha256(路径+规范化值)`）+ `matchKey`（模型 id）重定位；当前值指纹不匹配即视为外部改过、不覆盖。
6. **台账三处同构**：以 B5 §8 的 `schema` 为准（`ts/planId/ns/op/path/before/after/via/result/meta`），B1 的两个落点（命名空间环形 200 条 + `ledger.jsonl` 5MB 轮转）、失败也记录、`via` 首版为 `"ui"`。
7. **对等依赖范围**（N7）：`">=0.2.0-rc.2 <0.2.2-0"`。
8. **预览纪律**（B4 硬约束）：数据唯一来源是 `previewWire`；驱动确认级随代次失效而降级；`requestSucceeded ≠ controlAcknowledged` 两列分立。

## 8. 里程碑

### P0 — SDK 概念验证（出口 = 五个任务全绿）

| 任务 | 产出 | 出口判据 |
| --- | --- | --- |
| P0-01 脚手架 | 仓库 + `package.json`（J10 范围）+ `cordis.patch.yml` + `Config` 导出 + 空工作台插槽 | 结构校验脚本通过；`settings.section` 注册形态编译通过 |
| P0-02 `echo` | `ModelAssistantService` + `@Remote` 的 `echo`；`bindTypertRemote` 形状单测 | 单测通过（清单形状／绑定对象／`endpoint` 构造）；[待验证] 实机往返与 OQ-B1-1／OQ-B1-2 |
| P0-03 `settings` `mutate` 集成测试 | 对 `fixture` `schema` 跑遍历全用例 + 修订号冲突 + 三类操作模板 | 全用例通过（对齐审计探针 10/10 + 冲突／重试） |
| P0-04 双轨探测单测 | `version-capabilities.ts` + 两轨 `VerifyTransport` 用例（`fixture` 双版本签名） | 探测矩阵通过（2 参→预检轨；3 参→配置轨） |
| P0-05 解析器 `fixture` | `models.dev` v1 解析器 + F1–F20 `fixture`（B3 §9 清单） | F1–F20 全过 + `errors[]` 计数准确 |

### P1 — 核心闭环：解析服务全链 + 应用服务 + 档案 + 工作台屏 A 骨架。出口：`tflow`／`tierflow` 即使无目录也能产出草稿；字段级写路径双机探针全绿；冲突可恢复。
### P2 — 正式 MVP：`previewWire`、`discovery` 接入、屏 B／C、`deepseek` 白名单启用（OQ-B1-6 验证后）、严格清单（可选）。出口：添加→记忆→再应用的闭环；台账完整。
### P3 — 推理增强：`verifySelected`（双轨实测证据）、`RuntimePolicyAdapter`（`agent/request` 可拒设计 + 自检）、预算档案升级评估。出口：接受／未支持／未知三类证据真实；未支持项诚实标记。
### P4 — 可选增强：`NativeFormBridge`（优先走正式钩子）、批量、导入导出、v2 来源。

## 9. 开放问题（未决 + 保守默认 + 重估触发）

| # | 问题 | 保守默认 | 重估触发 |
| --- | --- | --- | --- |
| Q1 | `client` 面是否需要 `./remote` 清单（B1-OQ1） | 假设需要；`echo` 双路径实测 | P0-02 实机 |
| Q2 | 源码模式下尾参 `signal` 的自动注入（B1-OQ2） | 方法容忍 `signal` 缺席；取消尽力而为 | P0-02 实机 |
| Q3 | `configure({auto:false})` 的双版签名（B1-OQ5） | try/catch 降级 | P0 实机 |
| Q4 | `deepseek` 路由级运行时行为（B1-OQ6／U4） | `pi-ai` 白名单先行 | P1 双机验证 |
| Q5 | `mutate` 操作编码细节（B2-Q1）／`deepseek` 的 `thinking` 与 `effort:off` 优先级（B2-Q3）／路由级推理叠加（B2-Q8） | 预检宁严勿松；路由级写默认关闭 | P1 投影器实现前核证宿主 |
| Q6 | models.dev 的 ETag／304 头（B3-Q2） | 摘要去重兜底 | 首次真实缓存周期 |
| Q7 | 跨 `section` 深链导航（B4-OQ1） | 打开默认屏 + 横幅带上下文 | P1 核证宿主路由能力 |
| Q8 | `agent/request` 的强制力（U5） | P3 之前不依赖；自检 + 降级 | P3 |
| Q9 | 台账容量／双窗口自动化（B5-OQ） | 500 条 + JSONL；首轮人工 | P2 实测 |

**执行原则**：探测失败即"能力不可用 + 显式降级"，绝不静默；版本判断集中在 `version-capabilities.ts`；零宿主写入、零真实模型请求、零真实凭据贯穿全项目。