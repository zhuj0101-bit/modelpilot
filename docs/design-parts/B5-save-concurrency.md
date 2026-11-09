# B5 — 保存与并发（ApplyService / planId / lastApplied / 冲突矩阵 / 双窗口并发）

ModelPilot 设计章节。落盘日期：2026-11-10。
证据标签沿用 dsh-compat-audit / 01-gap-fill 规则：`[已核对-源码]`（两版逐字/同构核对）、`[设计定案]`（本设计章节内拍板）、`[待验证]`（需运行时验证）、`[约束-来自B1/B2/U5]`（跨章节约束承接）。

## 0. 事实基线与承接（本章节全部推演的前提）

以下事实为输入，不是本文的产物；所有设计均建立在其上：

- **settings 写语义**（两版逐字一致）`[已核对-源码]`：
  `mutate(ns, ops, expectedRevision)`；数组下标一律 `String(i)`；`set` 支持深字段 / `unset` 删行 / 下标 `== length` 追加整行；volatile 级联（pi-ai 的 `providers` 节点 volatile → `providers.<id>.models.<String(i)>.<field>` 全部合法可写）；冲突抛 `SettingsConflictError(code=SETTINGS_CONFLICT, expected/actual)`。revision 由 `describe()` 维护，**任何写（含他人写入）都会递增 revision**。
- **原生 Editor 保存形态** `[已核对-源码]`：`pathOps(base, before, after)` 计算**最小 set/unset 集** + `expectedRevision` state + `writeSettings → ctx.remote.settings.mutate`。这是宿主自身的并发纪律，ModelPilot 必须对齐而非绕开。
- **selectModel 双副作用**（两版一致）`[已核对-源码]`：会话级"下一请求生效" + 后台 `saveSelection` 持久化 DSH 默认（失败仅告警、返回**不等待**）→ 普通「保存并应用」**绝不调用它**；显式「并选为当前模型」才调用且如实披露。
- **models 数组非空 = 整体替换路由目录**（`resolveRouteModels` 两版一致）`[已核对-源码]`：对 catalog 路由追加未知 ID 会让**目录内其他模型从该路由消失** → 必须警告。
- `modelOverrides` 与 `models` 互斥、只收已安装目录内 ID `[已核对-源码]`。
- **maxTokens 双重身份** `[已核对-源码]`：条目值会被物化为缺省请求预算 → 写 `maxTokens=4096` 会改宿主工作输出限制材料；必须三值展示与确认。
- **宿主广播** `[已核对-源码]`：`settings/document-updated` 事件（settings-models 页收到即刷新快照）→ **双窗口并发是真实场景**，不是理论边界。
- `[约束-来自B1]` B1 SettingsWriter：`describe()` 读 revision、ops 组装、围栏、SETTINGS_CONFLICT 重试一次、**写链串行队列**、ledger 日志。
- `[约束-来自B2]` B2 ProjectionResult：`settingsOps / appliedFields / profileOnlyFields / unsupportedControls` 与字段白名单。
- `[约束-来自U5]` agent/request 通道（P3+）按"可能被拒绝/可能不触发"设计，自检探测 + 降级 + `ledger(via=agent/request)`；首版（P0–P2）不实现，数据结构仅预留 `scope` 字段。

---

## 1. ApplyService：prepare / commit 全流程 `[设计定案]`

ApplyService 是「保存并应用」按钮背后的唯一编排者。它不直接碰 `ctx.remote.settings`，一切写走 B1 SettingsWriter；一切 ops 内容来自 B2 ProjectionResult。职责边界：

```
UI(表单/确认对话框)
   │ ApplyInput { planId?, desiredProfileVersion, routeId?, entries[] }
   ▼
ApplyService ── prepare() ──► ApplyPlan（含 diff 预览、风险标记、planId）
   │  用户确认（或自动确认：无风险项）
   ▼
ApplyService ── commit(plan) ──► 两 namespace 分项状态
```

### 1.1 prepare()

输入：`ApplyInput`（来自 UI 投影层 B2 的 `ProjectionResult` + 用户当前表单值）。

步骤（顺序即实现顺序）：

