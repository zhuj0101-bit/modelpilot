# B1 — SDK 接入层设计（ModelPilot）

日期：2026-11-10。文档性质：**设计章节**（纯设计，不含实现代码；文中 TS 片段均为类型／形状草案）。
宿主兼容范围：**DSH 0.2.0-rc.2 与 0.2.1-rc.2**（锚点 = `@deepseek-ai/dsh` 的 package.json 中的 `version`）。

证据标签沿用 dsh-compat-audit 规则：`[已核对-源码]` / `[已执行-探针]` / `[推断]` / `[待验证]`。
事实基线来源：`dsh-compat-audit/02-surface-diff.md`（下称 02-S1…S7）、`modelpilot/docs/01-gap-fill.md`（下称 U1…U6）。撰写本设计时对 `modelpilot-tmp-npm/extracted/<pkg>/<ver>/package/` 下的关键文件做了二次复核，补充行号见文末附录 A；凡与审计结论一致处只引审计编号。

---

## 1. 宿主／客户端双半结构与包形状

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

- 宿主半独占全部写副作用（`settings` 的 `mutate`、缓存落盘、验证请求）；客户端半只经带类型的 `Remote`（§2）与宿主既有的 `remote.settings / remote.llm` 透传读面交互。客户端消费端先例：`settings-models` 页面通过 `createModelsOperations(ctx)` 把 `ctx.remote.settings.mutate / ctx.remote.llm.discoverModels / ctx.remote.credentials.*` 绑成回调，错误按 `{code, message}` 分支消费 [已核对-源码 02-S4]。
- `core`／`shared` 不得 `import` 任何 `@deepseek-ai/*` 的运行时符号（类型除外）。
- 版本探测与版本号字符串只允许出现在 `src/host/version-capabilities.ts`（v2-plan §13 修订 1）。

### 1.2 package.json 的完整形状

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

- `dsh.bundle.patch` 与 `dsh.client.inject` 的字段形态照抄官方包与本机两个现例：`settings-models` 的 `dsh.client.inject` 列了三个前置包、`api-gateway` 带 `immediately: true`；`dsh-purge-community` 用 `dsh.bundle.patch` + 六项客户端注入 [已核对-源码 02-S4 / 本机包的 package.json]。`inject` 的具体清单是 B4 的输入，此处为 **[推断]**（前置最小集：插槽协议、设置页、语言包、`api-remotes` 的 `remote` 代理、连接）。
- `exports` 的四条为任务书定版：`.`（宿主入口）/ `./client`（客户端入口）/ `./typert`（宿主面 `typert` 工件，见 §2.6）/ `./package.json`。可选的第五条 `./remote`（客户端面 `TYPERT_REMOTE` 清单，`dsh-llm` 有先例：`exports["./remote"] → lib/typert.remote-client.js`）列为 **[待验证-P1]**（见开放问题 OQ-1）。
- `./typert` 导出一旦存在，`dsh-typert-loader` 会自动扫描并以 `ctx.typert.register(manifest)` 注册 [已核对-源码 02-S7 + U3；加载器源码里 `TYPERT_HOST_EXPORT = "./typert"`，`apply` 逐条解析加载器条目→`import`→`validateTypertManifest`→注册，重复注册整批拒绝]。**P0 阶段可以不带该导出**（`echo` 走源码模式，见 §2.1），严格清单路线到 P1 再启用，两者共存不冲突（网关先查严格描述符，未命中才落源码回退）[已核对-源码 `api-gateway` 的 `resolveDescriptor`：先 `ctx.typert.local.get(endpoint)`，再 `resolveSrcDescriptor`]。
- `peerDependencies` 的版本域统一为 `^0.2.0-rc.2 || ^0.2.1-rc.2`，React 跟随宿主的 18；`dependencies` 只放官方 `schemastery`（与加载器／`settings-models` 同款 `~3.18.4`）。不写无上限星号（v2-plan §13）。禁止依赖 0.2.1 独有的导出（`dsh-typert-protocol/remote-info`、`ctx.typert.resources`、`home-paths` 的 agentsHome 系列）[已核对-源码 U3 / 02-S7]。

