# B4 — UI 与交互设计（ModelPilot）

状态：设计草案 v1（供 B1/B2/B5 交叉评审）
日期：2026-11-10
范围：**纯设计文档**——信息架构 + 组件职责 + 状态流。不含 CSS 级细节（视觉规范另行产出）。
证据标签沿用 dsh-compat-audit 体系：`[已核对-源码]` `[已执行-探针]` `[设计定案]` `[推断-待验证]` `[待验证-P2]`。
上游消费：B1 Remote 接口（`modelAssistant.*`）、B2 数据模型（CapabilitySnapshot / StoredField 三态 / ReasoningPolicy / WireProfile / ProjectionResult 三分类）。B1/B2 未定稿处以「对齐引用」书写，B4 不自定义其内部结构；两者终稿若有出入，以终稿为准、B4 相应字段名跟随。

---

## 0. 事实基线引用（本设计的输入面）

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | 挂载点两版逐字稳定：`settings.models.provider-card`（keyed slot，载荷 `{provider, configured, keyConfigured}`，第二参 `{entryKey}`）= 提供方卡内旁挂入口按钮；`settings.models.footer`（list slot，载荷 `{}`）= 页脚完整入口 | `[已核对-源码]`（01-gap-fill U2：dsh-client-ui-slots 两版逐字节相同；settings-models 消费端两版同构） |
| F2 | settings 区块注册形态：`ctx.slots.inject("settings.section", () => ctx.slots.register({name:"settings.section", id, order, label, inject, children}))`（同 settings-models 自身注册） | `[已核对-源码]` |
| F3 | 客户端插件形态：`package.json dsh.client = { inject: ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-locale", ...], platform: "web" }`；React 跟随宿主（0.2.1 = react 19 + react-jsx-runtime）；闭包内 React 组件形态（参照 dsh-plugin-model-capability `lib/client.js`） | `[已核对-源码]` |
| F4 | 宿主原生 0.2.1 已有 ModelReasoningEfforts 编辑（off/low/medium/high + wire 值）；0.2.0 无。插件推理面板定位 = 跨模型批量管理 + 来源置信展示 + 预设档案，**不是补原生缺失** | `[已核对-源码]`（0.2.1 client-ui-settings-models） |
| F5 | maxTokens 三值展示义务：来源声明输出能力 / 用户希望的请求预算 / 宿主当前绑定值（宿主把条目 maxTokens 物化为缺省请求预算，两版一致） | `[已核对-源码]` |
| F6 | 预览两级：driver-confirmed（经宿主 `resolveCallConfig` / `prepareCall(configure)` 实际校验）vs logical-only（仅协议模板推导）。语义：`requestSucceeded ≠ controlAcknowledged` | `[设计定案]`（B1 对齐引用） |
| F7 | deepseek 投影白名单 `{name?, contextWindow?, maxTokens?, inputModalities?}` + 路由级 `reasoningEffort?` 四值枚举（off/low/high/max）；`reasoningEfforts` dict 输入 deepseek 投影必须报 unsupported，禁止静默映射 | `[已核对-源码]`（01-gap-fill U4，两版同构） |
| F8 | models.dev 字段面：`limit.context/output`、`modalities.input/output`、`reasoning_options: [{type:"toggle"}|{type:"effort",values}|{type:"budget_tokens",min,max}]`、`status:"deprecated"` 等；缓存 `dshCachePath("modelpilot","models-dev-v1.json")`，TTL 24h + last-known-good | `[已执行-探针]`（01-gap-fill U6） |
| F9 | locale 模式：`ctx.locale.register(ns, {zh, en})` + `ctx.locale.bind(ns)`，组件内 `t()` 取词（settings-models 同款） | `[已核对-源码]` |
| F10 | selectModel 纪律：普通保存**不调用**；显式「并选为当前模型」为独立动作并披露默认同步副作用 | `[设计定案]`（brief 给定） |

---

## 1. 信息架构总图

### 1.1 层级与入口