1. **读自有 ns + 目标 ns revision**：对两个 namespace 各调一次 `describe()`，取得 `{revision, snapshot}`。自有 ns（`modelpilot` profile）与目标 ns（pi-ai/deepseek 宿主配置）**分两次 describe，各自记 revision**。两个 revision 都进 ApplyPlan，供 commit 分别以 `expectedRevision` 提交。
2. **按 route/model 定位**：将 ApplyInput 中的路由/条目映射到目标 ns 的具体路径：
   - pi-ai：`providers.<id>.models.<String(i)>.<field>`（volatile 级联保证合法）`[已核对-源码]`；
   - deepseek：路由级 `models[]` 行 + `reasoningEffort` `[已核对-源码]`；
   - 定位失败（provider 不存在、条目下标越界且非"追加"意图）→ prepare 失败，错误**直达 UI**，不进 commit。
3. **验证 ProjectionResult**：`unsupportedControls` 非空 → 这些字段被剔除出 ops 且在 plan 中标注 `profileOnly`（只进档案，不写宿主）；`appliedFields` 与 `profileOnlyFields` 分账。
4. **白名单 ops**：仅 B2 字段白名单内的字段生成 ops；白名单外字段即使表单里有值也**静默降级为 profile-only**（UI 已由 B2 标注 unsupported，这里兜底）。
5. **diff**：以 `pathOps(base=目标 ns 当前快照, before, after)` 语义（与原生 Editor 同构 `[已核对-源码]`）生成最小 set/unset 集。diff 结果存进 ApplyPlan，UI 的确认对话框直接展示这份 diff（含 maxTokens 三值行，见 §3.4）。
6. **planId 生成**：见 §2。prepare 每次都生成新 planId（幂等键绑定 desiredProfileVersion，不是绑定按钮点击）。

prepare 产物 `ApplyPlan`：

```ts
interface ApplyPlan {
  planId: string;                       // 见 §2
  desiredProfileVersion: string;        // 档案版本，幂等绑定
  nsTargets: Array<{ ns: string; expectedRevision: number }>;
  ops: Array<{ ns: string; op: "set"|"unset"|"insert"; path: string; value?: unknown }>;
  diff: DiffRow[];                      // UI 确认用
  risks: RiskFlag[];                    // catalog替换/maxTokens三值 等
  appliedFields: string[];              // 将写宿主
  profileOnlyFields: string[];          // 只进档案
}
```

### 1.2 commit(plan)

commit 是**两 namespace 的非原子序列**，任何一步都可能成功/失败，因此返回分项状态而不是总体布尔：

```ts
interface CommitResult {
  planId: string;
  profile: StepState;    // 档案 ns
  host: StepState;       // 宿主 ns
  overall: "applied" | "profileOnly" | "failed";
}
interface StepState {
  status: "ok" | "skipped" | "failed";
  error?: string;        // SETTINGS_CONFLICT / 其他
}
```

顺序固定为 **①档案 → ②宿主**：

1. **① 存档案（desired/pending）**：把 desired（本次表单完整意图）与 pending（待应用 diff）写入自有 ns。自有 ns 是 ModelPilot 自己的 namespace，`expectedRevision` 用步骤 1.1-1 读到的值；自有 ns 冲突概率极低（只有自己写），但仍按 §4 矩阵处理。档案写入**先行**的原因：即使宿主写失败，"档案已保存，DSH 未应用"是可恢复状态（见步骤 4）。
2. **② 宿主最小 patch**：经 B1 SettingsWriter 写链提交 `ops(宿主 ns)` + `expectedRevision = plan.nsTargets[宿主].revision`。SettingsWriter 内部含围栏与 SETTINGS_CONFLICT 重试一次 `[约束-来自B1]`。
3. **③ 成功：记 lastApplied**：按 §3 生成字段值指纹 + 目标 revision + 逆向 patch，写入档案 ns 的 `lastApplied` 节点（与 desired 同批写，或紧随其后单独写，见 §2.4 提交结果绑定）。
4. **④ 失败：保留档案，显示"档案已保存，DSH 未应用"**：宿主步失败（冲突重试后仍失败、或写链围栏拒绝）时，**不回滚档案**。UI 呈现三段：档案状态 = 已保存；宿主状态 = 未应用 + 失败原因；提供「重试应用」（复用同一 planId，见 §2.3）与「放弃」（清 pending）。**绝不静默把失败显示成成功**。

### 1.3 非原子的用户语义 `[设计定案]`

- 档案成功 + 宿主成功 → `applied`："已保存并应用"。
- 档案成功 + 宿主失败 → `profileOnly`："档案已保存，DSH 未应用"（显式文案，不淡化为"部分成功"）。
- 档案失败（自有 ns 冲突且重试后仍失败）→ 不继续写宿主（`host.status=skipped`），整体 `failed`；因为档案是撤销与审计的锚点，没有档案的宿主写入不可逆追踪。