### 1.3 cordis.patch.yml 的完整内容

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

- `insert` 行的 `id`／`name` 形态对照 `dsh-purge` 与 `purge-panel` 的打包补丁（`- id: <entryId>` / `name: <package 或 package/subpath>` / `config:`）[已核对-源码：本机 `dsh-purge` 的 cordis.patch.yml、`purge-panel` 的 cordis.patch.yml]。
- **组合条目的 id 决定 `settings` 命名空间** [已核对-源码：`settings` 的 `describe()` 输出 `ns: entry.options.id`；任务书基线]。`name` 指向包名；若未来拆子入口（例如工作台服务），命名走 `<pkg>/<subpath>` 形态。
- `config: {}`：自有命名空间的运行开关全部放在 §1.4 的 `Config` `schema` 里，经自有界面写入；打包层不预置业务默认值。

### 1.4 `Config` 导出（自有命名空间 = modelpilot）

出口形状（照范例插件 `dsh-plugin-model-capability`：`export const name / inject / apply` + `export const Config`）[已核对-范例插件：任务书基线]：

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

- 四条数据线全部标 `.volatile()`：`settings` 的写路径要求路径易变（`write()` 内 `isVolatilePath` 校验，非易变直接抛 `Config field ... is not volatile`）[已核对-源码 02-S1 + `settings` 源码 `write` L507]；`Config = z.object({ providers: z.dict(profile).default({}).volatile() })` 是 `pi-ai` 的先例，易变标记自该节点向下级联 [已核对-源码 02-S3，`pi-ai` 的 `Config` 两版逐字同构]。
- **关闭自动表单**：在 `apply` 内执行 `ctx.settings.configure({ auto: false }, ctx.fiber)`，本命名空间不进原生设置表单，界面全部走自有插槽／工作台（B4）[已核对-范例插件：任务书基线 `dsh-plugin-model-capability` 用法]。
- `schema` 变更语义：`describe()` 的修订号摘要含 `entry.fiber.uid + schema.toJSON() + config`，`schema` 升级本身就会推高修订号并触发 `settings/document-updated` [已核对-源码 `settings` describe L421-435]——也就是说，`schema` 迁移天然会让并发写失败，配合 §3.3 的重试即可，无需额外的迁移锁。

---

## 2. TypertRemoteService 注册设计（命名空间 = modelAssistant）

### 2.1 宿主侧的服务形态

```ts
import { TypertRemoteService, Remote, RemoteError } from "@deepseek-ai/dsh-typert-protocol";

export class ModelAssistantService extends TypertRemoteService {
  constructor(ctx) { super(ctx, "modelAssistant"); }   // serviceKey 即默认 wire namespace；可 { namespace } 覆盖
  // 方法表见 §2.2
}

```

注册链与跨版本证据：

- `TypertRemoteService` 的构造是 `super(ctx, serviceKey, options)`，`this.typertRemote = bindTypertRemote(this, this.name, options)`，`namespace = options.namespace ?? serviceKey` [已核对-源码 02-S7 / U3；`typert-protocol` 0.2.0 L146-172 与 0.2.1 对应区块同构]。
- `api-gateway` 按 `<namespace>/<method>` 路由：`endpointOf(namespace, method)`，并对每个服务原型扫描 `typertRemote` 绑定 + 用 `remoteMethods(original)` 收集 claims（`exportName ?? method`）[已核对-源码 `api-gateway` 0.2.0 的 `collectSrcClaims` L706-718、`resolveSrcDescriptor` 自 L1004 起；U3 判定两版校验路径不变]。
- 因此**源码模式（装饰器标记 + 服务绑定，无需生成清单）即可端到端路由**，这正是 P0-02 `echo` 连通探针的承载方式；严格的生成清单路线（§2.6）作为 P1 增强，两版公共面一致，无需版本特判 [已核对-源码 U3]。
- 在服务子树内可读 `ctx.invocation`（调用期派生的 ctx 会遮蔽根访问器），用于逐调用审计 [已核对-源码 `typert-protocol` 的 `provideInvocationAccessor`]。
- 注册时机：在 `apply()` 内 `ctx.provide("modelAssistant", new ModelAssistantService(ctx))`（Cordis 服务的常规注册）；随 `fiber` 撤销自动回收。