```mermaid
flowchart LR
  subgraph Native["settings · Models 页（宿主原生）"]
    PC["provider-card 旁挂按钮\n（keyed slot × N 提供方）"]
    FT["footer 工作台入口\n（list slot × 1）"]
  end
  subgraph WB["ModelPilot 工作台（自注册 settings.section）"]
    A["屏 A 模型配置\n编辑单个目标模型"]
    B["屏 B 档案与规则\nWireProfile 与匹配规则"]
    C["屏 C 诊断\n只读健康与验证记录"]
  end
  PC -- "携 entryContext{provider, entryKey}" --> A
  FT -- "默认打开" --> A
  A <-- "顶栏 Tab 切换" --> B
  A <-- "顶栏 Tab 切换" --> C
  B -- "应用/冲突跳转" --> A
  C -- "冲突→定位字段" --> A
```

- **工作台宿主位置**：以 F2 形态注册独立 `settings.section`（`id: "modelpilot.workbench"`，`order` 排在 settings-models 之后，`label` 走 locale），`inject` 返回工作台外壳（三屏 Tab 容器）。入口按钮不承载编辑 UI，只负责**导航 + 携带上下文**。
- **深链上下文**：provider-card 按钮点击 → `WorkbenchStore.open({ provider, entryKey })` → 工作台打开屏 A 并预选中该 provider 下唯一/推荐模型；多模型时左侧列表展开并高亮该 provider 分组。若宿主不支持跨 section 导航定位（OQ-1），保守降级见 §9。
- **每屏职责一句话**：
  - **屏 A 模型配置**：围绕单个目标模型的字段编辑、来源与候选、投影预览与应用。
  - **屏 B 档案与规则**：WireProfile 档案库与匹配规则（exact/route/protocol/global）的管理与导入导出。
  - **屏 C 诊断**：只读视图——catalog 健康、匹配链、冲突、driver 能力矩阵、应用 ledger 与验证记录。

### 1.2 导航关系规则

| 关系 | 行为 |
| --- | --- |
| 入口 → 工作台 | 两入口共享同一 `WorkbenchStore.open(entryContext)`；同一 DraftStore 单例（§6.3） |
| 工作台内部 | 顶栏 Tab（A/B/C），切换不丢弃 Draft（脏稿保留在内存，仅目标切换才触发确认弹窗） |
| B → A | 档案「应用到目标」动作生成待处理 diff，携带 targetKey 跳屏 A 预览区 |
| C → A | 冲突/未支持字段条目「定位」按钮跳屏 A 并滚动至对应字段行 |

**证据**：F1/F2/F3 `[已核对-源码]`；工作台为独立 section 与深链上下文设计 `[设计定案]`；跨 section 导航定位能力 `[推断-待验证]`（OQ-1）。

---

## 2. 屏 A — 模型配置工作台

### 2.1 三栏布局与组件职责

```mermaid
flowchart TB
  subgraph L["左栏：提供方 + 模型列表"]
    L1["ProviderGroup（折叠分组）"]
    L2["ModelNode：id · 配置态点 · 证据徽章 · 推理策略摘要"]
    L3["多选开关（批量模式）"]
  end
  subgraph M["中栏：草稿字段"]
    M1["FieldRow × n（名称/上下文/预算/模态/推理）"]
    M2["每字段：来源徽章 + 锁 + 清空 + 恢复"]
  end
  subgraph R["右栏：来源 · 候选 · 请求计划"]
    R1["SourceCard（catalog 版本/缓存年龄/来源健康）"]
    R2["CandidateList（候选 + deprecated 标）"]
    R3["RequestPlan（三段 + fidelity 徽章）"]
  end
  subgraph Bot["底部：diff 与应用状态区"]
    B1["档案 lane diff"]
    B2["宿主 lane diff"]
    B3["应用状态机 + verify 记录"]
    B4["并选为当前模型（独立动作）"]
  end
```

| 区域 | 组件职责 |
| --- | --- |
| 左栏 ProviderGroup / ModelNode | 消费 `modelAssistant.listTargets`；节点渲染配置态（configured / keyConfigured 缺失警示）与每目标推理策略一句话摘要；多选进入批量模式（R6 批量管理入口） |
| 中栏 FieldRow（每个可编辑字段一行） | 行内：字段标签、输入控件、**来源徽章**、**锁**、**清空**、**恢复** 四操作 |
| 右栏 SourceCard / CandidateList / RequestPlan | 只读；RequestPlan 是预览两级语义的展示主体（§2.4） |
| 底部 diff 区 | 应用前最后确认面；档案/宿主**分项**展示（§2.5） |

### 2.2 中栏字段规格（逐字段）

统一行内操作语义（所有字段一致）：