---

## 2. planId 幂等设计 `[设计定案]`

### 2.1 生成规则

```
planId = "plan-" + sha256(canonical(ops) + ":" + desiredProfileVersion + ":" + createdAtMs)
```

- `canonical(ops)`：ops 数组按 path 排序后 JSON 序列化（value 经稳定序列化），保证同 diff → 同前缀。
- `desiredProfileVersion` 参与哈希：**planId 绑定档案版本**。同一档案版本重复 prepare 出同一 planId（时间戳除外——见下），跨版本必不同。
- `createdAtMs` 只进 plan 记录、**不进 planId**：同一 desired 在一秒内重复 prepare 不产生新幂等键的歧义。若需要区分"同内容两次提交"，用 `attempt` 序号（planId 不变，ledger 里 `attempt++`）。

### 2.2 重复点击不追加重复模型行

场景：用户在确认对话框连点两次「保存并应用」，或双窗口各打开同一档案各点一次。

机制（四层防御）：

1. **UI 层**：确认对话框在 commit 进行中禁用按钮（in-flight 锁）。这挡住绝大多数，但**不作为正确性依赖**（双窗口场景 UI 锁无效）。
2. **ApplyService 内存层**：进程内 `inFlightPlanIds: Set<planId>`，同 planId 未决时第二次 commit 直接复用第一次的 Promise（去重合并）。
3. **diff 层（正确性核心）**：append 操作（`insert` at `index==length` `[已核对-源码]`）在 prepare 的 diff 阶段以**当前快照**计算。若第一次提交已把条目写入，第二次 prepare 时该条目已在快照中 → diff 为空 → 无 insert op。即使两次 prepare 都基于旧快照拿到了 insert op，第二次 commit 会因 `expectedRevision` 失配（第一次提交使 revision 递增）走 §4 冲突矩阵：重读快照 → 重 diff → insert 消失 → ops 变空 → 结果"无变更可应用"，**不产生重复行**。
4. **终态防御**：commit 前对 `insert` 目标行做存在性复查（path 在当前快照中已存在且值全等 → 丢弃该 op 并在 ledger 记 `dedup`）。

### 2.3 旧提交结果不覆盖新 desired

规则：**提交结果（lastApplied / pending 状态）只允许写回"与提交时 planId 匹配且 desiredProfileVersion 未被替换"的档案节点**。

- 档案 ns 的 desired 节点带 `desiredProfileVersion`；commit 成功回写 lastApplied 前，重读 desired 节点校验版本仍等于 `plan.desiredProfileVersion`。若用户在 commit 期间又改了表单/换了档案版本（desired 已更新），本次 lastApplied **不回写**到新 desired 上，只记录到 ledger；UI 提示"你的新修改未受本次应用影响，请重新应用"。
- 异步回写（如 saveSelection 类后台持久化）同样携带 planId，写回前校验。

### 2.4 提交结果与 plan 绑定校验

- `lastApplied.planId` 与 `pending.planId` 必须一致才允许把 pending 转 applied。
- 「重试应用」只对 `pending.planId` 存在的档案有效；重试前重跑 prepare（基于新快照重 diff，planId 因内容变化可能改变）——**重试不是重放旧 ops**，是"重新计算后应用"，因此永远安全。

---

## 3. lastApplied 字段指纹 `[设计定案]`

### 3.1 指纹算法

```
fingerprint(path) = sha256( path + ":" + canonicalValue(currentValue) )
```

- `path`：目标 ns 中的完整路径，如 `providers.pi-ai-x.models.2.maxTokens`。
- `canonicalValue`：值规范化后稳定序列化——
  - 数值：统一 Number 形态（`4096` 与 `"4096"` 若语义为数值则规范化为数值形态再哈希；类型由白名单 schema 决定）；
  - 数组：逐元素规范化后 JSON；
  - 对象：键排序；
  - undefined/null：区分保留（unset 后的"行已删"与"值空"是不同状态）。
- lastApplied 记录结构：

```ts
interface LastApplied {
  planId: string;
  ns: string;
  appliedRevision: number;            // 宿主写成功后的 revision（由 commit 后 describe 刷新，见 3.5）
  fields: Array<{
    path: string;
    fingerprint: string;              // 应用了什么值
    inverseOp: { op: "set"|"unset"; path: string; value?: unknown };  // 逆向 patch 单元
  }>;
  createdAt: number;
}
```