### 2.2 方法表（P0 → V0.3）

| 方法 | 输入线上形状 | 输出 | 里程碑 | 备注 |
| --- | --- | --- | --- | --- |
| `echo` | `{nonce: string, ts?: number}` | `{nonce, hostVersion, caps: {supportsConfigure, nativeReasoningEditing}}` | **P0-02** | 连通与能力握手一体；客户端据此初始化版本能力缓存 |
| `listTargets` | `{}` | 可配置的路由／驱动／协议／允许字段 + 能力集 | V0.1 | 数据源 = `ctx.remote` 同侧的 `llm.listConfigurableProviders()`（宿主内直接调 `llm` 服务） |
| `resolve` | `ModelKey + draftGeneration` | 事实／字段候选／匹配轨迹／目录版本 | V0.1 | 查询零写入（B2／B3 承接） |
| `saveProfile` / `listProfiles` | 版本化档案 | 自有命名空间档案 + 修订号 | V0.1 | 写自有命名空间，走 §3 的设置写入器 |
| `prepareApply` | 档案 + 已选字段 + 修订号 | `planId`、补丁差异、未支持项、分项计划 | V0.1 | 计划绑定档案版本（幂等键） |
| `commitApply` | `planId` + 确认 | 分项结果 + 新修订号 | V0.1 | 写目标命名空间（`llm-pi-ai` 等），走 §3 |
| `previewWire` | 档案 + 请求上下文摘要 | 逻辑级／驱动确认级预览 | V0.2 | 只投影不请求 |
| `verifySelected` | 路由 + 已选配置 + 显式预算 | 接受／未支持／未知三类证据 | V0.3 | 走 §4 双轨 |

- 方法表沿用 v2-plan §9 的七个接口 + `echo`；里程碑对齐 v2-plan §14。
- 所有方法参数必须是无损 JSON（线上载荷要过 `isRemoteJsonValue` 闸）[已核对-源码 `typert-protocol` 的 json-value 区]；`AbortSignal` 只能以尾参 `signal` 的形式出现（见 §2.3 的约束）。

### 2.3 `@Remote` 装饰器的形态与约束

```ts
@Remote("echo")
async echo(payload: { nonce: string; ts?: number }, signal?: AbortSignal) { ... }

```

约束（每条都有源码锚）：

- `@Remote(name)` 要求**公共实例方法 + 字符串名**；`static`／`private`／无名字面量直接 `TypeError` [已核对-源码 `typert-protocol` 的 `addMarkerInitializer`：`context.private || context.static || typeof context.name !== "string"` 即抛错]。装饰器走标准装饰器的 `context.addInitializer` 通道，把标记写进类原型（描述符版本 1），同一方法重复标记幂等、标记冲突则抛错 [已核对-源码 `mark()` L248-268]。
- `@Remote({mode:"stream"})` 是流式变体（选项必须恰好一项）；B1 首版方法表**全部为一元调用**，流式载荷不进首版（验证请求在内部消费分片，不外露流）。
- `signal` 注入：严格描述符由清单的 `cancellation: {parameter:"signal"}` 声明；源码模式下网关对尾参 `signal` 的注入行为**未逐行核验** [待验证-OQ2]。设计对策：每个方法都容忍 `signal` 缺席（`signal?: AbortSignal`），并把取消语义定义为"尽力而为 + 结果幂等"。
- 禁止 `import` 任何生成式 `typert` 文件的内部结构（0.2.0 是数组式契约，0.2.1 是 `createTypertRemoteInfo` 注册表，形态不同）[已核对-源码 02-S7；U3]。只用 `Remote / RemoteError / RemoteScope / TypertRemoteService / remoteMethods` 这一公共面。

