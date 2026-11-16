# ModelPilot · dsh-model-assistant

> 一个独立的 DSH 插件：在 DSH 设置里加一个**模型配置工作台**，
> 把「一个模型 ID」变成一条正确、可解释的 DSH 模型条目。

写配置时你能看清三件事：**到底要写哪些键、触发了哪些告警、宿主真正接受了哪些控件**。

---

## 解决什么问题

DSH 内置的模型页能改配置，但改起来累。ModelPilot 把它换成一个专门的工作台：

| 内置页的痛点 | ModelPilot 的做法 |
| --- | --- |
| 编辑一条模型必须滑到底点「取消」 | 行内折叠编辑，取消就在手边 |
| 删除必须先进入编辑态 | 行尾直接删除，带二次确认 |
| 连接测试只给「失败」，401 查不出原因 | 细分结论：连接正常并报出模型数 / 端点返回空列表 / 协议没有可读列表 / 失败时按 401 · 403 · 404 · 5xx 给出原因 |
| 长列表（10 条以上）没法分组、没法搜索 | 按 id 前缀分组折叠 + 搜索 + 紧凑 / 详细两档密度 |
| 批量改字段要一条条点 | 勾选多行后一次改 4 个字段，一条 `set` 写完 |
| 改 `apiKeyEnv` 会留下删不掉的旧密钥 | 六态判定，能删时先弹确认，先删密钥再写配置 |
| 不知道写入会产生什么 | 写入前展示完整的 `settings.mutate` 操作清单 |

---

## 能力清单

### 模型条目

- 按网关期望的**原样**输入模型 ID（永不改写、不补前缀、不改大小写）
- 从宿主目录里挑模型，或手填自定义 ID
- 单条编辑：显示名、`contextWindow`、`maxTokens`、输入模态、推理档位
- **支持清空字段**：留空等于删除该键，改由路由默认值接管；本来没值的字段不会写多余的 `unset`
- 行内折叠编辑、行尾直接删除、键盘可达

### 批量操作

- 勾选任意多行，一次改 4 个字段（上下文窗口 / 输出上限 / 输入模态 / 推理档位）
- 只写**真正发生变化**的行，提示里给出真实条数
- 整批合成**一条** `set` 操作，要么全成要么全不成
- 折叠或搜索过滤掉的选中行会明确提示「其中 N 条未显示」，并可一键取消
- 批量删除走二次确认，列出前 5 个模型 ID 与剩余条数，写明无法撤销

### 列表视图

- **平铺 / 分组**两种视图，偏好记在本地，默认分组
- 平铺：按配置数组顺序渲染，可跨组自由拖动排序，`Home` / `End` 到全表首末位
- 分组：按 id 前缀折叠，组内可排序，组头显示命中数 / 总数
- **紧凑 / 详细**两档密度，详细档显示完整摘要
- 搜索实时过滤，命中的分组自动展开
- 全选复选框三态（全选 / 半选 / 未选）

### 路由级设置

十个字段全部支持：「`displayName` / `baseURL` / `api` / `apiKeyEnv` / `defaultContextWindow` / `defaultMaxTokens` / `cacheRetention` / `transport` / `timeoutMs` / `defaultInput`」。

- 「全部路由」总览表：一眼看到所有路由的密钥状态，悬停即切换
- 「从目录选择」新建路由，或手填自定义 provider id
- 删除整条路由时按密钥真实状态说明后果，密钥还在读取中时确认按钮禁用

### 密钥

- `credentials.describe` 只告诉你「已配置 / 未配置」，不读明文
- `set` / `unset` 直接写入宿主凭据存储
- **密钥不进配置文件、不进 settingsOps、不进日志、不进任何提示**
- 改密钥引用名时会判断旧密钥能不能删：可删就弹确认并先删再写，共用 / 由环境变量提供 / 读不到都保留并说明原因

### 连接测试

- 用表单当前值做一次真实探活，**探活全程不带密钥字段、不产生任何 settingsOps**
- 结论细分：
  - 绿色「连接正常 · 端点返回 N 个模型」
  - 黄色「连接正常，但端点没有返回任何模型」
  - 「协议没有可读的模型列表」（`DISCOVERY_UNSUPPORTED`）
  - 失败时按 HTTP 状态给原因：401 / 403 标注密钥问题，404 标注地址可能写错，5xx 标注服务端错误，其余显示原文（超 200 字符截断）