### 3.2 逆向 patch 生成规则

逆向 = "把我写过的字段恢复到写入前"。逐字段生成，规则：

1. prepare 阶段为每个**将被写入**的 path 记录 `before`（当前快照值）。
2. 逆向 op 判定：
   - `before` 存在 → 逆向为 `set`（恢复旧值）；
   - `before` 不存在（字段/行为本次新增）→ 逆向为 `unset`（删除该字段/行）；若本次是 `insert` 整行（数组追加），逆向为对 `models.<String(i)>` 整行 `unset`（删行）`[已核对-源码]`（unset 删行语义）。
3. **unset 新增行的下标回填问题**：若本次 insert 之后宿主快照上该数组又有他方追加，行下标会漂移。逆向生成**不在 commit 时定死**，而是在「撤销」动作触发时基于 lastApplied 的 `fields[].path` 与**当前快照**重新定位（按行内容/模型 ID 匹配），定位不到 → 该字段标记 `lost`，撤销对它跳过并如实报告。因此 lastApplied 里另存每行的 `matchKey`（如模型 `id`）作为重定位依据。

### 3.3 字段级撤销条件

撤销（「撤销上次应用」按钮）逐字段判定：

```
currentValue = 当前快照中 path 的值
if fingerprint(currentValue) == lastApplied.fields[path].fingerprint
    → 该字段可回滚：执行 inverseOp
else
    → 冲突：该字段跳过，UI 列出"当前值 ≠ 应用值，已被外部修改"，不覆盖
```

- 这是**字段级**的：一次应用中 5 个字段可能 3 个回滚、2 个冲突展示。
- 全部字段都冲突 → 撤销整体显示"无可撤销字段（均已外部修改）"，不执行任何写。
- 撤销本身也是一次 commit（走 ApplyService、有 planId、写档案、进 ledger），撤销后 lastApplied 转为 `revoked` 态保留记录（不清空），保证审计连续。

### 3.4 maxTokens 三值确认 `[已核对-源码]`

maxTokens 双重身份（条目值会被物化为缺省请求预算，写 `maxTokens=4096` 会改宿主工作输出限制材料）→ ApplyPlan 的 diff 中该字段必须展示三值并要求显式确认：

| 展示位 | 含义 |
| --- | --- |
| 档案值 | 用户在 ModelPilot 表单中设置的期望值 |
| 宿主当前值 | prepare 时快照中的现值（before） |
| 应用后值 | 本次写入将产生的值（after）= 缺省请求预算的新材料 |

未勾选「我理解 maxTokens 将改变宿主请求预算」→ 该字段从 ops 剔除，降级 profile-only；planId 随 ops 变化重新计算（§2.1）。撤销时 maxTokens 与其他字段同等指纹保护（外部手工改过就不覆盖）。

### 3.5 appliedRevision 的获取

宿主 mutate 成功返回后，commit 追加一次宿主 ns `describe()` 取新 revision 作为 `appliedRevision`。这次 describe **只读不重试**；失败则 `appliedRevision = expectedRevision + 1`（写成功必然 +1 `[已核对-源码]`：任何写都递增）并标注 `approx: true`。

---

## 4. 冲突处理矩阵 `[设计定案]`

### 4.1 SETTINGS_CONFLICT 主矩阵

`SettingsConflictError(code=SETTINGS_CONFLICT, expected/actual)` `[已核对-源码]`。处理链（与 B1 SettingsWriter 的"重试一次"衔接）：

| 步骤 | 动作 | 判定 |
| --- | --- | --- |
| 1 | 重读目标 ns `describe()` | 取 actual revision + 新快照 |
| 2 | 按 ID 重定位 | 行/条目按 `matchKey`（模型 id、provider id、路由 id）在**新快照**中重新找路径。原下标可能已被他方插入/删除而漂移 |
| 3 | touched 重 diff | 仅对本次 plan 的 touched 集合（将被写的 path）在新快照上重算 diff |
| 4 | 重 diff 为空 | → 本次提交实质已完成（他人写入恰好等于我们想要的），结果 = `applied(no-op)`，记 ledger `resolved=converged` |
| 5 | 重 diff 非空且语义不变 | → 用新 revision + 新路径**重试一次**（有限重试：全程最多一次自动重试 `[约束-来自B1]`） |
| 6 | 重 diff 语义变化 | → 停止自动重试，转人工：UI 显示三列（我的意图 / 现在的值 / 差异），提供「以我的为准重新应用」「放弃」「查看差异」 |
| 7 | 重试后仍冲突 | → 同步骤 6 人工路径；**禁止**无限重试循环（修订竞争的礼貌做法是让人看一眼） |