### 2.4 客户端侧调用

- 首选路径：`ctx.remote.modelAssistant.echo({ nonce })`——客户端半与 `settings-models` 消费 `ctx.remote.settings / ctx.remote.llm / ctx.remote.session` 的方式同构（`api-remotes` 注入的 `remote` 代理按命名空间取桩）[已核对-源码 02-S4；`settings-models` 的 client.js `createModelsOperations` 自 L2781 起]。
- 返回值分支遵循既有 `RemoteResult` 习惯：`response.ok ? response.value : response.error`，`error` 为 `{code, message}`（客户端面重建 `RemoteError` 实例，`throw result.error` 保持抛出语义）[已核对-源码 `typert-protocol` 的 `remote-error` 注释；`settings-models` 的 `code === "settings/conflict"` 分支]。
- **第三方命名空间的客户端面桩是否必须注册客户端侧 `TYPERT_REMOTE` 清单**：由 P0-02 的 `echo` 探针实机判定 [待验证-OQ1]。降级路径（若确实需要清单）：补 `./remote` 导出（`dsh-llm` 形态的手写 `TYPERT_REMOTE`）或经 `api-remotes` 的转发式 `remote` 事件通道 [推断-U3/02-S7：`api-remotes` 0.2.1 已透传 entry.resources，但它的依赖面不进 B1]。

### 2.5 错误映射（RemoteError 错误码约定）

`RemoteError(code, message, details)`：判别**只按 code、永远不用 instanceof**（跨 realm／打包产物的结构标记 `isDSHRemoteError` + `remoteErrorOf()` 仅供机制内部使用）[已核对-源码 `typert-protocol` 的 `remote-error` 区]。

| 层 | 错误码 | 来源／映射 |
| --- | --- | --- |
| 网关 | `gateway/service-unavailable`、`gateway/method-unavailable`、`gateway/definition-unavailable`、`gateway/signature-invalid`、`gateway/cancelled`、`gateway/protocol`、`gateway/uplink-overflow` | 网关原样透传，插件不改写 [已核对-源码 `api-gateway` L435-439/L730/L968/L988/L1001/L1292] |
| 目标 `settings` | `settings/conflict` | 宿主 `SettingsConflictError(code="SETTINGS_CONFLICT")` 经线上层的既有映射先例 [已核对-源码 02-S1 + `settings-models` L2802] |
| 插件业务 | `modelAssistant/apply-conflict` | 包裹 `SETTINGS_CONFLICT`：`details = {ns, expected, actual, attempts}`（§3.3 的两次冲突之后） |
| 插件业务 | `modelAssistant/route-unavailable` | `llm` `LlmError("NO_ADAPTER")` 的映射 |
| 插件业务 | `modelAssistant/unsupported-effort` | `llm` `LlmError("UNSUPPORTED_REASONING_EFFORT")` 的映射，`details` 带提供方／model／effort |
| 插件业务 | `modelAssistant/invalid-plan` | `planId` 不存在／与档案版本不匹配／`desiredProfileVersion` 过期 |
| 插件业务 | `modelAssistant/field-not-writable` | 白名单外字段（§3.2）或 `schema` 非易变而拒绝 |
| 插件业务 | `modelAssistant/verify-failed` | §4 的传输失败且无法归类时 |

- `details` 必须是无损 JSON（不带 Error／Signal／函数）。
- 宿主内部异常一律包成上表的业务码再抛；裸 `TypeError`（如 `Config array index ... out of range`）在 §3.1 内部分类消化，不出插件边界。

### 2.6 ./typert 清单（严格路线，P1）

