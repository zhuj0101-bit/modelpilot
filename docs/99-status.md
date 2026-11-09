# ModelPilot 五阶段任务 — 一页总结

日期：2026-11-10。仓库：`G:\workspace_aiagent\dsh_worksapce\modelpilot\`（独立 git，首提交 `27c8f87`）。

## 已完成到哪个里程碑

**P0（SDK PoC）完成，48/48 测试全绿**；阶段 A–D 全部交付。

| 阶段 | 状态 | 交付物 |
| --- | --- | --- |
| A 补料验证 | ✅ U1–U6 全关闭 | docs/01-gap-fill.md。**U1 超预期**：@deepseek-ai 全系 npm 公开发布，20 个 tgz 精确版本补齐（原 zip 缺失的 ui-slots/typert 链/deepseek 全部升级为[已核对]） |
| B 并行设计 | ✅ 五路 subagent 全收 | docs/design-parts/B1–B5（合计 ~2000 行）+ ALIGNMENT-LEDGER（9 项对齐点裁决） |
| C 开发方案 | ✅ | docs/DESIGN-v2.md（定稿：架构/职责表/TS 类型/Remote 七接口/12 个集成点带版本标注/9 条 OQ 带保守默认） |
| D 执行计划 | ✅ | docs/PLAN.md（P0 五任务带判据，P1 八任务预置） |
| E 实施 | ✅ P0 | 仓库代码+测试，见下 |

## P0 实测结果（node --test，全绿）

| 任务 | 测试 | 关键产出 |
| --- | --- | --- |
| P0-01 脚手架 | 5/5 | package.json（peer `">=0.2.0-rc.2 <0.2.2-0"`，N7 实测选定）、cordis.patch.yml（id=modelpilot 恒定）、Config 四 volatile 数据线、client 占位 |
| P0-02 echo | 7/7 | ModelAssistantService（TypertRemoteService + 手动 marker 注册，SRC-mode 免 manifest——N1 简化）、caps 随握手下发、RemoteError 按 code 判别 |
| P0-03 mutate 集成 | 6/6 | **双版本源码逐字提取**（0.2.0 与 0.2.1 各自的 applyPathOp/isVolatilePath/SettingsConflictError 原文）跑 walker 矩阵 + 三类 op 模板 + 冲突/重试语义 |
| P0-04 双轨探测 | 6/6 | version-capabilities（length>=3 探测矩阵）+ VerifyTransport 双轨（configure 轨一次性/冻结断言；precheck 轨 UNSUPPORTED 透传；缺 runtime 显式降级） |
| P0-05 parser | 24/24 | models.dev v1 parser + F1–F20 fixture 矩阵 + 真实快照节选（llmtech）回归 |

**P0 出口判据**：结构校验（cordis.patch 单 insert/exports/peer 矩阵 semver 实测 0.2.0-rc.2✅ 0.2.1-rc.2✅ 0.2.2-rc.1❌）+ 单测全绿——按任务书许可的替代表达达成；实机 `dsh plugin add` 留 P1-08 双机验证。

## 过程中钉死的新事实（比计划多赚的）

1. **gateway SRC fallback**（N1）：resolveDescriptor 无 strict 定义时从 typertRemote 绑定反射生成 src-json 描述符——P0-02 无需 ./typert manifest，echo 两参方法即可路由。
2. **peer range 实测**（N7）：`^…||^…` 会放进 0.2.2-rc.1（不符合"不靠星号"原则），改用 `">=0.2.0-rc.2 <0.2.2-0"`。
3. **node assert.rejects 陷阱**：同步 throw 的 fn 不进 validator（必须包 async）——两个测试文件的教训，已写进代码注释。
4. **marker 注册零构建**：node22 无装饰器语法、protocol 的 mark() 未导出 → 同构复刻 mark()（REMOTE_METHOD_DESCRIPTOR v1 协议），remoteMethods() 读出的 wire 契约与 @Remote 完全一致。

## 剩余任务

- **P1（核心闭环）**：P1-01 五级链 → P1-08 双机实机验证（含 echo 真 RPC、J9 双版探测、slots 实挂）。P1-03 开工前需核证 B2-Q1/Q3/Q8 三个宿主行为。
- **P2**：previewWire、discovery 接入、屏 B/C、deepseek 白名单启用、双窗口 T1–T8。
- **P3/P4**：verifySelected 双轨实测、RuntimePolicyAdapter（可拒设计）、NativeFormBridge。

## Open Questions（详见 DESIGN-v2 §9，均有保守默认，无阻塞项）

Q1 client-face manifest（P0-02 实机判定）/ Q2 signal 注入 / Q3 configure({auto:false}) 双版签名 / Q4 deepseek 运行时 / Q5 投影三验（B2-Q1/Q3/Q8）/ Q6 ETag / Q7 深链导航 / Q8 agent/request 强制力 / Q9 ledger 容量。

## 下一步建议

跑 P1-01（IdentityResolver 单测，纯核心无宿主依赖），随后约一次实机窗口完成 P1-08（把 OQ1/2/3/Q3 一次性闭合）。
