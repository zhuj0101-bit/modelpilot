# N9 — 0.2.2-rc.2 兼容性复核（2026-11-13，运行中宿主）

宿主升级到 **0.2.2-rc.2**（`Electron` 44.7.0，`@deepseek-ai/dsh` 声明 `engines.node >=24.9.0`）。本笔记记录逐项复核结果与本次所做的调整。

## 一、逐项复核（我依赖的每个面）

| # | 我依赖的面 | 0.2.0 | 0.2.1 | 0.2.2 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | `settings.mutate(ns, ops, expectedRevision)` | ✓ | ✓ | ✓ | 逐字节相同 |
| 2 | `applyPathOp` / `isVolatilePath` / `SettingsConflictError`(`SETTINGS_CONFLICT`) | ✓ | ✓ | ✓ | 三版源码实测同构（含越界、`splice`、易变级联） |
| 3 | `prepareCall(config, signal, configure)` / `INVALID_PREPARED_CALL` / `callConfigEquals` / `deepFreeze(structuredClone(controls))` | 2 参 | 3 参 | 3 参 | 双轨探测继续有效（0.2.2 = 配置轨） |
| 4 | `resolveSrcDescriptor`（`gateway` 的源码回退）+ `endpointOf` + `gateway/ambiguous-endpoint` | ✓ | ✓ | ✓ | 同构 |
| 5 | `TypertRemoteService` / `bindTypertRemote` / `remoteMethods` / `RemoteError` | ✓ | ✓ | ✓ | 导出清单在 0.2.2 仅**新增** `createTypertRemoteInfo` / `principalOf` / `isTypertRemoteMethod`，原有用法不变 |
| 6 | `resolveRouteModels` / `resolveModelReasoning` / `modelFields`（`name·contextWindow·maxTokens·input·reasoningEfforts·compat`） | ✓ | ✓ | ✓ | 逐字节相同 |
| 7 | `models` ⊕ `modelOverrides` 互斥 + 目录整体替换语义 | ✓ | ✓ | ✓ | 同构 |
| 8 | `Config = z.object({providers: z.dict(profile).default({}).volatile()})` | ✓ | ✓ | ✓ | 同构 |
| 9 | `volatileForm()` 决定设置页是否出现 | ✓ | ✓ | ✓ | 同构；探针证明我的四条数据线满足 |
| 10 | `configForms`（`get` / `whileServed` / `mutate` / `getSnapshot`） | ✓ | ✓ | ✓ | 同构；快照字段 = `{status,value,base,user,revision,writable}` |
| 11 | `slots` 服务（`inject` / `register`）+ `settings.section` 插槽 | ✓ | ✓ | ✓ | 提供者：`dsh-client-ui-renderer`（`slots`）／`dsh-client-ui-settings`（configForms） |
| 12 | `settings.configure(presentation, owner)` + `presentations.get(fiber)?.auto` | ✓ | ✓ | ✓ | 同构 |
| 13 | `bundle` 补丁的 `insert` 方言（`applyPatches`） | ✓ | ✓ | ✓ | 同构 |
| 14 | `evaluatePluginCompatibility`（对等范围 + `includePrerelease` + 豁免路径） | ✓ | ✓ | ✓ | 同构 |

**唯一实质变化**：`dsh-client-ui-slots` 不再作为独立包安装（0.2.2 里 `slots` 服务由 `dsh-client-ui-renderer` 提供，形态整体迁进渲染器）。我的打包产物只 `require("react")` / `require("react/jsx-runtime")`，不引用该包，因此**不受影响**。

## 二、本次做的调整

| 项 | 旧值 | 新值 | 依据 |
| --- | --- | --- | --- |
| `peerDependencies["@deepseek-ai/dsh"]` | `>=0.2.0-rc.2 <0.2.2-0` | `>=0.2.0-rc.2 <0.2.3-0` | 0.2.2 全部面同构（上表）；`^0.2.0-rc.2` 会放进 0.2.3 未验证版本，仍用显式上限 |
| 新增 `peerDependencies["@deepseek-ai/dsh-typert-protocol"]` | 无 | `>=0.2.0-rc.2 <0.2.3-0` | `Host` 半直接 `import` 该包；声明后安装期即可校验 |
| 新增 `peerDependencies["@deepseek-ai/cordis"]` | 无 | `~4.1.0` | 宿主 0.2.2 用 4.1.0（旧包 4.0.5） |
| `dependencies["@deepseek-ai/schemastery"]` | `^3.18.4` | `~3.19.0` | 宿主 0.2.2 用 3.19.0；易变标记与表单投影必须同版本 |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9.0` | 宿主自身声明 |
| `dsh.client.inject` | `ui-settings` + `client-locale` | `ui-renderer` + `ui-settings` | `slots` 由渲染器提供，`configForms` 由 `ui-settings` 提供；这两条才是真实依赖 |
| `Host` 的 `apply()` | `async` + `await import()` 动态加载服务 | 同步 + 静态 `import` | 动态 `import` 返回的 `promise` 不是所有 `cordis` 入口路径都会 `await` |
| 工作台的 `snap.mode` | 读 `snapshot.mode` | 读 `snapshot.status` / `snapshot.writable` | 0.2.2 的 `ConfigFormController.derive()` 只写 `status/value/base/user/revision/writable`，无 `mode` 字段 |
| `catalogIds` | 每次渲染新建 `Set` | `useMemo` 按路由稳定 | 否则 `projection` 的 `memo` 每次按键都失效 |

## 三、探针实测（可复跑）

- `tmp/probe-writepath-0.2.2.mjs` → 7/7 通过（三模板 + `splice` + 越界 + 易变级联 + 冲突形状）
- `tmp/probe-config-0.2.2.mjs` → `Config` 通过 0.2.2 `schemastery` 校验，四字段 `volatile=true`，`volatileForm` 返回非空（设置页会出现），`toJSON` 正常
- `tmp/probe-typert-0.2.2.mjs` → 绑定冻结、命名空间 `modelAssistant`、标记 `echo,listTargets`；`echo` 往返成功
- `tmp/probe-caps-real.mjs` → 3 参→配置轨、2 参→预检轨、缺失→不可用；宿主 `dsh-llm` 实测两条 `prepareCall` 均为 3 参
- `test/apply/mutate.integration.test.mjs` 已扩为**三版**（0.2.0 / 0.2.1 / 运行中的 0.2.2），9/9 通过

## 四、安装期依赖供给（新查证）

`dsh-app-boot` 的 `collectInstallationScopePackages` 从安装锚点出发，沿 `dependencies/peerDependencies/optionalDependencies` **递归**收集包名交给运行时解析器。实测该闭包 = 584 个包，覆盖 `@deepseek-ai/schemastery`、`dsh-typert-protocol`、`cordis`、`dsh-settings`、`dsh-llm`、`dsh-client-ui-settings`、`dsh-client-locale`。

**因此在 `peerDependencies` 里声明这些包是安全的**（不需要自己安装），并让安装期的 `evaluatePluginCompatibility` 提前发现版本错配。

## 五、仍未实机验证（保持诚实）

1. `settings.section` 在真实设置面板里的挂载与渲染（`slots.inject/register` 已按 0.2.2 源码对齐，但未在浏览器里跑过）。
2. 我的 `label: () => "ModelPilot"` 与宿主 `resolveSlotLabel` 的交互（宿主官方包用的正是 `label: () => t("nav")` 这种函数形态，形态一致）。
3. `dsh plugin --profile desktop add <tgz>` 的完整安装链（含 `pnpm` 决策与 `cordis.patch.yml` 合成）。