| 操作 | 行为 | 禁用条件 |
| --- | --- | --- |
| 来源徽章 | 显示该字段当前值的三态来源：`继承`（未设置，按宿主/模板默认）/ `用户`（草稿显式设置）/ `宿主`（宿主物化只读显示）——对应 B2 StoredField 三态，显示映射以 B2 终稿枚举为准 | — |
| 锁（lock） | 字段被规则/档案/宿主绑定占用时呈锁定态；tooltip 说明占用者（如「route 规则 profile:long-output」）。锁定字段可查看、可临时解锁（解锁 = 本草稿临时覆盖，应用时按优先级裁决并在 diff 中标注） | 无占用者 |
| 清空（clear） | 回退到继承态（值移除，StoredField 回「未设置」） | 已是继承态 |
| 恢复（restore） | 恢复用户最近一次已应用值（DraftStore 保留 last-applied 快照） | 无历史值 |

逐字段规格：

| 字段 | 控件 | 来源/候选联动 | 投影约束（UI 呈现） |
| --- | --- | --- | --- |
| **name** | 文本输入 | 目录 `name` 为 placeholder | 深度浅：仅展示，占位提示「目录声明：xxx」 |
| **工作上下文 contextWindow** | 数字输入 + 语义切换（combined/input，仅当目录提供语义信息时显示切换；无信息则标注「语义未知」） | 目录 `limit.context`（U6 映射）作参考值徽章；目录值 ≠ 草稿值时行内提示 | 按 driver 白名单决定可投影性；不可投影时徽章「档案 only」 |
| **输出预算 maxTokens** | **三值展示组件**（§2.3） | 目录 `limit.output` | 同上 |
| **输入模态 inputModalities** | checkbox 组：text / image + 其他目录声明模态 | 目录 `modalities.input`；pi-ai 只认 text/image，**额外模态以 disabled checkbox 呈现**并提示「目录声明，当前投影不支持」 | 白名单外值不进宿主投影，可存档案 |
| **推理面板 R6** | 独立面板（§3） | 目录 `reasoning_options` | 见 §3 |

### 2.3 三值展示组件（maxTokens 义务）

组件 `ThreeValueBudget`，一行三列：

| 列 | 数据 | 展示 |
| --- | --- | --- |
| ① 来源声明输出能力 | 目录 `limit.output`（U6 → Evidence.outputLimit, declared） | 静态徽章「目录：262144」 |
| ② 用户希望的请求预算 | 草稿 StoredField | 输入框（唯一可编辑位） |
| ③ 宿主当前绑定值 | 宿主配置物化值（两版一致：条目 maxTokens = 缺省请求预算） | 静态徽章「宿主：256000」 |

行为规则：
- ② 为空时显示 ③ 并标注「未显式设置，按宿主绑定值发送」。
- ② > ① 时行内 warning（不阻塞，用户可声明覆盖）——目录声明是**能力参考**而非硬闸。
- ③ 与 ② 不一致且用户未改过（untouched）时，提示「宿主绑定值与草稿不同，应用后以 ② 为准」。
- 任一值缺失显示 `—`，不显示 0。

### 2.4 右栏 RequestPlan：三段式 + fidelity 徽章

```mermaid
flowchart TB
  S1["段1 逻辑策略\nReasoningPolicy + 字段意图（源：草稿）"]
  S2["段2 DSH 投影\nProjectionResult 三分类：\n可应用宿主 / profile-only / 需 runtime adapter"]
  S3["段3 请求计划\npreviewWire 输出的 wire 字段树"]
  F["fidelity 徽章\ndriver-confirmed | logical-only"]
  S1 --> S2 --> S3 --> F
```

- **段2 分档着色**：可应用宿主（绿）/ profile-only（蓝）/ 需 runtime adapter（灰，P3 前置灰置并标注「P3 通道，当前仅存档案」——对应 U5 agent/request waterfall 通道预留）。
- **fidelity 徽章语义**：
  - `driver-confirmed`：本 generation 内该计划经 `resolveCallConfig` / `prepareCall(configure)` 实际校验通过；草稿任一字段再变更即**降级回 logical-only**（generation 失效，§6.1）。
  - `logical-only`：仅协议模板推导。UI 文案固定为「推导的计划，未经 driver 确认」，**禁止**表述为「将发送」。
