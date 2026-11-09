# B1 — SDK 接入层设计（ModelPilot）

日期：2026-11-10。文档性质：**设计章节**（纯设计，不含实现代码；文中 TS 片段均为类型/形状草案）。
宿主兼容范围：**DSH 0.2.0-rc.2 与 0.2.1-rc.2**（锚点 = `@deepseek-ai/dsh` package.json version）。

证据标签沿用 dsh-compat-audit 规则：`[已核对-源码]` / `[已执行-探针]` / `[推断]` / `[待验证]`。
事实基线来源：`dsh-compat-audit/02-surface-diff.md`（下称 02-S1…S7）、`modelpilot/docs/01-gap-fill.md`（下称 U1…U6）。本设计撰写时对 `modelpilot-tmp-npm/extracted/<pkg>/<ver>/package/` 的关键文件做了二次复核，补充行号见文末附录 A；凡与审计结论一致处只引审计编号。

---

## 1. host/client 双半结构与包形状

### 1.1 目录布局

```text
@YOUR_SCOPE/dsh-model-assistant/
├── package.json              # 形状见 §1.2
├── cordis.patch.yml          # bundle patch，形状见 §1.3
├── lib/
│   ├── index.js              # Host 半入口（composition 条目加载）
│   ├── client.js             # Client 半入口（web client 注入）
│   └── types/                # d.ts
├── src/
│   ├── host/                 # Host 半：只在 Node 宿主进程运行
│   │   ├── plugin.ts         # name/inject/apply/Config 出口（§1.4）
│   │   ├── service/          # ModelAssistantService（§2）
│   │   ├── settings-writer.ts# SettingsWriter（§3）
│   │   ├── verify/           # VerifyTransport 双轨（§4）
│   │   ├── version-capabilities.ts  # 唯一允许版本号比较的文件（v2-plan §13/R6）
│   │   └── cache.ts          # 缓存读写协议（§5）
│   ├── client/               # Client 半：slot 注册、草稿桥宿主（B4 章节）、远端调用封装
│   ├── core/                 # 纯 TS、零宿主依赖：候选/规则/投影/ReasoningCompiler（单测走 fixture）
│   └── shared/               # 双半共用：wire 类型、错误码表、ModelKey/Profile/PathOp 形状
└── test/
    └── probes/               # 审计四探针随 CI（walker / prepareCall 签名 / slots 载荷 / discovery 形状）[已核对-源码 99-§四.3]
```

双半边界规则：

- Host 半独占一切写副作用（settings mutate、缓存落盘、verify 请求）；Client 半只经 typed Remote（§2）与宿主既有的 `remote.settings / remote.llm` 透传读面交互。Client 消费端先例：settings-models 页面通过 `createModelsOperations(ctx)` 把 `ctx.remote.settings.mutate / ctx.remote.llm.discoverModels / ctx.remote.credentials.*` 绑成回调，错误按 `{code, message}` 分支消费 [已核对-源码 02-S4]。
- core/shared 不得 import 任何 `@deepseek-ai/*` 运行时符号（类型除外）。
- 版本探测与版本号字符串只出现在 `src/host/version-capabilities.ts`（v2-plan §13 修订 1）。

### 1.2 package.json 完整形状

```jsonc
{
  "name": "@YOUR_SCOPE/dsh-model-assistant",
  "version": "0.1.0",
  "description": "ModelPilot — DSH model configuration assistant (host/client dual-half plugin)",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".":            { "types": "./lib/types/index.d.ts",       "default": "./lib/index.js" },
    "./client":     { "types": "./lib/types/client/index.d.ts","default": "./lib/client.js" },
    "./typert":     { "types": "./lib/typert.host.d.ts",       "default": "./lib/typert.host.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-api-remotes"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.4",
    "@deepseek-ai/dsh-typert-protocol": "^0.2.0-rc.2 || ^0.2.1-rc.2",
    "@deepseek-ai/dsh-settings": "^0.2.0-rc.2 || ^0.2.1-rc.2",
    "@deepseek-ai/dsh-llm": "^0.2.0-rc.2 || ^0.2.1-rc.2",
    "@deepseek-ai/dsh-home-paths": "^0.2.0-rc.2 || ^0.2.1-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "^0.2.0-rc.2 || ^0.2.1-rc.2",
    "@deepseek-ai/dsh-api-remotes": "^0.2.0-rc.2 || ^0.2.1-rc.2",
    "react": "^18.2.0"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "~3.18.4"
  },
  "engines": { "node": ">=18" }
}
```

形状依据与决策：

