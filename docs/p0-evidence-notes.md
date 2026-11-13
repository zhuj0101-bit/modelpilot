# P0 实现素材笔记（主会话采证，供 C／D 阶段与 B 组验收对表）

## N1 `Remote` 注册的源码回退（P0-02 的重大简化）[已核对-源码]

`dsh-api-gateway/0.2.0-rc.2/lib/index.js:1001-1006`（0.2.1 同构，L1170 区）：

```js
resolveDescriptor(namespace, method, endpoint) {
    const strict = this.ctx.typert.local.get(endpoint);
    if (strict !== void 0) return strict;
    if (this.ctx.typert.local.hasSeen(endpoint)) throw … // 曾注册又撤销则禁止 SRC 回退
    return this.resolveSrcDescriptor(namespace, method, endpoint);
}

```

`resolveSrcDescriptor`（L1008-1045）：扫描 `ctx.reflect.props` 中的所有服务，取 `typertRemote` 绑定（`binding.namespace` 匹配）→ 用 `remoteMethods(original)` 找 `exportName ?? method` 匹配 → 动态生成源码 JSON 编解码描述符。约束：

- 源码方法的签名：业务参数任意，`signal` 若存在**必须是最后一个参数**（否则 gateway/signature-invalid）。
- 同一 `endpoint` 有多个服务导出 → gateway/ambiguous-endpoint 拒绝。
- 严格（TYPERT 清单）注册过又撤销 → `hasSeen` 禁止源码回退。

**结论**：P0-02 的 `echo` 只需 `class ModelAssistantService extends TypertRemoteService` + `@Remote('echo')` 方法，不需要 `./typert` 清单；清单／`typert-loader` 扫描留到 P2+（生成强类型客户端桩时再上）。`TypertRemoteService` 构造 = `super(ctx, serviceKey)`，serviceKey 即命名空间；两版 `bindTypertRemote` 逐字相同（唯一差异：`ctx instanceof Context` → `Context.is(ctx)`，0.2.1 L326-338 对 0.2.0 L146-158，语义等价）[已核对-源码]。

## N2 TYPERT 清单校验形状（P2+ 素材）[已核对-源码]

`dsh-typert-loader/0.2.1-rc.2/lib/index.js:78-119` 的 `validateTypertManifest`：清单必含 `{package(==导出包名), face:"host", schemas[{name, create()}], model{services[{key, exportName, members[{name,signature,kind}], types[{name,declaration}], tags/description/summary/jsDoc?}], events[], objects[]}, invocations[{id, service, namespace, method, invocation{kind:"direct"|…}, parameters[{name, wire, source:"json"|"lookup", codec{mode:"strict", typeSymbol}}], result{mode:"strict",…}}]}`。调用项可带 `cancellation{parameter:"signal"}`、`input()/invoke()` 直连选择器、`sourceLocation`。

## N3 插槽契约两版逐字节相同 [已核对-源码]

- `dsh-client-ui-slots` 两版 `lib/index.js` 的 MD5 相同（23,461 B）；类型面 `lib/types/*.d.ts` 仅有注释增量。
- `dsh-client-ui-settings` 两版 `lib/types/client/contract/slots.d.ts` **MD5 相同**（185 行）：`settings.section {kind:'list', scope:'root', owner: SettingsSectionOwnerProps}`——注册方法签名 `register(options{name, id, order, label, inject, children}, component) → disposer`，两版一致（`index.d.ts` L793-808 双 `overload`：无 `inject` ／ `inject` 工厂）。
- 补料包已下载解压：`modelpilot-tmp-npm/extracted/dsh-client-ui-settings/<ver>/pkg/`。

## N4 models.dev 快照 [已执行-探针]

`modelpilot-tmp-models-dev-api-snapshot.json`（197KB，网页抓取溢出后的抢救版，含渲染转义需清洗）。P0-05 的 `fixture` 以 B3 的 F1-F20 清单为准，用手写受控样例为主、本快照节选（`llmtech`／`frogbot`／`crossmodel`）清洗后为辅。

## N5 `npm` 补料区（正式引用路径）

`modelpilot-tmp-npm/extracted/<pkg>/<version>/package/lib/*.js`，已含 11 包 × 2 版本（原计划的 10 个 + 补下的 `dsh-client-ui-settings`）。一致性验证：`npm` 0.2.1 == 审计 `zip` 的 0.2.1（`settings` 的 MD5 相同）；`npm` 0.2.0 == 本机 `purge` 备份（上游 0.2.0 原版）[已核对-源码]。

## N7 对等依赖兼容语义实测 [已执行-探针]

`dsh-app-boot/lib/index.js` 的 `evaluatePluginCompatibility`：对 `@deepseek-ai/dsh*` 名下的对等依赖范围跑 `semver.satisfies(runtimeVersion, range, {includePrerelease:true})`，`workspace:*` 形态替换为运行时版本；不满足 → `incompatible`，豁免走 `dsh plugin allow-version <pkg>@<ver> --dsh-version <exact> --accept-risk`（`dsh-plugin-manager` + 插件命令行 `plugin-BGnVfe_D.js:15-96`）。

语义化版本实测（宿主自带 `semver`）：

| 范围 | 0.2.0-rc.2 | 0.2.1-rc.2 | 0.2.1-rc.5 | 0.2.2-rc.1 |
| --- | --- | --- | --- | --- |
| `0.2.0-rc.2 \|\| 0.2.1-rc.2` 精确双钉 | ✅ | ✅ | ❌ | ❌ |
| `^0.2.0-rc.2 \|\| ^0.2.1-rc.2` | ✅ | ✅ | ✅ | ✅ |
| `>=0.2.0-rc.2 <0.2.2-0` | ✅ | ✅ | ✅ | ❌ |

**定案（C／D 采纳）**：对等依赖写 `">=0.2.0-rc.2 <0.2.2-0"`（覆盖两个目标版本 + 0.2.1 的补丁流，0.2.2 出现时按其差异另测后放行——符合"不靠无上限星号宣称兼容"的原则）。B1 草案里的 `^0.2.0-rc.2 || ^0.2.1-rc.2` 会把 0.2.2-rc.1 也放进去，合并 DESIGN-v2 时替换。

## N8 插件安装链 [已核对-源码]

`dsh plugin --profile <name> add <spec>` = 转发 `pnpm` 到档案目录（`runPlugin`，桌面档案有保留检查）；安装描述支持 `npm` 名／`git`／`tgz`／本地路径形态（`GIT_SHORTHAND/TARBALL_SPEC/PACKAGE_NAME` 正则，安装描述区）。P0 出口判据可用 `dsh plugin --profile <非desktop名> add <本地路径或 tgz>`，或以"结构校验 + 单测全绿"替代（任务书已许可）。