- 段3 wire 树逐字段可折叠；`reasoningEfforts` dict → deepseek 类 unsupported 的条目在段2 以红色条目列出（F7，禁止静默映射的 UI 落点）。

### 2.5 底部 diff 与应用状态区

**分项 lane（档案 / 宿主分开，不合并展示）**：

| Lane | 内容 | 动作 |
| --- | --- | --- |
| 档案 lane | 本草稿将写入 WireProfile 的字段 diff（相对当前生效档案） | 单独勾选应用 |
| 宿主 lane | 将写入宿主配置的投影结果 diff（仅 ProjectionResult「可应用宿主」部分） | 单独勾选应用 |
| adapter lane（只读灰置） | 「需 runtime adapter」的字段——首版不落地，展示为待 P3 | 不可勾选，tooltip 说明 |

**应用状态机**：`clean → dirty → preview-stale → applying → applied / apply-error / partially-applied`（档案已写、宿主被拒时进入 partially-applied，底部双 lane 各自显示结果，`commitApply` 结果回填）。

**「并选为当前模型」**：与「应用」**分离**的独立按钮（F10）。点击先弹披露：「将把 {model} 设为当前模型，影响后续 agent 请求的默认路由与默认同步行为」。普通保存路径**不出现**任何 selectModel 调用。

**证据**：F1/F3/F5/F7/F10 `[已核对-源码]` `[设计定案]`；U6 models.dev 字段 `[已执行-探针]`；U5 adapter 通道 `[设计定案]`（运行时 `[待验证-P3]`）。

---

## 3. R6 推理面板设计

### 3.1 定位声明（重复以约束实现）

原生 0.2.1 已有单模型 ModelReasoningEfforts 编辑（F4）。本面板是**跨模型批量管理 + 来源置信展示 + 预设档案**面，不与原生单模型编辑器比拼单点能力；0.2.0 用户由此获得能力，0.2.1 用户由此获得批量与置信。

### 3.2 四区规格

| 区 | 选项 | 说明文案（核心句） | 来源标注 |
| --- | --- | --- | --- |
| ① 继承 | radio `继承（不写控制字段）` | 「按当前 driver 处理，不保证 wire 无控制字段」——插件侧不写入任何推理控制字段，driver 自身行为不在插件承诺范围 | 有 driver-confirmed 观测时附「上次验证观测：请求携带/未携带 <参数>」 |
| ② 关闭 | radio `关闭` | 显式禁用推理；wire 表现依 driver 而定，见 §3.3 子面板 | 关闭参数是否存在 = driver 能力矩阵数据 |
| ③ 档位（effort） | radio 组：目录声明档位 / 用户模板档位 / 自定义 wire 值（输入框） | 每个档位旁标来源徽章：`目录`（catalog `reasoning_options.effort.values`，U6）/ `模板`（用户预设）/ `自定义`。**跨档位系禁止静默映射**：pi-ai 七档 dict 输入 deepseek 目标时 UI 直接显示红色 unsupported 条目（F7），并给出「该目标接受四值枚举」的修正建议（off/low/high/max） | 自定义值仅在 driver 接受 free wire 值时可用（0.2.1 原生「+ wire 值」同语义）；可用性由 driver 能力矩阵驱动 |
| ④ 预算（budget） | 数字输入（min/max 来自目录 `budget_tokens` 声明时钳制） | 固定徽章「**仅存档案**（首版无宿主承接）」——写入 WireProfile，不进宿主投影 | 目录 `reasoning_options{type:"budget_tokens"}` 提供范围时显示 min/max |

- 面板顶部展示**当前 driver** 名称与「driver 能力速览」（允许的推理字段列表，数据同屏 C 矩阵行切片）。
- **批量模式**（左栏多选触发）：四区变为矩阵视图——行 = 选中目标，列 = 四区当前值；单格可改，顶部「应用到全部选中」批量改档；任一目标出现 unsupported 时该格红显且不阻塞其他目标。

### 3.3 「实际发送参数预览」子面板

固定在四区下方，实时计算（ReasoningPolicy, target driver, driver 能力矩阵）：