- "语义变化"判定：touched path 的 before 值在旧/新快照间不同，且新值 ≠ 我们要写的值 → 别人改了同一字段，必须人工。
- 数组同下标并发追加（经典漂移）：双方都在 `index==length` insert。后提交者 expectedRevision 失配 → 重读 → 重定位发现目标行已存在（2.2 终态防御）或需要的新下标后移 → 重 diff 产出正确新下标 → 重试成功。**同内容追加自然收敛（步骤 4），不同内容追加各自落到不同下标，双双成功**——这是 volatile 数组 + revision 检查组合给出的正确性，无需应用层加锁 `[设计定案]`。

### 4.2 写链串行队列与双窗口场景的关系 `[约束-来自B1]` `[设计定案]`

- B1 的写链串行队列作用域 = **本进程内**（同一渲染端的所有 ApplyService/SettingsWriter 调用串行）。它消灭同窗口的交错写，但**对另一窗口不可见**。
- 因此双窗口并发完全依赖 `expectedRevision` CAS：每窗口各自 describe → 各自 mutate → 失败方走 §4.1 矩阵。串行队列**不替代** revision 检查，它只是让单窗口内的失败概率下降、日志有序。
- 队列与重试的关系：冲突重试的"重读+重diff+重提"整体作为**一个队列任务**入队，不允许重试中间被同窗口其他写插队（否则自己制造自己失败）。

### 4.3 "外部手工值默认保护"的落地

原则：**指纹不匹配 = 外部改过 = 不自动刷新，除非来源明确或持有锁。**

- 落地点有三处，全部复用 §3.3 指纹比较：
  1. **撤销**：字段级条件已定（§3.3）——外部值永不覆盖。
  2. **档案回显**：表单打开时若档案 desired 与宿主现值指纹不一致，UI 显示"宿主当前值已被外部修改"，**三值并陈**（档案期望/宿主现值/将写入值），不自动把宿主值覆盖回档案值，也不静默把宿主值吸收进档案。吸收（"以宿主为准更新档案"）必须是显式按钮。
  3. **自动同步/轮询类功能（P2+）**：任何"自动把档案应用回宿主"的自动化，前置条件 = 指纹全部匹配；存在不匹配字段 → 自动化降级为"提示 + 人工确认"，并在 ledger 记 `blockedBy=fingerprintMismatch`。
- 例外通道（明确来源/锁）：仅两个——(a) 用户在该次交互中刚看过三值确认（§3.4 级别的显式确认算"明确来源"）；(b) P3+ 的 agent/request 通道自带 `via` 标记与自检探测 `[约束-来自U5]`，其自动化写同样受指纹门禁，首版不实现。

---

## 5. catalog 路由替换警告（P1-1 判据）`[已核对-源码]` `[设计定案]`

### 5.1 判据

`resolveRouteModels` 两版一致：`models` 数组**非空 = 整体替换**该路由的目录。

P1-1 触发条件（prepare 阶段 diff 后检测）：

```
目标路由已有"已安装目录"模型（宿主目录 catalog 在该路由下非空）
且 本次 plan 对该路由的 models 写入是"非空数组"
且 新数组中存在 宿主目录中不存在 的未知 ID（既不在目录 catalog、也不是路由现有行）
```

### 5.2 阻断确认对话框

满足判据 → **硬阻断**：不进入 commit，先出对话框。内容必须列明：

1. 路由 ID 与"整体替换"语义的原文警示（对 catalog 路由追加未知 ID 会让目录内其他模型从该路由消失）；
2. **将被移除的目录模型清单**：`当前路由 catalog ∪ 现有 models 行 - 新数组` 的差集，逐个列模型名；
3. 将新增的未知 ID 清单（供用户核对拼写——常见事故是 ID 拼错导致"消失了一堆"）；
4. 三个出口：
   - 「取消」（回表单）；
   - 「仍要替换」（强制继续，见 5.3）；
   - 「改为追加到 overrides」（若 `models`/`modelOverrides` 互斥约束允许此路径 `[已核对-源码]`，把未知 ID 改走 modelOverrides 而不动 models——UI 侧可选出口，仅当目标 ID 均在已安装目录内时可用）。