- `dsh.bundle.patch` + `dsh.client.inject` 字段形态照抄官方包与本机双例：settings-models 的 `dsh.client.inject` 列三个前置包、api-gateway 带 `immediately: true`；dsh-purge-community 用 `dsh.bundle.patch` + 六项 client inject [已核对-源码 02-S4 / 本机包 package.json]。`inject` 具体清单是 B4 的输入，此处为 **[推断]**（前置最小集：slots 协议、settings 页、locale、api-remotes 的 remote 代理、connection）。
- `exports` 四条为任务书定版：`.`（Host 入口）/ `./client`（Client 入口）/ `./typert`（host-face typert 工件，见 §2.6）/ `./package.json`。可选第五条 `./remote`（client-face `TYPERT_REMOTE` manifest，dsh-llm 先例：`exports["./remote"] → lib/typert.remote-client.js`）列为 **[待验证-P1]**（见 Open Questions OQ-1）。
- `./typert` export 一旦存在，dsh-typert-loader 会自动扫描并以 `ctx.typert.register(manifest)` 注册 [已核对-源码 02-S7 + U3；loader 源码 `TYPERT_HOST_EXPORT = "./typert"`，`apply` 逐 Loader 条目解析→import→`validateTypertManifest`→注册，重复注册整批拒绝]。**P0 阶段可以不带该 export**（echo 走 SRC-mode，见 §2.1），strict manifest 路线 P1 再启用，两者共存不冲突（gateway 先查 strict descriptor，miss 才落 SRC fallback）[已核对-源码 api-gateway `resolveDescriptor`：先 `ctx.typert.local.get(endpoint)`，再 `resolveSrcDescriptor`]。
- `peerDependencies` 版本域统一 `^0.2.0-rc.2 || ^0.2.1-rc.2`，React 跟宿主 18；`dependencies` 只放官方 schemastery（loader/settings-models 同款 `~3.18.4`）。不写无上限星号（v2-plan §13）。禁止依赖 0.2.1 独有导出（`dsh-typert-protocol/remote-info`、`ctx.typert.resources`、home-paths 的 agentsHome 系列）[已核对-源码 U3 / 02-S7]。

### 1.3 cordis.patch.yml 完整内容

```yaml
# ModelPilot — bundle patch
# 唯一一条 insert。id 即插件 settings namespace（settings 服务用 entry.options.id 作 ns），
# 因此 id 必须恒为 modelpilot——改名 = 整个自有 ns 迁移，禁止。
# plugin 级 inject（settings/llm）由包内 exports 声明，全局服务按名解析，无需在此重复。
- insert:
    - id: modelpilot
      name: "@YOUR_SCOPE/dsh-model-assistant"
      config: {}
```

- insert 行 `id/name` 形态对照 dsh-purge 与 purge-panel 的 bundle patch（`- id: <entryId>` / `name: <package 或 package/subpath>` / `config:`）[已核对-源码：本机 dsh-purge cordis.patch.yml、purge-panel cordis.patch.yml]。
- **composition 条目 id 决定 settings ns** [已核对-源码：settings `describe()` 输出 `ns: entry.options.id`；任务书基线]。`name` 指向包名；若未来拆子入口（如 workbench 服务），命名走 `<pkg>/<subpath>` 形态。
- `config: {}`：自有 ns 的运行开关全部放 §1.4 的 Config schema，经自有 UI 写入；bundle 层不预置业务默认值。

### 1.4 Config 导出（自有 namespace = modelpilot）

出口形状（照范例插件 dsh-plugin-model-capability：`export const name / inject / apply` + `export const Config`）[已核对-范例插件：任务书基线]：

```ts
export const name = "modelpilot";
export const inject = ["settings", "llm"];   // settings=SettingsWriter+configure；llm=verify 双轨
export function apply(ctx, config) { /* §2 注册 Service；§3 启动写队列；ctx.settings.configure({auto:false}, ctx.fiber) */ }

// —— schema 草稿（z = @deepseek-ai/schemastery 导出，写法对齐 pi-ai）——
const storedField = z.union([
  z.object({ mode: z.const("value"),   value: z.any(), origin: z.string(), locked: z.boolean() }),
  z.object({ mode: z.const("inherit"), autoFill: z.boolean(), locked: z.boolean() }),
  z.object({ mode: z.const("cleared"), locked: z.const(true) }),
]);                                             // v2-plan §4.2 三态，清空不复用 0/false/[]

const modelKey = z.object({
  connectionId: z.string(), driverId: z.string(), routeId: z.string(),
  protocol: z.string(), rawModelId: z.string(),
});

export const Config = z.object({
  // ModelKey 复合键编码："connectionId/driverId/routeId/protocol/rawModelId"（含 / 的原始 ID 走转义表，见 Open Questions OQ-4）
  profiles: z.dict(z.object({
    key: modelKey,
    contextWindow: storedField, outputBudget: storedField, input: storedField,
    reasoning: z.any(),            // ReasoningPolicy，B3 章节定形
    scope: z.string(),             // U5 预留（agent/request 通道标记），首版恒 "settings"
    updatedAt: z.string(),
  })).default({}).volatile(),

  rules: z.array(z.object({
    schemaVersion: z.const(1),
    match: z.object({ routeId: z.string(), rawModelId: z.string() }),   // 均可选匹配，glob 限长
    usePresetId: z.string(),
    priority: z.union([z.const("exact"), z.const("route"), z.const("protocol"), z.const("global")]),
  })).default([]).volatile(),

  locks: z.dict(z.object({         // key = 复合键 + ":" + 字段名
    reason: z.string(), createdAt: z.string(),
  })).default({}).volatile(),

  ledger: z.array(z.object({       // UI 可读的最近审计（全量持久副本在 §5 的 ledger.jsonl）
    id: z.string(), ts: z.string(), kind: z.string(), summary: z.string(),
  })).default([]).volatile(),
});
```