| 输入组合 | 展示 |
| --- | --- |
| off 且 wire 语义 `null`（driver 无独立关闭参数） | 「**不发参数**」（附一句：该 driver 通过省略字段表达关闭） |
| off 且 wire 语义 `off:"reasoning_effort"`（driver 需显式参数表达关闭） | JSON 片段视图，如 `{ "reasoning_effort": null }`（以 B1 previewWire 实际输出为准，UI 不自行拼 wire） |
| effort 档位 | 对应 JSON 片段 `{ "reasoning_effort": "<档位>" }` |
| budget | 「仅存档案，不出现在请求计划中」+ 档案值回显 |
| inherit | 「插件不写入；driver 行为未验证时显示 logical-only 水印」 |

- 子面板整体挂当前 fidelity 徽章（§2.4 同语义同失效规则）；logical-only 时 JSON 片段右上角水印「推导」。
- 子面板数据唯一来源是 B1 `previewWire`；UI 不做本地协议拼装，避免双实现漂移。

**证据**：F4/F7 `[已核对-源码]`；U6 reasoning_options 三型 `[已执行-探针]`；previewWire 单一数据源与子面板行为 `[设计定案]`。

---

## 4. 屏 B — 档案与规则

### 4.1 档案列表

- 按 WireProfile scope 四组分组展示：**连接（connection）/ 路由（route）/ 协议（protocol）/ ID**；组内条目显示：名称、作用键、字段数、schema 版本、最后修改时间。
- 条目操作：查看（只读 diff 视图）、编辑（进入规则编辑器上下文）、复制、删除（二次确认，显示引用该档案的规则数）。
- 作用域分组头部显示命中统计（来自屏 C 匹配链数据的聚合），帮助用户判断「这个档案到底覆盖了多少目标」。

### 4.2 规则编辑器

| 规则类型 | 匹配键 | UI 要点 |
| --- | --- | --- |
| exact | 精确 model id | 单值输入 + 目录 id 补全 |
| route | provider/endpoint 路由 | provider 选择器 |
| protocol | 协议族 | 协议枚举选择 |
| global | 全局缺省 | 兜底规则，置于优先级链末位（可查看不可拖出末位） |

- **优先级展示**：规则按优先级排序为纵向链（exact > route > protocol > global），支持上移/下移调整；每个规则节点显示「命中范围预览」（该规则当前会命中哪些已列目标——复用屏 C 匹配链计算结果）。
- 循环/冲突检测：规则保存前经 B1 校验；冲突在编辑器内即时红显（复用 ProjectionResult 冲突项），不等到屏 C 才暴露。

### 4.3 预设管理

- 内置预设（首版至少：「关闭推理」「默认档位」「长输出高预算」）+ 用户自建预设。
- 预设 = 参数化的 WireProfile 模板；「应用到目标」生成待应用 diff 并跳屏 A 预览（不在屏 B 内直接写宿主）。

### 4.4 导入导出

| 环节 | 行为 |
| --- | --- |
| 导出 | schema 版本化信封（`schemaVersion` + 档案 + 规则 + 优先级）；**强制去凭据**（key/token 类字段剔除并在导出摘要中列明剔除了哪些字段） |
| 导入 | 三步强制流：**选择文件 → 预览 diff（新增/覆盖/冲突分类逐条列出）→ 应用**；schema 版本不匹配走迁移提示或拒绝（版本高于当前 → 拒绝并提示升级）；应用后进入与手动编辑相同的应用状态机 |

**证据**：WireProfile/规则/优先级结构 `[设计定案]`（B2 对齐引用）；去凭据与预览后应用 `[设计定案]`；命中统计复用屏 C 数据 `[设计定案]`。

---

## 5. 屏 C — 诊断

只读屏，全部数据来自 B1/B2 已有能力，不做二次计算：

