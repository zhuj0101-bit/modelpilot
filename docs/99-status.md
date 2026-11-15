# ModelPilot 五阶段任务 — 一页总结

最后更新：2026-11-15。仓库：`zhuj0101-bit/modelpilot`（独立 `git`，首个提交 `27c8f87`）。
本页核对基线：`09c7f18`。

## 已完成到哪个里程碑

**P0（SDK 概念验证）完成，48/48 测试全绿**；阶段 A–D 全部交付。

**P1（核心闭环）代码完成、接线未完成**：领域层与工作台界面均已实现并有单测；
身份解析器、候选引擎、应用服务、三态档案仓库这四个模块尚未接入运行路径，
等待 P1-07（工作台屏 A 骨架 + 双入口）接线。

| 阶段 | 状态 | 交付物 |
| --- | --- | --- |
| A 补料验证 | ✅ U1–U6 全部关闭 | `docs/01-gap-fill.md`。**U1 超出预期**：`@deepseek-ai` 全系包已在 `npm` 公开发布，20 个 `tgz` 按精确版本补齐（原 `zip` 中缺失的 `ui-slots`／`typert` 链路／`deepseek` 全部升级为[已核对]） |
| B 并行设计 | ✅ 五路子代理全部回收 | `docs/design-parts/B1–B5`（合计约 2000 行）+ 对齐登记表（9 项对齐点裁决） |
| C 开发方案 | ✅ | `docs/DESIGN-v2.md`（定稿：架构／职责表／TS 类型／`Remote` 七个接口／12 个集成点带版本标注／9 条开放问题带保守默认） |
| D 执行计划 | ✅ | `docs/PLAN.md`（P0 五个任务带判据，P1 八个任务预置） |
| E 实施 | ✅ P0；P1 代码完成、接线未完成 | 仓库代码 + 测试，见下 |

## P1 现状：代码完成、接线未完成

`src/` 内没有任何运行路径引用下列四个模块——它们只被单测调用：

| 模块 | 职责 | 当前唯一调用方 |
| --- | --- | --- |
| `src/core/identity.js` | 身份解析器五级链（P1-01） | `test/core/identity.test.mjs` |
| `src/core/candidates.js` | 候选引擎八级字段合成（P1-02） | `test/core/candidates.test.mjs` |
| `src/core/apply-service.js` | 应用服务 prepare/commit、指纹撤销（P1-04/P1-05） | `test/apply/apply-service.test.mjs` |
| `src/core/profile-repository.js` | 三态用户档案仓库（P1-06） | `test/core/profile-repository.test.mjs` |

其余 `src/core` 模块（`pi-ai-projection`、`route-*`、`api-key`、`model-*`、
`domain`、`reasoning-wire` 等）由 `src/client/`（入口 `src/client/index.jsx`）
引用，构成当前对外可见的能力：
模型 / 路由的增删改查、密钥管理、连接测试、批量操作、分组视图。

## P0 实测结果（`node --test`，全绿）

| 任务 | 测试 | 关键产出 |
| --- | --- | --- |
| P0-01 脚手架 | 5/5 | `package.json`（对等依赖 `">=0.2.0-rc.2 <0.2.2-0"`，由 N7 实测选定）、`cordis.patch.yml`（`id=modelpilot` 恒定）、`Config` 四条易变数据线、`client` 占位 |
| P0-02 `echo` | 7/7 | `ModelAssistantService`（`TypertRemoteService` + 手动标记注册，源码模式免清单——N1 的简化）、能力集随握手下发、`RemoteError` 按错误码判别 |
| P0-03 `mutate` 集成 | 6/6 | **双版本源码逐字提取**（0.2.0 与 0.2.1 各自的 `applyPathOp`／`isVolatilePath`／`SettingsConflictError` 原文）跑路径遍历矩阵 + 三类操作模板 + 冲突／重试语义 |
| P0-04 双轨探测 | 6/6 | 版本能力（`length>=3` 探测矩阵）+ `VerifyTransport` 双轨（配置轨一次性／冻结断言；预检轨未支持码透传；缺运行时显式降级） |
| P0-05 解析器 | 24/24 | `models.dev` v1 解析器 + F1–F20 `fixture` 矩阵 + 真实快照节选（`llmtech`）回归 |