- `declared` 路由的请求带 `provider`，目录读不到时保守带 `provider`
- 测试期间改表单不改变已发出的请求；迟到结果不再显示
- 任一字段改动后自动清除旧结论，不会拿过期结果骗你

---

## 写入前强制执行的守卫

这些守卫不是提示，是**硬拦截**——违反就一个操作都不发。

| 守卫 | 为什么需要 |
| --- | --- |
| **R1–R7 推理预检** | 一份格式错误的 `reasoningEfforts` 字典会让宿主拒绝**整条路由**的模型目录。`validatePiAiReasoningEfforts` 在客户端复刻宿主的拒绝规则（空字典 / 非 off 档位线上值为 null / 线上值为空串 / 只有 off），坏字典一个操作都不发。 |
| **目录替换闸门** | 在目录路由上写 `models` 会替换整个对外模型目录。界面逐条列出将消失的模型 ID，勾选确认后才发操作。 |
| **重复 ID 拒绝** | 宿主会拒绝重复的 `id`；ModelPilot 直接报告已存在的下标，而不是让写入失败。仅大小写不同的碰撞会告警（宿主按字面匹配）。 |
| **`modelOverrides` ⊕ `models` 互斥** | 在 `resolveRouteModels` 里这两条通道互斥，任何会违反这一点的写入都被提前拒绝。 |
| **白名单投影** | 只写 `id · name · contextWindow · maxTokens · input · reasoningEfforts`，其余键丢弃并给出可见的 `unknown-key-dropped` 告警。 |
| **`maxTokens` 双身份提示** | 模型条目的 `maxTokens` 同时会成为该模型默认的请求输出预算。界面把这点说清楚，绝不把它悄悄当成纯能力事实。 |
| **至少保留一条模型 / 一条路由** | 删空会让宿主拒绝整份配置，界面直接禁用按钮并说明原因。 |
| **版本围栏** | 写入走宿主自己的 `configForms.mutate(ops, expectedRevision)`；冲突时自动重读 + 重试一次。 |

---

## 安装

支持宿主：`@deepseek-ai/dsh` `>=0.2.0-rc.2 <0.2.3-0`（peer 范围由宿主自己的 `evaluatePluginCompatibility` 强制校验）。
需要 Node.js `>=24.9.0`。

### 方式一：从 GitHub 直接装（推荐）

在 profile 的 `package.json` 里加一条依赖：

```json
{
  "dependencies": {
    "dsh-model-assistant": "github:zhuj0101-bit/modelpilot"
  }
}
```

然后：

```bash
dsh plugin --profile desktop add github:zhuj0101-bit/modelpilot
# 或者直接进 profile 目录跑 pnpm install
```

仓库里 `lib/` 三个产物是**已构建好的**并已提交进 git，装完即用，不需要再跑构建。

### 方式二：离线 tgz

```bash
npm install                    # 只为装 esbuild
node scripts/build-client.mjs  # 重建 lib/client.js
npm pack                       # -> dsh-model-assistant-0.1.0-alpha.3.tgz
dsh plugin --profile desktop add ./dsh-model-assistant-0.1.0-alpha.3.tgz
```

### 方式三：本地目录

```bash
git clone https://github.com/zhuj0101-bit/modelpilot.git
dsh plugin --profile desktop add ./modelpilot
```

目录方式装的是软链，后续 `git pull` 会直接影响已装版本，调试用可以，长期用建议前两种。

### 装完之后

重启 DSH（或刷新页面），打开 **设置 → ModelPilot**。

设置页的 section id 是 `modelpilot.workbench`；宿主半边由 `cordis.patch.yml` 里唯一一条 `insert` 挂载，id 为 `modelpilot` —— 这个 id 同时是插件的设置命名空间，改名等于做一次命名空间迁移。

---

## 开发