| 区块 | 内容 | 数据源 |
| --- | --- | --- |
| **catalog 健康** | 每来源一行：host 原生目录 / models.dev（版本、缓存年龄、TTL 状态、是否 last-known-good 兜底） | B2 CapabilitySnapshot + U6 缓存元数据 |
| **匹配路径** | 选中目标 → 五级链逐级展示，高亮**命中级**：① exact id 精确命中 → ② canonical/alias（canonical_model_id 或别名表）→ ③ route（同 provider/endpoint 内唯一）→ ④ protocol（协议族模板）→ ⑤ global；未命中 = none。每级显示「该级参与者与落选原因」 | B2 匹配链结果（链级命名待与 B2 终稿对齐） |
| **冲突列表** | ProjectionResult 冲突项：涉及字段、冲突双方（规则 vs 规则 / 规则 vs 宿主）、裁决建议；「定位」跳屏 A 对应字段 | B2 |
| **driver 能力矩阵** | 行 = 字段（name/contextWindow/maxTokens/inputModalities/reasoningEffort 四值/reasoningEfforts dict/budget…），列 = driver（dsh-llm-deepseek、宿主 pi-ai driver、…），格 = 允许 / 路由级仅 / 报 unsupported（F7 实例落格：deepseek × reasoningEfforts dict = unsupported） | U4 + B2 |
| **投影未支持字段** | 当前选中目标投影时被丢弃/拒绝的字段清单，每条注明原因（档位系不同 / 白名单外 / 无宿主承接） | B2 ProjectionResult |
| **最近应用结果（ledger 视图）** | 时间倒序：时间、目标、动作（apply/verify）、通道（settings 写路径 / agent/request[P3]）、结果 | B1 ledger（含 U5 `via=agent/request` 标记位） |
| **验证记录** | 表格两列分立：`requestSucceeded` / `controlAcknowledged`——**分列是硬性要求**，两者语义不同（请求成功 ≠ 控制字段被 driver 确认生效），合并即误导 | B1 verifySelected |

**证据**：U4/F7 `[已核对-源码]`；U6 缓存与字段 `[已执行-探针]`；五级链命名 `[设计定案]`（待与 B2 对齐）；`requestSucceeded ≠ controlAcknowledged` 分列 `[设计定案]`（B1 对齐引用）。

---

## 6. 状态流

### 6.1 DraftStore

```mermaid
stateDiagram-v2
  [*] --> Loading: open(entryContext)
  Loading --> Editing: listTargets/resolve 完成(generation=N)
  Editing --> Previewing: 字段变更 / 请求预览
  Previewing --> Editing: 草稿再变更(降级 logical-only)
  Editing --> ExternalChanged: 宿主配置外部变更(generation≠N)
  ExternalChanged --> Editing: rebase（重新 resolve，用户值按 touched 保留）
  Previewing --> Applying: prepareApply
  Applying --> Applied: commitApply 成功
  Applying --> ApplyError: 失败（错误全量上浮）
  Applying --> PartiallyApplied: 档案成功/宿主被拒
  Applied --> Editing: 继续（last-applied 快照更新）
```

| 概念 | 定义 |
| --- | --- |
| **generation** | 单调递增计数器；打开目标时取值，宿主配置外部变更或 rebase 后递增；所有预览/验证结果与 generation 绑定，generation 变化即失效（fidelity 降级、diff 重算） |
| **touched** | per-field 布尔：用户本轮编辑是否改过；rebase 时 touched 字段保留用户值、未 touched 字段吸附新 resolve 值 |
| **locked** | per-field：被规则/档案/宿主绑定占用（§2.2 锁语义）；锁定不等于只读——「临时解锁」产生显式覆盖并在 diff 中标注 |
| **pristine** | 草稿 == 打开时的 resolve 快照；pristine 时「应用」禁用 |

### 6.2 与 NativeFormBridge 的关系

- **定位**：工作台是**主入口**；NativeFormBridge 是可选增强——当用户停留在原生 Models 页编辑时，把工作台草稿/应用结果同步进原生表单状态，避免「改了工作台、原生页还是旧值」的割裂。
- **失败降级路径**（必须成立，桥是增强不是依赖）：
  1. 桥初始化失败 / 宿主表单状态不可达 → 工作台全部功能照常，仅原生页在其自身刷新后显示新值；
  2. 降级**不静默**：屏 C 诊断显示 bridge 状态（active / degraded / unavailable），degraded 时工作台顶部一次性横幅告知「原生页需刷新后可见新值」；
  3. 桥故障绝不阻塞 apply 路径（写路径与桥解耦，桥只做单向展示同步）。
- 桥 API 若宿主未提供稳定面（OQ-3），保守默认：桥默认关闭，由诊断屏开关显式启用（§9）。

### 6.3 双入口状态共享