**P0 出口判据**：结构校验（`cordis.patch` 单条 `insert`／`exports`／对等依赖矩阵语义化版本实测 0.2.0-rc.2✅ 0.2.1-rc.2✅ 0.2.2-rc.1❌）+ 单测全绿——按任务书许可的替代表达达成；实机 `dsh plugin add` 留到 P1-08 双机验证。

## 过程中钉死的新事实（比计划多赚的）

1. **`gateway` 的源码回退**（N1）：`resolveDescriptor` 找不到严格定义时，从 `typertRemote` 绑定反射生成源码 JSON 描述符——P0-02 无需 `./typert` 清单，`echo` 两参方法即可路由。
2. **对等依赖范围实测**（N7）：`^…||^…` 会把 0.2.2-rc.1 一起放进来（不符合"不靠星号"的原则），改用 `">=0.2.0-rc.2 <0.2.2-0"`。
3. **`node` `assert.rejects` 陷阱**：同步抛出的函数进不了校验器（必须包成 `async`）——两个测试文件的教训，已写进代码注释。
4. **标记注册零构建**：node22 无装饰器语法、`protocol` 的 `mark()` 未导出 → 同构复刻 `mark()`（`REMOTE_METHOD_DESCRIPTOR` v1 协议），`remoteMethods()` 读出的线上契约与 `@Remote` 完全一致。

## 测试现状

`node --test "test/**/*.test.mjs"` 在本页基线 `09c7f18` 上实测 **820 个测试：
813 pass / 0 fail / 7 skipped**；加入本单新增的结构测试后为 **821 个：
814 pass / 0 fail / 7 skipped**。

7 个 skipped 不是失败，全部是环境门禁：

- 6 个来自版本矩阵 `test/apply/mutate.integration.test.mjs`：`0.2.0-rc.2` / `0.2.1-rc.2`
  两列依赖仓库外的补充包树 `../modelpilot-tmp-npm/extracted/dsh-settings`，
  该目录不存在时跳过；`live` 列照常读取正在运行的宿主安装。
- 1 个来自 `test/client/model-list-grouping.test.mjs` 的 dark 主题密度偏好用例
  （light 主题已覆盖同一存储读取）。

> 工单 #36 原文把 7 个 skipped 记为 `test/host/remote-bind.test.mjs` 的版本矩阵门禁；
> 实测该文件没有跳过用例，真实来源如上。工单里的 790 / 783 / 7 是更早基线
> `1e53d7c` 的数字，`#74`、`#75` 合入后总数为 820。

## 剩余任务

- **P1-07 工作台接线**：把 `identity` / `candidates` / `apply-service` /
  `profile-repository` 接入工作台（屏 A 骨架 + 双入口）；接线后同步从
  `test/structure.test.mjs` 的未接线白名单删除对应条目。
- **P1-08 双机验证运行**：0.2.0 / 0.2.1 实机探针 + P0-02 `echo` 往返 + J9 双版探测 + `slots` 实挂。

## 开放问题（详见 DESIGN-v2 §9，均有保守默认，无阻塞项）

Q1 `client` 面清单（P0-02 实机判定）／ Q2 `signal` 注入 ／ Q3 `configure({auto:false})` 双版签名 ／ Q4 `deepseek` 运行时 ／ Q5 投影三验（B2-Q1／Q3／Q8）／ Q6 ETag ／ Q7 深链导航 ／ Q8 agent/request 强制力 ／ Q9 台账容量。

## 下一步建议

先做 P1-07 接线，再约一次实机窗口完成 P1-08（把 OQ1／2／3／Q3 一次性闭合）。