决策与依据：

- 四条数据线全部标 `.volatile()`：settings 写路径要求路径 volatile（`write()` 内 `isVolatilePath` 校验，非 volatile 直接抛 `Config field ... is not volatile`）[已核对-源码 02-S1 + settings 源码 write L507]；`Config = z.object({ providers: z.dict(profile).default({}).volatile() })` 是 pi-ai 先例，volatile 自节点向下级联 [已核对-源码 02-S3，pi-ai Config 两版逐字同构]。
- **自动表单关闭**：`apply` 内执行 `ctx.settings.configure({ auto: false }, ctx.fiber)`，本 ns 不进原生设置表单，UI 全部走自有 slot/工作台（B4）[已核对-范例插件：任务书基线 dsh-plugin-model-capability 用法]。
- schema 变更语义：`describe()` 的 revision 摘要含 `entry.fiber.uid + schema.toJSON() + config`，schema 升级自身会推高 revision 并触发 `settings/document-updated` [已核对-源码 settings describe L421-435]——即 schema 迁移天然使并发写失败，配合 §3.3 重试即可，无需额外迁移锁。

---

## 2. TypertRemoteService 注册设计（namespace = modelAssistant）

### 2.1 Host 侧 Service 形态

```ts
import { TypertRemoteService, Remote, RemoteError } from "@deepseek-ai/dsh-typert-protocol";

export class ModelAssistantService extends TypertRemoteService {
  constructor(ctx) { super(ctx, "modelAssistant"); }   // serviceKey 即默认 wire namespace；可 { namespace } 覆盖
  // 方法表见 §2.2
}
```

注册链与跨版本证据：

- `TypertRemoteService` 构造 `super(ctx, serviceKey, options)`，`this.typertRemote = bindTypertRemote(this, this.name, options)`，`namespace = options.namespace ?? serviceKey` [已核对-源码 02-S7 / U3；typert-protocol 0.2.0 L146-172 与 0.2.1 对应区块同构]。
- api-gateway 按 `<namespace>/<method>` 路由：`endpointOf(namespace, method)`，且对每个 service 原型扫描 `typertRemote` 绑定 + `remoteMethods(original)` 收集 claims（`exportName ?? method`）[已核对-源码 api-gateway 0.2.0 `collectSrcClaims` L706-718、`resolveSrcDescriptor` L1004 起；U3 判定两版校验路径不变]。
- 因此 **SRC-mode（装饰器标记 + Service 绑定，无生成 manifest）即可端到端路由**，这是 P0-02 echo 连通探针的承载方式；strict generated-manifest 路线（§2.6）为 P1 增强，两版公共面一致，无需版本特判 [已核对-源码 U3]。
- `ctx.invocation` 在 Service 子树内可读（调用期派生 ctx 遮蔽根访问器），用于逐调用审计 [已核对-源码 typert-protocol `provideInvocationAccessor`]。
- 注册时机：`apply()` 内 `ctx.provide("modelAssistant", new ModelAssistantService(ctx))`（Cordis Service 常规注册）；随 fiber 撤销自动回收。

### 2.2 方法表（P0 → V0.3）

| 方法 | 输入 wire 形状 | 输出 | 里程碑 | 备注 |
| --- | --- | --- | --- | --- |
| `echo` | `{nonce: string, ts?: number}` | `{nonce, hostVersion, caps: {supportsConfigure, nativeReasoningEditing}}` | **P0-02** | 连通 + 能力握手一体；Client 拿 caps 初始化 VersionCapabilities 缓存 |
| `listTargets` | `{}` | 可配置路由/driver/协议/允许字段 + caps | V0.1 | 数据源 = `ctx.remote` 同侧的 `llm.listConfigurableProviders()`（Host 内直接调 llm 服务） |
| `resolve` | `ModelKey + draftGeneration` | facts/字段候选/匹配轨迹/catalog 版本 | V0.1 | 查询零写入（B2/B3 承接） |
| `saveProfile` / `listProfiles` | 版本化档案 | 自有 ns 档案 + revision | V0.1 | 写自有 ns，走 §3 SettingsWriter |
| `prepareApply` | `Profile + selectedFields + revisions` | `planId`、patch diff、unsupported、分项计划 | V0.1 | plan 绑定 profile 版本（幂等键） |
| `commitApply` | `planId + 确认` | 分项结果 + 新 revision | V0.1 | 写目标 ns（`llm-pi-ai` 等），走 §3 |
| `previewWire` | `Profile + 请求上下文摘要` | logical / driver-confirmed 预览 | V0.2 | 只投影不请求 |
| `verifySelected` | `route + 已选配置 + 显式预算` | accepted/unsupported/unknown 证据 | V0.3 | 走 §4 双轨 |