- 单例 `WorkbenchStore` + 单例 DraftStore，key = `(scope, targetKey, generation)`。
- provider-card 按钮（keyed slot，每 provider 一个实例）与 footer 按钮调用同一 `open(entryContext)`；从 provider-card 进入时 entryContext = `{provider, entryKey}`（F1 载荷），工作台据此预选目标；footer 进入时 entryContext = `{}`，走默认目标。
- **单草稿原则**：同一时刻只有一个活跃草稿。已有脏稿时再次从另一入口进入 → 顶部提示「当前有未应用修改（目标 X）」，提供「继续编辑 / 丢弃并切换」确认；不后台并存多草稿（首版简化，避免并发写竞态）。
- 入口按钮自身无状态（不显示草稿脏标）——脏稿状态只在工作台内呈现，避免 slot 按钮与工作台状态的双向同步复杂度（OQ-5 相关的键盘/焦点面也收敛在工作台内）。

### 6.4 应用动作与 selectModel 纪律（复述为硬约束）

- `prepareApply → commitApply` 仅写「用户在 diff 区勾选的 lane」；档案 lane 与宿主 lane 可分别应用。
- selectModel（并选为当前模型）**只**由独立按钮触发，带披露弹窗（§2.5）；所有其他保存/应用路径代码层面不得出现 selectModel 调用。
- `verifySelected` 为应用后的可选动作，结果写入 ledger 与屏 C 验证记录（两列分立）。

**证据**：DraftStore 语义 `[设计定案]`；桥降级路径 `[设计定案]`（bridge API 存在性 `[推断-待验证]`，OQ-3）；F10 selectModel 纪律 `[设计定案]`（brief 给定）。

---

## 7. locale 键位草案

命名空间 `modelpilot`，经 `ctx.locale.register("modelpilot", {zh, en})` + `ctx.locale.bind("modelpilot")`（F9 模式）。前 30 键：

| # | 键 | zh | en |
| --- | --- | --- | --- |
| 1 | `workbench.title` | 模型工作台 | Model Workbench |
| 2 | `workbench.tab.models` | 模型配置 | Models |
| 3 | `workbench.tab.profiles` | 档案与规则 | Profiles & Rules |
| 4 | `workbench.tab.diagnostics` | 诊断 | Diagnostics |
| 5 | `entry.smartAdd` | 智能添加 | Smart Add |
| 6 | `entry.smartEdit` | 智能编辑 | Smart Edit |
| 7 | `entry.noKey.hint` | 未配置 API Key | API key not configured |
| 8 | `entry.openWorkbench` | 打开模型工作台 | Open Model Workbench |
| 9 | `field.contextWindow` | 工作上下文 | Context window |
| 10 | `field.contextSemantics` | 上下文语义 | Context semantics |
| 11 | `field.maxTokens` | 输出预算 | Output budget |
| 12 | `field.maxTokens.declared` | 目录声明输出能力 | Declared output capability |
| 13 | `field.maxTokens.request` | 请求预算 | Request budget |
| 14 | `field.maxTokens.hostBound` | 宿主当前绑定值 | Host-bound value |
| 15 | `field.modalities` | 输入模态 | Input modalities |
| 16 | `field.modalities.text` | 文本 | Text |
| 17 | `field.modalities.image` | 图像 | Image |
| 18 | `field.modalities.extra.disabledHint` | 目录声明，当前投影不支持 | Declared by catalog, not projectable |
| 19 | `reasoning.title` | 推理 | Reasoning |
| 20 | `reasoning.inherit` | 继承 | Inherit |
| 21 | `reasoning.inherit.hint` | 按当前 driver 处理，不保证 wire 无控制字段 | Handled by the current driver; wire control fields are not guaranteed absent |
| 22 | `reasoning.off` | 关闭 | Off |
| 23 | `reasoning.effort` | 档位 | Effort |
| 24 | `reasoning.budget` | 预算 | Budget |
| 25 | `reasoning.budget.profileOnly` | 仅存档案（首版无宿主承接） | Profile-only (no host carrier in v1) |
| 26 | `reasoning.preview.title` | 实际发送参数预览 | Actual send preview |
| 27 | `reasoning.preview.none` | 不发送推理参数 | No reasoning parameters sent |
| 28 | `source.declared` | 目录声明 | Catalog |
| 29 | `source.user` | 用户 | User |
| 30 | `source.host` | 宿主 | Host |