- 清单形状按 `validateTypertManifest` 的校验面手写，或由编译器产出：`{package: 本包名, face: "host", schemas: [{name, create()}], model, invocations: [...]}`；`manifest.package` 必须等于导出它的包名、`face` 必须为 `"host"`，否则加载器拒绝 [已核对-源码加载器的 `validateTypertManifest` L77-117]。
- 加载器以 `ctx.typert.register(manifest)` 原子注册（包-面／`schema` 键／调用 id／endpoint 任一重复 → 整批拒绝），并按 `fiber` 撤销 [已核对-源码注册表的 `register()` L398-418：`ctx.effect` 原子提交／撤回；U3]。
- 手工兜底路径：在 `apply()` 内 `ctx.typert.register(contribution)`（先 `validateTypertManifest` 自检再交注册）——加载器与手工方式互斥，同一包不允许双注册（第二次会因包-面重复被拒）[已核对-源码 U3 + 注册表 L482]。
- 调用项条目需含 `service: "modelAssistant"`、`namespace: "modelAssistant"`、每个参数 `{name, wire, source:"json", codec:{mode:"strict", create}}`、同构的 `result`、`cancellation: {parameter:"signal"}`（形状照 `dsh-llm` 的 `./typert` 工件逐字段）[已核对-源码 `dsh-llm` 的 `typert`.host.js L41-108]。

---

## 3. `settings` `mutate` 封装（SettingsWriter）

事实基线（本节全部承重）：`mutate(ns, ops, expectedRevision)`；数组下标必须是字符串数字 `String(i)`（`/^(0|[1-9][0-9]*)$/`）；`set` 写深字段／`unset` 删行（`splice`）或删键（回落 `schema` 默认／继承）/ 下标 `== length` 且为 `set` 且其余为空 → 追加整行；越界抛 `TypeError`；易变标记自 `providers` 节点级联（`pi-ai` 的 `Config` 易变）→ 白名单路径全部合法；冲突抛 `SettingsConflictError`（`code=SETTINGS_CONFLICT`，携带 expected／actual）[已核对-源码 02-S1 + 探针 probe-walker 10/10 + `settings` L163-216/L488-499/L501-537]。

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

- `read` 复用宿主的 `describe()`（同一进程内修订号单调）；**不做脱敏**（宿主侧调用，凭据引用 `apiKeyEnv` 本就在白名单外，永不读写）[已核对-源码 02-S4 原生 pathOps 同口径]。

### 3.2 操作组装模板（三类）

写路径正典：`providers.<id>.models.<String(i)>.<field>`。白名单字段 = `pi-ai` 的 `modelFields`（两版同集）：`name / contextWindow / maxTokens / input / reasoningEfforts / compat`（+ `id`，仅追加整行时需要）[已核对-源码 02-S3]。

| 模板 | 操作形状 | 语义 |
| --- | --- | --- |
| `appendModelRow(providerId, row)` | `{op:"set", path:["providers",providerId,"models",String(len)], value:row}`，`len` 取自**写入时刻**快照的 `models.length` | 下标 == length 追加整行 [已核对-源码 02-S1 用例 3] |
| `setModelField(providerId, i, field, value)` | `{op:"set", path:["providers",providerId,"models",String(i),field], value}` | 写深字段 [用例 1] |
| `unsetModelField(providerId, i, field)` | `{op:"unset", path:["providers",providerId,"models",String(i),field]}` | 删键 → 回落 `schema` 默认／继承（`pi-ai` 的 `input=[]` 表示"继续继承"、`reasoningEfforts=false` 表示"非推理"，这类语义因此只能靠删键清空）[用例 2 + v2-plan §4.2] |
| `unsetModelRow(providerId, i)` | `{op:"unset", path:["providers",providerId,"models",String(i)]}` | 整行 `splice` [用例 4] |

- `i` 的定位规则：**按模型 id 在快照的 `models` 数组内定位下标，绝不缓存旧下标跨写入复用**；一次计划内多个操作共享同一定位结果，并在计划描述中记录 `(modelId → i)` 映射，冲突重试时全量重定位。
- 路由级字段（例如 deepseek 的 `reasoningEffort` 路由枚举）的投影规则属 B3／B6；设置写入器只提供同构的 `setRouteField` 扩展点，不内置字段知识。
- 禁止：整份命名空间脱敏替换（不用 update／replace）、`modelOverrides` 与显式 `models` 混写（两版 `resolveRouteModels` 互斥）[已核对-源码 02-S3；v2-plan §6.1.4/6.1.5]。

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