- 方法表沿用 v2-plan §9 的七接口 + echo；里程碑对齐 v2-plan §14。
- 所有方法参数必须是 lossless JSON（wire 载荷过 `isRemoteJsonValue` 门）[已核对-源码 typert-protocol json-value 区]；`AbortSignal` 只能以尾参 signal 形式出现（见 §2.3 约束）。

### 2.3 @Remote 装饰器形态与约束

```ts
@Remote("echo")
async echo(payload: { nonce: string; ts?: number }, signal?: AbortSignal) { ... }
```

约束（全部有源码锚）：

- `@Remote(name)` 要求 **public instance method + 字符串名**；static/private/无名字面量直接 TypeError [已核对-源码 typert-protocol `addMarkerInitializer`：`context.private || context.static || typeof context.name !== "string"` 抛错]。装饰器走标准 decorator `context.addInitializer` 通道，把标记写进类原型（descriptor version 1），重复标记同 method 幂等、冲突标记抛错 [已核对-源码 `mark()` L248-268]。
- `@Remote({mode:"stream"})` 是流式变体（options 必须恰好一项）；B1 首版方法表**全部 unary**，stream 载荷不进首版（verify 请求在内部消费 chunk，不外露流）。
- signal 注入：strict descriptor 由 manifest `cancellation: {parameter:"signal"}` 声明；SRC-mode 下 gateway 对尾参 signal 的注入行为**未逐行核验** [待验证-OQ2]。设计对策：每个方法容忍 signal 缺席（`signal?: AbortSignal`），并把取消语义定义为"尽力而为 + 结果幂等"。
- 禁止 import 任何生成 typert 文件的内部结构（0.2.0 数组式契约 vs 0.2.1 `createTypertRemoteInfo` registry，形态不同）[已核对-源码 02-S7；U3]。只用 `Remote / RemoteError / RemoteScope / TypertRemoteService / remoteMethods` 公共面。

### 2.4 Client 侧调用

- 首选路径：`ctx.remote.modelAssistant.echo({ nonce })`——Client 半与 settings-models 消费 `ctx.remote.settings / ctx.remote.llm / ctx.remote.session` 同构（api-remotes 注入的 remote 代理按 namespace 取 stub）[已核对-源码 02-S4；settings-models client.js `createModelsOperations` L2781 起]。
- 返回值分支遵循既有 `RemoteResult` 习惯：`response.ok ? response.value : response.error`，error 为 `{code, message}`（Client face 重建 RemoteError 实例，`throw result.error` 保持 throw 语义）[已核对-源码 typert-protocol remote-error 注释；settings-models `code === "settings/conflict"` 分支]。
- **第三方 namespace 的 client-face stub 是否需要 client-side `TYPERT_REMOTE` manifest 注册**：P0-02 echo 探针实机判定 [待验证-OQ1]。降级路径（若需 manifest）：补 `./remote` 导出（dsh-llm 形态的手写 `TYPERT_REMOTE`）或经 api-remotes 的 forwarded remote-events 通道 [推断-U3/02-S7：api-remotes 0.2.1 已透传 entry.resources，但其依赖面不进 B1]。

### 2.5 错误映射（RemoteError code 约定）

`RemoteError(code, message, details)`：判别**只按 code、永远不用 instanceof**（跨 realm/bundle 结构标记 `isDSHRemoteError` + `remoteErrorOf()` 仅机制内部使用）[已核对-源码 typert-protocol remote-error 区]。

| 层 | code | 来源/映射 |
| --- | --- | --- |
| 网关 | `gateway/service-unavailable`、`gateway/method-unavailable`、`gateway/definition-unavailable`、`gateway/signature-invalid`、`gateway/cancelled`、`gateway/protocol`、`gateway/uplink-overflow` | gateway 原样透传，插件不改写 [已核对-源码 api-gateway L435-439/L730/L968/L988/L1001/L1292] |
| 目标 settings | `settings/conflict` | 宿主 `SettingsConflictError(code="SETTINGS_CONFLICT")` 经 wire 的既有映射先例 [已核对-源码 02-S1 + settings-models L2802] |
| 插件业务 | `modelAssistant/apply-conflict` | 包裹 SETTINGS_CONFLICT：`details = {ns, expected, actual, attempts}`（§3.3 两次冲突后） |
| 插件业务 | `modelAssistant/route-unavailable` | llm `LlmError("NO_ADAPTER")` 映射 |
| 插件业务 | `modelAssistant/unsupported-effort` | llm `LlmError("UNSUPPORTED_REASONING_EFFORT")` 映射，details 带 provider/model/effort |
| 插件业务 | `modelAssistant/invalid-plan` | planId 不存在 / 与 profile 版本不匹配 / desiredProfileVersion 过期 |
| 插件业务 | `modelAssistant/field-not-writable` | 白名单外字段（§3.2）或 schema 非 volatile 拒绝 |
| 插件业务 | `modelAssistant/verify-failed` | §4 transport 失败且不可归类时 |