```bash
npm install
node --test "test/**/*.test.mjs"   # 全量测试：954 个，947 通过 / 0 失败 / 7 跳过
node scripts/build-client.mjs       # 重建 Web 端产物
node scripts/verify-package.mjs .   # 打包契约自检：18 项全 PASS
```

那 7 个跳过的用例是版本矩阵门禁，只在特定宿主版本下才跑，不是失败。

### 为什么浏览器端和测试端不会漂移

Web 打包产物**内联**了宿主测试覆盖的同一份投影代码（`src/core/`），
两边共用一套逻辑，物理上不可能各自漂移。React 保持外部依赖——由宿主的
`dsh-client-modules` 加载器提供。

### 目录结构

```
lib/index.js                     宿主半边（cordis 插件、Config 模式、Remote 服务）
lib/client.js                    Web 半边（由 scripts/build-client.mjs 生成，已入库）
lib/model-assistant-service.js   Remote 服务（命名空间 "modelAssistant"）

src/core/                        纯领域层，21 个模块，无 DOM 依赖
  api-key.js                     密钥引用与凭据状态
  apply-service.js               应用服务 prepare / commit、指纹撤销（未接线）
  candidates.js                  候选引擎八级字段合成（未接线）
  connection-probe.js            连接测试的四态判定
  context-budget.js              上下文预算估算，含耗尽标记
  default-template.js            默认模型模板
  domain.js                      领域常量与校验
  identity.js                    身份解析器五级链（未接线）
  key-rename.js                  改引用名时的旧密钥六态判定
  model-bulk.js                  批量改字段 / 批量删除的计划生成
  model-edit.js                  单条模型的编辑与清空语义
  model-list-view.js             分组 / 平铺 / 密度 / 全选三态 / 组头计数
  model-selection.js             模型勾选集合
  pi-ai-projection.js            字段级投影到 settings 操作
  profile-repository.js          三态档案仓库（未接线）
  reasoning-wire.js              推理档位的线路格式与 R1–R7 预检
  route-create.js                新建路由
  route-delete.js                删除路由，含共用密钥判定
  route-edit.js                  十个路由级字段的编辑
  route-overview.js              全部路由总览与批量密钥状态
  toast.js                       提示条的驻留 / 淡出 / 读屏语义

src/sources/                     models.dev v1 目录解析器
src/client/index.jsx             工作台界面源码（约 6000 行）
src/host/, src/shared/           设置写入器 / 版本能力（宿主侧脚手架）
test/                            59 个测试文件：单元 + 集成 + 真实 DOM + 打包契约
docs/                            设计、计划、证据笔记、状态
```

---

## 状态

- **P0** SDK 概念验证 —— 已完成。
- **P1** 核心闭环 + 工作台 MVP —— 代码完成、**接线未完成**。

  当前对外可见的能力是「模型 / 路由的增删改查 + 密钥管理 + 连接测试 + 批量操作 +
  分组与平铺视图」，全部由 `src/client/index.jsx` 直接驱动，不经过
  `identity` / `candidates` / `apply-service` / `profile-repository`。
  这四个模块是**已写好但尚未接入**的 P1 预置件，等 P1-07（工作台屏 A 骨架 + 双入口）接线，
  目前只有单测保护。`test/structure.test.mjs` 用一份显式白名单守住了这件事：
  实际零引用集合必须与白名单完全相等——新加零引用模块忘了登记会红，接完线忘了删白名单也会红。

- **P2** 计划中 —— `previewWire`、discovery 接入、档案屏、deepseek 方言启用。
- **P3/P4** 计划中 —— `verifySelected` 驱动确认证据、运行时策略适配器、原生表单桥。

开放问题及其保守默认值见 `docs/DESIGN-v2.md §9`；一页进度总结见 `docs/99-status.md`。

---

## 适用人群

**会配 API 的人**——知道 `baseURL` / `apiKey` / 模型 id 这三件套怎么填，就能用好这个插件。

不需要懂 DSH 内部 schema：每个字段都带中文 label 和说明，写之前还能看到完整的操作清单。

反过来，如果完全没配过 API，这个插件帮不了你——它把宿主 schema 的字段全部摊开给你看，
但「该填什么值」仍然要你自己知道。

---

## 许可证

MIT。