- 重试语义对齐 v2-plan §6.1.3（重读、按 ID 重定位、touched 重算差异、**有限**重试）与 v2-plan §10（首版不做更多自动重试，后续失败重读由用户触发）：本设计的"重试一次"即 §6.1 的"有限重试"上限；再往上的重试是界面动作，不是写入器行为。
- 修订号围栏由宿主保证：`write()` 在编辑闭包内重新 `describe()` 并比对 `descriptor.revision !== expected` 才放行 [已核对-源码 `settings` `write` L508-511]——写入器侧不需要自己实现 CAS，只需保证 `expectedRevision` 取自同一次 `read`。

### 3.4 写链串行（单队列）

- 每个命名空间一条先进先出 promise 链：`apply()` 的第 2–4 步整体入队，前一个任务落定后才开始下一个的 `read`——防止两次 apply 的读-改-写交叠（交叠的典型后果：同一下标被双追加）。
- 队列键 = 命名空间（自有命名空间 `modelpilot` 与目标命名空间 `llm-pi-ai` 各自独立串行；跨命名空间无顺序约束，两个命名空间本就不是原子事务，分项状态如实显示 [v2-plan §10]）。
- 队列不吞异常：任务失败把结果交还调用方后立即放行下一个任务；不设超时（`mutate` 自身有宿主级联控制）。

### 3.5 审计日志（每个操作落台账）

- 两个落点：
 1. **自有命名空间的 `ledger` 字段**（§1.4）：环形保留最近 200 条尝试／操作记录，随 §3 的提交一并写入（走设置写入器自身，天然过修订号围栏）；
 2. **持久审计文件** `dshCachePath("modelpilot", "ledger.jsonl")`：只追加的 JSONL，每行 `{ts, attemptId, ns, seq, op, expectedRevision, result, error?}`；5MB 轮转保留一份 `.1`。
- 记录粒度：尝试级（含 attempts 计数）+ 操作级（每条 PathOp 一行）。`kind ∈ {settings-write, profile-save, verify, cache-refresh}` 预留，B1 只落 `settings-write`。
- 日志红线：不含凭据、不含密钥值、路径段原样（id 不是机密）[v2-plan §12]。

---

## 4. prepareCall 双轨适配器（VerifyTransport）

事实基线：0.2.1 的 `prepareCall(config, signal?, configure?)` 为三参，`ConfigureCall = (controls: Readonly<LlmCallControls>, model: Readonly<LlmResolvedModelInfo>) => LlmCallControls`，配置分支先 `deepFreeze(structuredClone(controls))` 再交插件，结果仍走缺省物化与档位校验；0.2.0 为两参。`PreparedLlmCall` 一次性派发（重复派发或配置变更 → `INVALID_PREPARED_CALL`）；`resolveCallConfig(config, signal)` 两版都在；`llm/stream` 瀑布流冻结只读（循环请求深冻结、回退闭包捕获原 `options`）[已核对-源码 02-S2 + 探针 probe-preparecall]。

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

- 用途唯一：**插件自己发起的验证请求**（v2-plan §6.4），绝不改写他人调用；`llm/stream` 的只读性使"借瀑布流改写"在两版都不成立，B1 不做任何该方向的挂钩。
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

- `prepared.config / adapterDefaults` 原样回填结果，供诊断屏展示"驱动确认级"预览（v2-plan §4.3 previewFidelity）。

### 4.3 PrecheckTransport（0.2.0 预检轨）

```
verify(cfg):
  resolved = await llm.resolveCallConfig(cfg, signal)   // 预检：抛 UNSUPPORTED_REASONING_EFFORT / NO_ADAPTER 等，结构化捕获
  for await (chunk of llm.stream({ provider, model, ...resolved 控制字段, ...(budgetTokens ? {maxTokens: budgetTokens} : {}), signal })) { ... }

```