- `details` 必须是 lossless JSON（不带 Error/Signal/函数）。
- 宿主内部异常一律包成上表业务码再抛；裸 `TypeError`（如 `Config array index ... out of range`）在 §3.1 内部分类消化，不出插件边界。

### 2.6 ./typert manifest（strict 路线，P1）

- manifest 形状按 `validateTypertManifest` 校验面手写或编译器产出：`{package: 本包名, face: "host", schemas: [{name, create()}], model, invocations: [...]}`；`manifest.package` 必须等于导出它的包名、face 必须 `"host"`，否则 loader 拒绝 [已核对-源码 loader `validateTypertManifest` L77-117]。
- loader 以 `ctx.typert.register(manifest)` 原子注册（package-face/schema key/invocation id/endpoint 任一重复 → 整批拒绝），按 fiber 撤销 [已核对-源码 registry `register()` L398-418：ctx.effect 原子 commit/withdraw；U3]。
- 手工兜底路径：`apply()` 内 `ctx.typert.register(contribution)`（先 `validateTypertManifest` 自检再交注册）——loader 与手工互斥使用，同一包不允许双注册（第二次触发 package-face 重复拒绝）[已核对-源码 U3 + registry L482]。
- invocations 条目需含 `service: "modelAssistant"`、`namespace: "modelAssistant"`、每参数 `{name, wire, source:"json", codec:{mode:"strict", create}}`、`result` 同构、`cancellation: {parameter:"signal"}`（形状照 dsh-llm `./typert` 工件逐字段）[已核对-源码 dsh-llm typert.host.js L41-108]。

---

## 3. settings mutate 封装（SettingsWriter）

事实基线（本节全部承重）：`mutate(ns, ops, expectedRevision)`；数组下标必须是字符串数字 `String(i)`（`/^(0|[1-9][0-9]*)$/`）；set 深字段 / unset 删行（splice）或删键（回落 schema default/继承）/ 下标==length 且 set 且 rest 空 → 追加整行；越界 TypeError；volatile 自 `providers` 节点级联（pi-ai Config volatile）→ 白名单路径全部合法；冲突抛 `SettingsConflictError`（code=`SETTINGS_CONFLICT`，携带 expected/actual）[已核对-源码 02-S1 + 探针 probe-walker 10/10 + settings L163-216/L488-499/L501-537]。

### 3.1 类型与读面

```ts
interface SettingsSnapshot { ns: string; revision: number; value: unknown }   // value = describe(ns).value

class SettingsWriter {
  constructor(settings /* inject 的 settings 服务 */, ledger /* §3.5 */, queue /* §3.4 */);
  async read(ns: string): Promise<SettingsSnapshot>;        // describe() → find(row => row.ns === ns)；ns 缺失 → 抛 modelAssistant/route-unavailable 语义变体
  async apply(ns: string, plan: WritePlan): Promise<ApplyOutcome>;
}
type PathOp = { op: "set"; path: string[]; value: unknown } | { op: "unset"; path: string[] };
// path 一律字符串段：["providers", providerId, "models", String(i), field] —— String(i) 是硬约束
```

- `read` 复用宿主 `describe()`（同一次进程内 revision 单调）；**不做 redact**（Host 侧调用，凭据引用 `apiKeyEnv` 本就在白名单外，永不读写）[已核对-源码 02-S4 原生 pathOps 同口径]。

### 3.2 op 组装模板（三类）

写路径正典：`providers.<id>.models.<String(i)>.<field>`。白名单字段 = pi-ai `modelFields` 两版同集：`name / contextWindow / maxTokens / input / reasoningEfforts / compat`（+ `id` 仅追加整行时）[已核对-源码 02-S3]。

| 模板 | op 形状 | 语义 |
| --- | --- | --- |
| `appendModelRow(providerId, row)` | `{op:"set", path:["providers",providerId,"models",String(len)], value:row}`，`len` 取自**写入时刻**快照的 `models.length` | 下标==length 追加整行 [已核对-源码 02-S1 用例 3] |
| `setModelField(providerId, i, field, value)` | `{op:"set", path:["providers",providerId,"models",String(i),field], value}` | set 深字段 [用例 1] |
| `unsetModelField(providerId, i, field)` | `{op:"unset", path:["providers",providerId,"models",String(i),field]}` | 删键 → 回落 schema default / 继承（pi-ai `input=[]`=`继续继承`、`reasoningEfforts=false`=`非推理`语义因此不适用 unset 之外的清空手段）[用例 2 + v2-plan §4.2] |
| `unsetModelRow(providerId, i)` | `{op:"unset", path:["providers",providerId,"models",String(i)]}` | 整行 splice [用例 4] |

