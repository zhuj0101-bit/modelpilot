# ModelPilot — 执行计划（PLAN.md）

日期：2026-11-10。依据：DESIGN-v2.md。每个任务四元组：输入／动作／产出／判据（+依赖）。规则：完成一个勾一个；判据不过不进下一个依赖任务；全程零宿主写入、零真实模型请求。

## P0 — SDK 概念验证

### P0-01 仓库脚手架
- 输入：DESIGN-v2 §3／§4／§6（J9、J10）、N6／N7、范例插件形状（N6）。
- 动作：`package.json`（名称 `modelpilot` → 定名 `@modelpilot/dsh-model-assistant` 或保持无作用域 `dsh-model-assistant`，`cordis.patch.yml` 的 `insert` `id=modelpilot`、`exports` `./ ./client ./package.json`、对等依赖 `">=0.2.0-rc.2 <0.2.2-0"`、普通依赖仅 `@deepseek-ai/schemastery`）；`Config` 导出（`profiles`／`rules`／`locks`／`ledger` 四条易变数据线，B1 §1.4 形状）；`Host` 半的 `apply` 空实现 + `settings.configure({auto:false})` 的 try/catch；`cordis.patch.yml`；`.gitignore`；`tsconfig`（`strict`）。
- 产出：可通过 `node --check` 的 `lib` 骨架 + 结构校验脚本 `test/structure.test.mjs`。
- 判据：①package.json 的 JSON 合法且版本范围满足 N7 矩阵（0.2.0-rc.2／0.2.1-rc.2 为 `true`，0.2.2-rc.1 为 `false`）②`cordis.patch.yml` 仅一条 `insert` 且 `id=modelpilot` ③`Config` 含易变字段导出 ④结构测试全绿。
- 依赖：无。

### P0-02 TypertRemoteService `echo`（源码模式）
- 输入：N1（源码回退）、N2（清单留 P1）、B1 §2、`protocol` L146-158（`bindTypertRemote`）。
- 动作：`class ModelAssistantService extends TypertRemoteService`（`super(ctx,"modelAssistant")`）；`@Remote("echo") echo({message, delayMs?}, signal?)`（`signal` 尾参可选）；返回 `{message, caps: {supportsConfigure, nativeReasoningEditing, hostVersion}}`；单测：`bindTypertRemote` 绑定对象形状（`service`／serviceKey／`namespace` 三个冻结键）、`@Remote` 描述符注册（`remoteMethods` 返回 `echo` 标记）、`endpoint` 构造 `modelAssistant/echo`。
- 产出：`src/host/model-assistant-service.js` + `test/host/remote-bind.test.mjs`。
- 判据：单测全绿（不依赖真机远程调用）；OQ-B1-1（`client` 面清单）／OQ-B1-2（`signal` 注入）登记为 [待验证-P0 实机]，探针脚本一并产出。
- 依赖：P0-01。

### P0-03 `settings` `mutate` 集成测试
- 输入：02-S1 的路径遍历语义、B1 §3、审计探针 `probe-walker.mjs`。
- 动作：从 0.2.0 与 0.2.1 的 `npm` 包**各自逐字提取** `applyPathOp`／`isVolatilePath`／`isPlainObject` 与 `mutate` 的 `reduce` 骨架；`fixture` `schema`（`providers` 易变字典 + `models` 数组）；用例矩阵：遍历六用例 × 两版源码 + 三类操作模板（`appendModelRow`／`setModelField`／`unsetModelRow`）+ 修订号冲突（`expected`≠`actual` 抛 `SETTINGS_CONFLICT`）+ 重试一次语义（重读、重定位、重算差异）。
- 产出：`test/apply/mutate.integration.test.mjs`（双版本参数化）+ `src/host/settings-writer.js` 首版。
- 判据：两版源码各自全用例通过（≥ 遍历 10 条断言 + 模板／冲突／重试 12 条断言）。
- 依赖：P0-01。