后续键族（仅列前缀，随屏 B/C 细化补全）：`preview.fidelity.driverConfirmed / logicalOnly`、`diff.lane.profile / host / adapter`、`apply.state.*`、`action.selectAsCurrent` + `.disclosure`、`profiles.scope.*`、`rules.type.* / priority`、`importExport.*`、`diag.*`（匹配链五级、矩阵格值、ledger 列）、`a11y.aria.*`、`bridge.status.*`、`external.changed.banner`、`rebase.*`。

**证据**：F9 locale 模式 `[已核对-源码]`；键位划分 `[设计定案]`。

---

## 8. 无障碍与错误态最低要求

| 类别 | 最低要求 |
| --- | --- |
| aria-label | 所有纯图标按钮（锁/清空/恢复/折叠箭头）必须有 `aria-label`（走 locale `a11y.aria.*` 键）；来源徽章与 fidelity 徽章一律**文本 + 颜色**双通道，禁止仅颜色达意 |
| 错误不吞 | 三重上浮：字段行内错误（就近）+ 应用区错误摘要（底部）+ ledger 记录（屏 C）。任何被 B1/B2 拒绝的操作必须有可见反馈；「部分成功」（partially-applied）必须双 lane 分别展示结果，禁止笼统「失败」 |
| 加载态禁写 | generation 加载中 / 预览失效重算中 / applying 中：输入控件与「应用」按钮一律 disabled（防撕裂编辑）；disabled 必须伴随原因文案（「加载中」「预览重算中」），不允许无解释的灰按钮 |
| 焦点与键盘 | 工作台 Tab 容器焦点顺序 左→中→右→底部；确认弹窗焦点圈闭 + Esc 关闭 + 关闭后焦点还原触发元素；slot 注入按钮作为宿主表单内元素遵循宿主焦点序（不自建 tabindex 洞） |
| 表格语义 | 屏 C 矩阵/ledger 表格带 `caption` 与表头 `scope`；验证记录两列分立本身也是语义正确性要求（§5） |

**证据**：本节为 UI 质量底线 `[设计定案]`；slot 按钮焦点序跟随宿主 `[推断-待验证]`（OQ-5）。

---

## 9. Open Questions 与保守默认

| # | Open Question | 保守默认（未决时按此实现） |
| --- | --- | --- |
| OQ-1 | 宿主 settings.section 注册后，能否从另一 section 的 slot 按钮深链定位到工作台并携带目标上下文（F2 注册形态可见，导航能力未核） | 入口按钮打开工作台默认屏（屏 A）；provider 上下文以顶部横幅呈现「来自 {provider} 卡片，请选择模型」，列表自动展开并高亮该 provider 分组；不做跨 section 路由 hack |
| OQ-2 | footer list slot 的条目容器能否承载按钮以外的说明文字（副标题） | 首版 footer 只放单按钮，无副标题；说明文字移入按钮 tooltip |
| OQ-3 | NativeFormBridge 是否存在宿主稳定 API（0.2.1 类型声明未见稳定面） | 桥整体默认关闭；诊断屏提供显式开关（探测可用才允许开启）；工作台功能完全不依赖桥 |
| OQ-4 | `verifySelected` 的 `controlAcknowledged` 判定信号来源与形态（B1 依赖） | UI 仅忠实渲染 B1 返回的两列布尔，不自行推断；B1 未返回该字段前，第二列显示「未验证」而非 false |
| OQ-5 | slot 注入按钮的键盘焦点序是否完全受宿主管理、会不会被原生表单校验拦截提交 | 按钮用 `<button type="button">`（不参与表单提交），不自定义 tabindex；异常表现记录到屏 C 的 bridge/环境状态区 |
| OQ-6 | 工作台 section 的 `order` 在两版宿主的 section 排序稳定性 | order 取 settings-models 之后的保守大偏移；排序异常不阻塞功能（仅影响入口顺序观感） |

**保守默认汇总**：① 工作台 = 独立 settings.section，入口只导航不承载 UI；② 一切预览未达 driver-confirmed 一律 logical-only 徽章 + 「推导」水印，文案禁用「将发送」；③ 桥与深链均为增强，失效即降级且降级可见（横幅/诊断态），主功能零依赖；④ 两列验证分立、档案/宿主 lane 分项、双入口共享单草稿——三条结构性约束在 OQ 全部未决时也成立。

---

*（B4 完。后续：B5 需消费 §2.4 预览失效与 §6.1 状态机；B2 终稿落定后回填 §2.2 三态枚举名与 §5 五级链命名。）*