- `i` 的定位规则：**按模型 id 在快照 `models` 数组内定位下标，绝不缓存旧下标跨写入复用**；一次 plan 内多个 op 共享同一定位结果并在 plan 描述中记录 `(modelId → i)` 映射，冲突重试时全量重定位。
- 路由级字段（如 deepseek 的 `reasoningEffort` 路由枚举）投影规则属 B3/B6；SettingsWriter 只提供同构的 `setRouteField` 扩展点，不内置字段知识。
- 禁止：redacted 整份 namespace 替换（不用 update/replace）、`modelOverrides` 与显式 `models` 混写（两版 `resolveRouteModels` 互斥）[已核对-源码 02-S3；v2-plan §6.1.4/6.1.5]。

### 3.3 expectedRevision 围栏与 SETTINGS_CONFLICT 重试

```
apply(ns, plan):
  1. 入队（§3.4），独占该 ns 写链
  2. snap = read(ns)；ops = plan.build(snap.value)     // 模板按活值算下标
  3. try settings.mutate(ns, ops, snap.revision) → 成功：ledger 落 per-op applied + 新 revision，返回 {kind:"written"}
  4. catch SettingsConflictError（按 code 判别，不用 instanceof）：
       重试恰一次：
         snap2 = read(ns)
         按 plan 内 modelId 在 snap2.value 重新定位下标
         仅对 touched 字段重建 ops（与 snap2.value diff 后的最小集）
         settings.mutate(ns, ops2, snap2.revision)
       二次冲突 → 返回 {kind:"conflict", attempts:2, expected/actual}（不抛裸错误；由 service 层包 modelAssistant/apply-conflict）
  5. catch TypeError("Config array index ... out of range") → {kind:"row-missing"}：目标行已被并发删除；
     追加类 plan 允许自动转"重读后追加"一次（走第 4 步同路径）；编辑类不自动转，交用户
  6. catch "No configurable plugin entry <ns>" → {kind:"ns-missing"}；"not volatile" → 逐条记为缺陷（白名单/非 volatile 违规），绝不静默丢 op
```

- 重试语义对齐 v2-plan §6.1.3（重读、按 ID 重定位、touched 重 diff、**有限**重试）与 v2-plan §10（首版不做更多自动重试，后续失败重读由用户触发）：本设计的"重试一次"即 §6.1 的"有限重试"上限；再往上的重试是 UI 动作，不是 writer 行为。
- revision 围栏由宿主保证：`write()` 在 edit 闭包内重新 `describe()` 并比对 `descriptor.revision !== expected` 才放行 [已核对-源码 settings write L508-511]——writer 侧不需要自己实现 CAS，只需要保证 expectedRevision 取自同一次 read。

### 3.4 写链串行（单队列）

- 每 ns 一条 FIFO promise 链：`apply()` 的第 2–4 步整体入队，前驱 settle 才开始后继的 read——防止两次 apply 的 read-modify-write 交叠（交叠的典型后果：同一下标双追加）。
- 队列键 = ns（自有 ns `modelpilot` 与目标 ns `llm-pi-ai` 各自独立串行；跨 ns 无顺序约束，两 namespace 本就非原子事务，分项状态如实显示 [v2-plan §10]）。
- 队列不吞异常：任务失败把 outcome 交还调用方后立即放行下一个任务；不设超时（mutate 自身有宿主级联控制）。

### 3.5 审计日志（每 op 落 ledger）

- 两条落点：
  1. **自有 ns `ledger` 字段**（§1.4）：环形保留最近 200 条 attempt/op 记录，随 §3 的 commit 一并写入（走 SettingsWriter 自身，天然过 revision 围栏）；
  2. **持久审计文件** `dshCachePath("modelpilot", "ledger.jsonl")`：append-only JSONL，每行 `{ts, attemptId, ns, seq, op, expectedRevision, result, error?}`；5MB 轮转保留一份 `.1`。
- 记录粒度：attempt 级（含 attempts 计数）+ op 级（每条 PathOp 一行）。`kind ∈ {settings-write, profile-save, verify, cache-refresh}` 预留，B1 只落 settings-write。
- 日志红线：不含凭据、不含 key 值、path 段原样（id 不是机密）[v2-plan §12]。

---

## 4. prepareCall 双轨适配器（VerifyTransport）

事实基线：0.2.1 `prepareCall(config, signal?, configure?)` 三参，`ConfigureCall = (controls: Readonly<LlmCallControls>, model: Readonly<LlmResolvedModelInfo>) => LlmCallControls`，configure 分支先 `deepFreeze(structuredClone(controls))` 再交插件，结果仍走缺省物化与 effort 校验；0.2.0 两参。`PreparedLlmCall` 一次性 dispatch（重复 dispatch 或 config 变更 → `INVALID_PREPARED_CALL`）；`resolveCallConfig(config, signal)` 两版都在；`llm/stream` waterfall 冻结只读（loop 请求 deep-frozen、fallback 闭包捕获原 options）[已核对-源码 02-S2 + 探针 probe-preparecall]。

### 4.1 接口