### P0-04 prepareCall 双轨探测单测
- 输入：02-S2、B1 §4、两份探针输出。
- 动作：`src/shared/version-capabilities.js`（`detectVersionCapabilities(llmRuntime)`：`supportsConfigure = typeof prepareCall==="function" && prepareCall.length>=3`，一次探测后按 `fiber` 缓存）；`VerifyTransport` 接口 + `ConfigureTransport`／`PrecheckTransport` 两个实现（对 `mock` 运行时：3 参 `mock` 走配置轨，断言深冻结克隆与一次性派发；2 参 `mock` 走 `resolveCallConfig` 预检 + 显式 `stream`）；非法输入导致探测失败 → 给出显式降级对象。
- 产出：`src/shared/version-capabilities.js` + `src/host/verify-transport.js` + `test/shared/version-caps.test.mjs`。
- 判据：探测矩阵（2 参／3 参／缺失／非函数）全过；两轨各 ≥4 条断言（冻结、一次性、`INVALID_PREPARED_CALL`、预检错误透传）。
- 依赖：P0-01。

### P0-05 `models`.dev 解析器 `fixture` 测试
- 输入：U6 映射表、B3 §2 + §9 的 F1–F20 清单、快照节选（N4）。
- 动作：`src/sources/models-dev-v1.js`（取回→校验→摘要去重→最后可用快照→`NormalizedEntry[]`；阈值 10MB／5000 条；非法条目跳过并计数）；`fixture`：手写受控样例覆盖 F1–F20（三型 `reasoning_options` 含 `budget` 的 4 个子变体、`deprecated`、无推理、`limit.input` 有无、规范化悬空、大小写对、后缀 id、auto/free、非法条目族、坏顶层、摘要重复）；取回注入化（不发真实网络，`fixture` 文件直喂）。
- 产出：`src/sources/models-dev-v1.js` + `test/fixtures/models-dev/*.json` + `test/sources/parser.test.mjs`。
- 判据：F1–F20 全过；`errors[]` 计数准确；坏目录不覆盖最后可用快照这一断言成立。
- 依赖：P0-01。

### P0 出口判据（整体）
1. 五个任务的判据全绿；`node --test` 汇总通过。
2. 结构级加载验证：`cordis.patch.yml` + `package.json` 的形状可通过 `dsh plugin --profile <test> add <local>` 的干校验（或按任务书许可，以"结构校验+单测全绿"替代表达，报告中说明）。
3. CI 就绪：审计四件探针 + 本仓测试可一键重跑。
4. 提交版本库 + 里程碑汇报。

## P1 — 核心闭环（任务清单预置，开工时细化）

| 任务 | 判据 | 依赖 |
| --- | --- | --- |
| P1-01 身份解析器五级链 | B3 §3 每级单测（含规范化悬空／大小写对／`auto-free` 跳过） | P0-05 |
| P1-02 候选引擎 8 级合成 | `touched`／`locked` 短路与并列池单测 | P1-01 |
| P1-03 `pi-ai` 投影器（R1–R7 预检） | 对宿主 `resolveModelReasoning` 的拒绝条件逐条做 `fixture`；B2-Q1／Q3／Q8 先核证 | P0-03 |
| P1-04 应用服务 `prepare`／`commit` | planId 幂等四层 + 分项状态单测（B5 §1／§2） | P1-03 |
| P1-05 lastApplied 指纹撤销 | 指纹／matchKey 重定位／外部修改不覆盖的单测 | P1-04 |
| P1-06 档案命名空间（`ProfileRepository`） | 三态存取／版本迁移单测 | P0-01 |
| P1-07 工作台屏 A 骨架 + 双入口 | `slots` 注册形态校验 + `DraftStore` 状态机单测 | P1-02, P1-04 |
| P1-08 双机验证运行 | 0.2.0／0.2.1 实机探针 + P0-02 `echo` 往返 + J9 | 全部 |

## P2 — 正式 MVP（预置）：`previewWire` 双轨、`discovery` 接入、屏 B/C、`deepseek` 白名单启用、台账完整、双窗口 T1–T8 首轮人工。
## P3 — 推理增强（预置）：`verifySelected`、`RuntimePolicyAdapter`（自检+降级+`via`=agent/request）。
## P4 — 可选增强（预置）：`NativeFormBridge`、批量、导入导出、v2 来源。