- 显式 `stream()` 直发；预检与派发**不共享适配器注册绑定**（宿主文档明确说明：`prepareCall` 的注册绑定正是为了防 HMR 拼接）[已核对-源码 `dsh-llm` 的 prepareCall jsDoc]。残余风险：0.2.0 轨上若 HMR 恰在预检与派发之间替换了适配器，验证结果可能来自旧适配器——接受为该轨的已知残余，记录 note 并在界面上不宣称"驱动确认级" [推断，边界源自宿主 jsDoc]。
- 预检失败同样产出结构化的 `rejected{code, stage:"resolve"}`，与三参轨的可辨识度对齐。

### 4.4 探测与 VersionCapabilities

```ts
// src/host/version-capabilities.ts —— 全插件唯一版本比较点
interface VersionCapabilities {
  hostVersion: string;               // 读 @deepseek-ai/dsh package.json version（宿主锚点，v2-plan 头部）
  supportsConfigure: boolean;        // runtime.prepareCall.length >= 3      [已核对-源码+探针 02-S2]
  nativeReasoningEditing: boolean;   // hostVersion >= 0.2.1-rc.1（semver 比较；解析失败 → false 保守）[已核对-源码 02-S4]
}

```

- 探测只认符号与版本串，不认行号（R2／R6）；`prepareCall.length` 在进程生命周期内不变，**探测一次、按 `fiber` 缓存**，不随 `llm/adapters-updated` 重探。
- `runtime` 句柄缺失／`prepareCall` 不是函数 → `supportsConfigure=false`，且验证通道整体降级为"仅 `resolveCallConfig` 预检、不发请求"并显式告知（不静默）。
- `echo`（§2.2）把能力集随握手返回，客户端半据此初始化 B4 的版本开关层；客户端不得自行二次探测。
- 机器非净版风险（purge／不变量注入）由 CI 的四件套探针守门，不进运行时逻辑 [已核对-源码 99-§三.3]。

---

## 5. 缓存布局（dshCachePath）

事实基线：`dsh-home-paths` 具名导出 `dshCachePath(optionsOrSegment?, ...segments)`，尊重 `DSH_HOME`，两版都有、0.2.1 为超集；**禁用 agentsHome 系列**（0.2.1 新增，非依赖面）[已核对-源码 02-S7]。

```text
<cache>/modelpilot/
├── models-dev-v1.json                     # 当前 models.dev 快照：{meta:{fetchedAt, digest, etag?, sourceVersion:"v1"}, providers:{…}}
├── last-known-good/
│   └── models-dev-v1.json                 # LKG：仅在新快照通过校验后复制
├── inflight/
│   └── models-dev-v1.json.<attemptId>     # singleflight 临时文件，写完原子 rename 落位
└── ledger.jsonl                           # §3.5 审计（轮转 .1）

```

- 端点定死 `https://models.dev/api.json`（子域不存在，已实测）[已执行-探针 U6]；字段映射按 U6 定案表（`limit.context → context{tokens, semantics}`、`reasoning_options → reasoning.controls` 等），解析器归 `core/`，本层只管存储。
- 写入协议：取回 → 校验（JSON 完整 + `schema` 版本匹配）→ 写 `inflight` → 原子 rename → 刷新最后可用快照。校验失败／截断**不覆盖**当前快照，读取端自动回退到最后可用快照 [U6 + v2-plan §12]。
- TTL 24h 软失效；响应头若提供 ETag／304 则用之，否则按内容摘要去重 [已执行-探针 U6]。
- singleflight：同一键的并发刷新只放一个取回进 `inflight`，其余等待复用。
- 档案（profiles／rules／locks）**不存缓存目录**——它们在自有 `settings` 命名空间（§1.4），缓存目录只放可再生数据；卸载不自动删宿主配置，缓存目录同口径 [v2-plan §10]。

---

## 6. 开放问题与保守默认