```ts
interface VerifyTransport {
  readonly track: "configure" | "precheck";
  verify(cfg: LlmCallConfig, o: { signal?: AbortSignal; budgetTokens?: number }): Promise<VerifyOutcome>;
}
type VerifyOutcome =
  | { verdict: "accepted";  resolvedConfig: LlmCallConfig; adapterDefaults?: { reasoningEffort?: true; maxTokens?: true }; note?: string }
  | { verdict: "rejected";  code: string; message: string; stage: "resolve" | "dispatch" | "stream" };
```

- 用途唯一：**插件自己发起的验证请求**（v2-plan §6.4），绝不改写他人调用；`llm/stream` 只读性使"借 waterfall 改写"在两版都不成立，B1 不做任何该方向的挂钩。
- 失败码映射进 §2.5：`UNSUPPORTED_REASONING_EFFORT → modelAssistant/unsupported-effort`、`NO_ADAPTER → modelAssistant/route-unavailable`、其余 → `modelAssistant/verify-failed`。

### 4.2 ConfigureCallTransport（0.2.1 三参轨）

```
verify(cfg):
  prepared = await llm.prepareCall(cfg, signal, (controls, model) => ({
    ...controls,
    ...(budgetTokens ? { maxTokens: budgetTokens } : {})     // 显式验证预算：configure 是唯一参数级介入点
  }))
  // configure 输入是冻结克隆：只允许返回新对象，禁止原地改（改了也无效，deepFreeze 先行）[已核对-源码 02-S2 configure 分支]
  for await (chunk of prepared.stream(prepared.config)) { 消费/短路 }
  // 双护栏：stream 必须恰调一次；stream 参数必须 === prepared.config（callConfigEquals 检查）→ INVALID_PREPARED_CALL
  // → 这两条是 transport 内部不变量，违反即 transport bug，映射 modelAssistant/verify-failed 并附 note
```

- `prepared.config / adapterDefaults` 原样回填 outcome，供诊断屏展示"driver-confirmed"预览（v2-plan §4.3 previewFidelity）。

### 4.3 PrecheckTransport（0.2.0 预检轨）

```
verify(cfg):
  resolved = await llm.resolveCallConfig(cfg, signal)   // 预检：抛 UNSUPPORTED_REASONING_EFFORT / NO_ADAPTER 等，结构化捕获
  for await (chunk of llm.stream({ provider, model, ...resolved 控制字段, ...(budgetTokens ? {maxTokens: budgetTokens} : {}), signal })) { ... }
```

- 显式 `stream()` 直发；预检与 dispatch **不共享 adapter 注册绑定**（宿主文档明示 prepareCall 的注册绑定正是为防 HMR 拼接）[已核对-源码 dsh-llm prepareCall jsDoc]。残余风险：0.2.0 轨上 HMR 恰在预检与 dispatch 之间替换 adapter 时，验证结果可能来自旧 adapter——接受为该轨已知残余，记 note 并在 UI 不宣称 driver-confirmed [推断，边界源自宿主 jsDoc]。
- 预检失败同样产出结构化 `rejected{code, stage:"resolve"}`，与三参轨可辨识度对齐。

### 4.4 探测与 VersionCapabilities

```ts
// src/host/version-capabilities.ts —— 全插件唯一版本比较点
interface VersionCapabilities {
  hostVersion: string;               // 读 @deepseek-ai/dsh package.json version（宿主锚点，v2-plan 头部）
  supportsConfigure: boolean;        // runtime.prepareCall.length >= 3      [已核对-源码+探针 02-S2]
  nativeReasoningEditing: boolean;   // hostVersion >= 0.2.1-rc.1（semver 比较；解析失败 → false 保守）[已核对-源码 02-S4]
}
```

- 探测只认符号与版本串，不认行号（R2/R6）；`prepareCall.length` 在进程生命周期内不变，**探测一次、按 fiber 缓存**，不随 `llm/adapters-updated` 重探。
- `runtime` 句柄缺失 / `prepareCall` 非 function → supportsConfigure=false 且 verify 通道整体降级为"仅 resolveCallConfig 预检、不发请求"并显式告知（不静默）。
- echo（§2.2）把 caps 随握手返回，Client 半据此初始化 B4 的版本开关层；Client 不得自行二次探测。
- 机器非净版风险（purge/invariant 注入）由 CI 探针四件套守门，不进运行时逻辑 [已核对-源码 99-§三.3]。

---

## 5. 缓存布局（dshCachePath）

事实基线：`dsh-home-paths` 具名导出 `dshCachePath(optionsOrSegment?, ...segments)`，尊重 `DSH_HOME`，两版都在、0.2.1 为超集；**禁用 agentsHome 系列**（0.2.1 新增，非依赖面）[已核对-源码 02-S7]。

```text
<cache>/modelpilot/
├── models-dev-v1.json                     # 当前 models.dev 快照：{meta:{fetchedAt, digest, etag?, sourceVersion:"v1"}, providers:{…}}
├── last-known-good/
│   └── models-dev-v1.json                 # LKG：仅在新快照通过校验后复制
├── inflight/
│   └── models-dev-v1.json.<attemptId>     # singleflight 临时文件，写完原子 rename 落位
└── ledger.jsonl                           # §3.5 审计（轮转 .1）
```