### 5.3 跨警告的强制继续路径

- 「仍要替换」需要**第二次交互**（先在对话框勾选"我理解以下模型将从该路由移除：<清单>"，按钮才激活）——与 maxTokens 确认同构。
- 确认结果记入 plan（`riskAcknowledged: ["catalog-replace"]`）与 ledger（`ack=catalog-replace`）。planId 不因确认改变（ops 未变）；但**若用户在对话框期间回到表单改了任何东西，prepare 重跑、确认作废**（确认绑定 planId）。
- 强制继续后的 commit 流程不变（含指纹/lastApplied），因此「撤销上次应用」可以整体撤销这次替换——这是强制路径的安全网，对话框中注明。

---

## 6. selectModel 集成纪律 `[已核对-源码]` `[设计定案]`

### 6.1 两动作的 UI-服务契约

| 动作 | UI 文案 | 调用 | 副作用契约 |
| --- | --- | --- | --- |
| 普通「保存并应用」 | "保存并应用" | ApplyService.prepare/commit（§1） | **绝不调用 selectModel**。只写 settings，不触碰会话级下一请求，不改 DSH 默认 |
| 显式「并选为当前模型」 | "保存并应用，并设为当前模型" | commit 完成后追加调用 selectModel | 两个副作用都如实披露（见 6.2） |

- 服务签名：`applyWithSelection(input) → { commit: CommitResult; selection: SelectionState }`；普通保存走 `apply(input) → CommitResult`。两条入口在 UI 上是**两个按钮**，不是同一按钮的隐式行为。
- 披露文案固定：调用 selectModel 即提示"将影响：① 当前会话的下一个请求；② DSH 默认模型设置（后台保存）"。

### 6.2 并选失败三态（如实显示）

`saveSelection` 失败仅告警、返回不等待 `[已核对-源码]` → UI **必须**区分三态，禁止合并成单一"失败"或单一"成功"：

| 态 | 判定 | 显示 |
| --- | --- | --- |
| ① 会话选择失败 | selectModel 前置/会话级调用抛错 | "已保存并应用到 DSH；当前会话模型切换失败：<原因>" |
| ② 默认保存未知/失败 | 会话级成功，但 saveSelection 回执失败或超时（不等待语义下以告警事件回执） | "已保存并应用；会话已切换；DSH 默认模型的保存结果未确认/失败（后台告警已记录）" |
| ③ 两者皆成 | 全部成功回执 | "已保存并应用，且已设为当前模型（含 DSH 默认）" |

- 实现：selection 三态是 selectModel 的返回/事件重组，**不混入** CommitResult（commit 的成败独立于并选成败）。ledger 分别记录 `op=settings.write` 与 `op=selectModel, result=…`。
- ①② 发生时提供「重试仅切换/重试保存默认」的最小重试入口（不重跑 commit）。

---

## 7. 双窗口并发测试方案（同实例双标签）`[待验证]` `[设计定案]`

前置：同 DSH 实例开两个窗口（A/B）均打开 ModelPilot settings 页。断言基线：收到 `settings/document-updated` 事件后**重读 describe()** 校验 revision 与内容 `[已核对-源码]`（事件只当"脏信号"，不当数据源）。

### 7.1 场景表