| # | 问题 | 状态 | 保守默认（闭环前生效） |
| --- | --- | --- | --- |
| OQ-1 | 第三方命名空间（modelAssistant）的客户端面调用，是否必须补客户端侧 `TYPERT_REMOTE` 清单（`./remote` 导出）才能出现在 `ctx.remote.*` 代理上 | [待验证-P0-02]：由 `echo` 实机往返判定 | 假设**需要**；P0-02 探针同时验证两条路径（直连 `ctx.remote` ／ `api-remotes` 事件通道），哪条通走哪条，界面对不可用路径显式降级 |
| OQ-2 | 源码模式下网关对尾参 `signal?: AbortSignal` 的自动注入行为 | [待验证-P0-02]（用 `echo` 的长任务变体验证取消） | 方法全部容忍 `signal` 缺席；取消语义 = 尽力而为 + 结果幂等 |
| OQ-3 | `dshCachePath` 首参 `options` 对象形态的官方取值（`optionsOrSegment` 联合） | [推断-02-S7]（两版均按纯分段方式使用） | 只用纯分段调用 `dshCachePath("modelpilot", ...)`，不用 `options` 形态 |
| OQ-4 | ModelKey 复合键编码中，原始 ID 含 `/` 的转义规则 | [推断]（`settings` 的 providers 字典键本身允许任意字符串，但复合键需自定转义） | 百分号编码（`%`→`%25`、`/`→`%2F`），编码函数进 `core/` 单测 |
| OQ-5 | `settings` 的 `configure({auto:false})` 在 0.2.0／0.2.1 的签名是否逐字一致（范例插件只做过单版本核证） | [待验证-P0] | 双版都用 try/catch 包裹；失败仅降级为"原生表单可见"，不阻塞启动 |
| OQ-6 | 0.2.1 中 `deepseek` 路由级字段投影的运行时行为（静态同构已核，未跑真机） | [待验证-P1][U4 残余] | 投影白名单先只开 `pi-ai`；`deepseek` 白名单在 B6 独立启用 |

**全局保守默认**：任何探测失败都指向"能力不可用 + 显式降级"，绝不静默假设高版本能力；一切写路径先过 §3 围栏；一切版本判断集中在 `version-capabilities.ts`；P0 未过（v2-plan §14 的四件套）不写业务代码。

---

## 附录 A — 本设计二次复核补锚（实读 0.2.0-rc.2 的 tgz，与审计结论一致）

| 断言 | 位置 |
| --- | --- |
| `bindTypertRemote`／`TypertRemoteService`／`Remote`／`remoteMethods` 的公共面 | `dsh-typert-protocol/lib/index.js` L126-278 |
| 网关的源码发现 + `<ns>/<method>` 路由 + `gateway/*` 错误码 | `dsh-api-gateway/lib/index.js` L435-439, L698-718, L962-1002, L1447-1448 |
| `typert.register` 的原子性／重复拒绝 | `dsh-typert-registry/lib/index.js` L141-156, L398-418, L482 |
| 加载器的 `./typert` 扫描 + `validateTypertManifest` | `dsh-typert-loader/lib/index.js` L39-46, L77-117, L219-263 |
| `SettingsConflictError` / `applyPathOp` / `mutate` / `write` 围栏 | `dsh-settings/lib/index.js` L163-181, L189-216, L488-499, L501-537 |
| `prepareCall` 的三道护栏（一次性／配置相等／冻结）与 `resolveCallWithInfo` | `dsh-llm/lib/index.js` L2161-2235 |
| `prepareCall` 的两参签名／`LlmCallConfig` 形状／`discoverModels` 契约 | `dsh-llm/lib/typert.host.js` L207-224, L340-344, L41-108 |
| `pi-ai` 的 `modelFields` / `Config` 易变 | `dsh-llm-pi-ai/lib/index.js` L1001-1051 |
| `settings-models` 的客户端写入与 `settings/conflict` 分支、`dsh.client.inject` 形态 | `dsh-client-ui-settings-models/lib/client.js` L2781-2814；package.json |
| 打包补丁 `insert` 形态（`id`/`name`/`config`） | 本机 `dsh-purge` 的 `cordis.patch.yml`、`packages/purge-panel/cordis.patch.yml` |