- 端点定死 `https://models.dev/api.json`（子域不存在，实测）[已执行-探针 U6]；字段映射按 U6 定案表（`limit.context → context{tokens, semantics}`、`reasoning_options → reasoning.controls` 等），parser 归 core/，本层只管存储。
- 写协议：fetch → 校验（JSON 完整 + schema 版本匹配）→ 写 inflight → 原子 rename → 刷新 LKG。校验失败/截断**不覆盖**当前快照，读取端自动回退 LKG [U6 + v2-plan §12]。
- TTL 24h 软失效；ETag/304 响应头若提供则用，否则内容 digest 去重 [已执行-探针 U6]。
- singleflight：同 key 并发刷新只放一个 fetch 进 inflight，其余等待复用。
- 档案（profiles/rules/locks）**不存缓存目录**——它们在自有 settings ns（§1.4），缓存目录只放可再生数据；卸载不自动删宿主配置，缓存目录同口径 [v2-plan §10]。

---

## 6. Open Questions 与保守默认

| # | 问题 | 状态 | 保守默认（闭环前生效） |
| --- | --- | --- | --- |
| OQ-1 | 第三方 namespace（modelAssistant）的 client-face 调用是否必须补 client-side `TYPERT_REMOTE` manifest（`./remote` 导出）才能出现在 `ctx.remote.*` 代理上 | [待验证-P0-02]：echo 实机往返判定 | 假设**需要**；P0-02 探针同时验证两条路径（直连 ctx.remote / api-remotes 事件通道），哪条通走哪条，UI 对不可用路径显式降级 |
| OQ-2 | SRC-mode 下 gateway 对尾参 `signal?: AbortSignal` 的自动注入行为 | [待验证-P0-02]（echo 带长任务变体验证取消） | 方法全部容忍 signal 缺席；取消语义 = 尽力而为 + 结果幂等 |
| OQ-3 | `dshCachePath` 首参 options 对象形态的官方取值（`optionsOrSegment` 联合） | [推断-02-S7]（两版均按纯 segment 段使用） | 只用纯 segment 调用 `dshCachePath("modelpilot", ...)`，不用 options 形态 |
| OQ-4 | ModelKey 复合键编码中原始 ID 含 `/` 的转义规则 | [推断]（settings 的 providers dict key 本身允许任意字符串，但复合键需自定转义） | 百分号编码（`%`→`%25`、`/`→`%2F`），编码函数进 core/ 单测 |
| OQ-5 | settings `configure({auto:false})` 在 0.2.0/0.2.1 的签名是否逐字一致（范例插件为单版本核证） | [待验证-P0] | 双版都以 try/catch 包裹；失败仅降级为"原生表单可见"，不阻塞启动 |
| OQ-6 | 0.2.1 deepseek 路由级字段投影的运行时行为（静态同构已核，未跑真机） | [待验证-P1][U4 残余] | 投影白名单先只开 pi-ai；deepseek 白名单在 B6 独立启用 |

**全局保守默认**：任何探测失败都指向"能力不可用 + 显式降级"，绝不静默假设高版本能力；一切写路径先过 §3 围栏；一切版本判断集中在 version-capabilities.ts；P0 未过（v2-plan §14 四件套）不写业务代码。

---

## 附录 A — 本设计二次复核补锚（0.2.0-rc.2 tgz 实读，与审计结论一致）

| 断言 | 位置 |
| --- | --- |
| bindTypertRemote/TypertRemoteService/Remote/remoteMethods 公共面 | `dsh-typert-protocol/lib/index.js` L126-278 |
| gateway SRC 发现 + `<ns>/<method>` 路由 + gateway/* 错误码 | `dsh-api-gateway/lib/index.js` L435-439, L698-718, L962-1002, L1447-1448 |
| typert.register 原子性/重复拒绝 | `dsh-typert-registry/lib/index.js` L141-156, L398-418, L482 |
| loader `./typert` 扫描 + validateTypertManifest | `dsh-typert-loader/lib/index.js` L39-46, L77-117, L219-263 |
| SettingsConflictError / applyPathOp / mutate / write 围栏 | `dsh-settings/lib/index.js` L163-181, L189-216, L488-499, L501-537 |
| prepareCall 三护栏（once / config-equals / freeze）与 resolveCallWithInfo | `dsh-llm/lib/index.js` L2161-2235 |
| prepareCall 两参签名 / LlmCallConfig 形状 / discoverModels 契约 | `dsh-llm/lib/typert.host.js` L207-224, L340-344, L41-108 |
| pi-ai modelFields / Config volatile | `dsh-llm-pi-ai/lib/index.js` L1001-1051 |
| settings-models client 写与 settings/conflict 分支、dsh.client.inject 形态 | `dsh-client-ui-settings-models/lib/client.js` L2781-2814；package.json |
| bundle patch insert 形态（id/name/config） | 本机 dsh-purge `cordis.patch.yml`、`packages/purge-panel/cordis.patch.yml` |