| # | 场景 | 操作序列 | 预期行为 | 断言方法 |
| --- | --- | --- | --- | --- |
| T1 | A 读 → B 写 → A 提交 | A 打开表单（describe r=N）；B 完成一次保存（r=N+1）；A 不刷新直接提交 | A 收 SETTINGS_CONFLICT → 矩阵 §4.1：重读/重定位/重diff → 自动重试一次成功（若 touched 无交集且 diff 仍有效）或转人工三列 | A 的 ledger 出现 `conflict → resolved` 或 `conflict → manual`；`document-updated` 后 A 重读，B 的字段值保持，A 的意图字段落盘；revision 单调 |
| T2 | 同 ns 并发 mutate | A、B 在**同一**目标 ns 各自基于 r=N 提交不同字段的 ops | 恰一方成功，另一方走矩阵重试成功（无交集场景），最终两方字段都在 | 两次 `document-updated` 后各窗口 describe：双方字段值均正确；无字段丢失；A/B ledger 均有一条成功（其中一条含 resolved=retry） |
| T3 | 数组同下标并发追加 | A、B 各基于 r=N 向同一路由 `models[]` 追加**不同**模型行（都走 insert at length） | 后提交者冲突 → 重定位 → 重 diff 到新下标 → 重试成功；两行都存在，下标 0/1 顺序合法（String(i) 路径）`[已核对-源码]` | describe 数组长度 +2；两行内容分别等于 A/B 意图；路径均为 `models.<String(i)>` 形态；无行被覆盖 |
| T3b | 数组同下标并发追加（同内容） | A、B 追加**相同**模型行 | 后者重 diff 为空 → `applied(no-op)` 收敛 | 数组长度 +1（不是 +2）；后者 ledger `resolved=converged`；UI 显示"已被另一窗口应用" |
| T4 | 档案 ns 与宿主 ns 交叉失败 | A：档案 ns 预置冲突（构造方法：直接用宿主原生 Editor 写 A 的自有 ns 一次使 A 的 expectedRevision 过期），然后 A 提交完整保存 | 档案步失败 → host.status=skipped（§1.3）→ 整体 failed；宿主无任何写入 | 宿主 ns describe revision 不变；A UI 显示"档案已保存失败/未应用"且无「重试应用」直达（需先解决档案冲突）；ledger 有 `ns=<自有>, result=conflict` 与 `op=skipped` |
| T4b | 档案成、宿主败 | B 在 A commit 的两步之间抢先写宿主 ns（手工用原生 Editor） | 档案已存 + 宿主 SETTINGS_CONFLICT → 矩阵重试一次 → 仍冲突转人工；UI 显式"档案已保存，DSH 未应用" | 自有 ns 出现 desired+pending；宿主值未被 A 改动；A 点「重试应用」后按新快照重 diff 成功；lastApplied 生成且 planId 与 pending 一致 |
| T5 | 双窗口各存同一档案（幂等） | A、B 同时对同一 desiredProfileVersion 点「保存并应用」 | 去重合并或第二次收敛为 no-op；**不追加重复模型行**（§2.2 四层防御生效） | models 行数仅 +1；两窗口 ledger planId 相同（或第二条 `resolved=converged`）；无重复行 |
| T6 | 撤销遇外部修改 | A 应用成功后，B 手工改掉其中 2 个字段；A 点「撤销上次应用」 | 仅指纹匹配的 3 个字段回滚；2 个字段列冲突不覆盖 | describe：3 字段恢复 before、2 字段保持 B 的值；lastApplied 转 revoked；ledger 逐字段记录 rolledBack/conflictSkipped |
| T7 | catalog 替换阻断（跨窗口） | A 准备对 catalog 路由追加未知 ID；B 先向该路由 models 写入了另一未知 ID | A prepare 时以**当前**快照判据（§5.1），将 B 已写入的未知 ID 一并列入"将被移除"清单（因为它也是目录外的现存行→差集包含它）| 对话框清单含 B 的 ID；确认后 catalog 中原目录模型确实从该路由消失（复现宿主语义）；ledger `ack=catalog-replace` |
| T8 | document-updated 风暴 | B 连续 5 次快速保存 | A 每次收到事件后防抖重读（合并为最多 1–2 次 describe），最终快照 = 第 5 次结果 | A 的重读次数 ≤ 2；最终 describe 与 B 最后一次写入一致 |

### 7.2 断言通用方法

1. 一切断言以「`document-updated` 事件后重读 describe()」为准，禁止基于事件负载内容断言（事件只广播"变了"）。
2. revision 严格单调递增且每窗口每次成功 mutate 恰 +1 `[已核对-源码]`。
3. ledger 完整性：每个场景结束后导出 ledger，核对事件数 = 预期写操作数 + 冲突/重试/跳过记录，`before/after` 与 describe 重读值一致。
4. 自动化形态：T1–T8 各为一个可重放脚本（注入受控 describe/mutate 序列或双驱动双窗口），`[待验证]` 首轮人工执行，P2 转自动化。

---

## 8. ledger 设计 `[设计定案]`

### 8.1 事件 schema

```ts
interface LedgerEvent {
  ts: number;               // epoch ms
  planId: string;           // 幂等/关联键；无 plan 的读操作可空
  ns: string;               // "modelpilot"（自有）或目标 ns id
  op: "set"|"unset"|"insert"|"selectModel"|"skipped"|"ack"|"conflict"|"retry"|"converge";
  path?: string;            // 字段/行路径（op 级事件必填；批次级可空）
  before?: unknown;         // 规范化前值（与指纹的 canonicalValue 同一规范化）
  after?: unknown;          // 规范化后值
  via: "ui"|"agent/request"; // U5 预留：首版恒为 "ui" [约束-来自U5]
  result: "ok"|"conflict"|"failed"|"skipped"|"converged";
  meta?: {                  // 扩展位
    attempt?: number;       // 冲突重试次数
    reason?: string;        // failed/skipped 原因
    ack?: string;           // "catalog-replace" 等用户确认标记
    matchKey?: string;      // 重定位键（模型 id 等）
  };
}
```

### 8.2 记录纪律

- **失败也记录**：conflict/failed/skipped 均落事件；一个 commit 至少产生：1 批次事件（per ns）+ 每 op 一条明细 + 冲突时 retry/conflict 事件。`selectModel` 独立事件（§6.2 三态可由 ledger 重建）。
- **before/after 用规范化值**：与指纹 canonicalValue 同一规范化，保证"指纹不匹配"的判定可用 ledger 复核。
- **只追加不改写**：撤销不清除旧事件，追加 `op=…` 与 revoked 标记；审计连续性优先。
- 落盘位置：自有 ns 的 `ledger` 节点（随档案走，享受同一 revision/冲突纪律）+ 导出为 JSONL 文件（§8.3）。节点容量：滚动窗口保留最近 N=500 条，滚动截断时在头部写 `truncatedAt` 标记 `[设计定案]`。
- `via` 字段首版恒 `"ui"`；P3+ agent/request 通道实现时按 U5 要求带 `via="agent/request"` 与自检探测结果 `[约束-来自U5]`。

### 8.3 导出

- 「导出诊断」按钮 → JSONL（一行一事件，字段序稳定）+ 头部 meta 行（导出时间、DSH 版本、插件版本、planId 索引）。
- 导出不含凭据/密钥类值：`before/after` 若路径命中凭据白名单（如 `apiKey` 类字段，投影层本就不写它们 `[已核对-源码]`），导出时值替换为 `"<redacted>"`——双保险：路径黑名单 + 值形态检测（长随机串）。

---

## 9. Open Questions（开放式问题）

| # | 问题 | 当前倾向 |
| --- | --- | --- |
| OQ-1 | 档案 ns 与宿主 ns 两步之间是否需要"预占"机制（先在档案写 pending 后立即获得一个租约）？ | 倾向否：revision CAS 已覆盖正确性，租约增加复杂度且跨窗口无强制力。保守默认：无租约，靠 §2/§4 防御 |
| OQ-2 | `appliedRevision` 用 describe 刷新失败时 `approx: true` 是否足以支撑撤销定位？ | 撤销本就不依赖 revision（按指纹+matchKey），approx 只影响展示。保守默认：保留 approx 标注 |
| OQ-3 | ledger 滚动窗口 N=500 是否足够覆盖一次复杂会话的审计？ | 待 T1–T8 实测事件量再定；保守默认 500，导出先行（导出即完整留存） |
| OQ-4 | 三列人工冲突 UI（§4.1 步骤 6）是否需要"逐字段选择以谁为准"？ | P1 只做整体"以我的为准/放弃"，逐字段选择留 P2（依赖指纹粒度已具备，纯 UI 工作） |
| OQ-5 | 「改为追加到 overrides」出口（§5.2）在两版互斥语义下的边界确认（已有 overrides 时路由行为） | 需在 B2/B4 章节对齐互斥判据后再定；首版若判据不充分则只留「取消/仍要替换」两出口 |

## 保守默认汇总

1. 两 namespace **非原子、分项状态**，档案先行；档案失败则宿主 skipped。
2. 幂等靠 **planId + expectedRevision CAS + 终态存在性复查**，不靠 UI 锁；同内容追加收敛为 no-op。
3. 撤销与自动同步一律**指纹门禁**：不匹配 = 外部改过 = 不覆盖，除非显式三值确认。
4. SETTINGS_CONFLICT 自动重试**全程最多一次**，仍冲突转人工三列。
5. catalog 替换硬阻断 + 二次确认；确认绑定 planId，表单一动即作废。
6. selectModel 只在显式按钮出现；三态如实显示，失败不回滚 commit。
7. ledger 只追加、失败也记、值经规范化并脱敏，`via` 预留 U5 通道。
