# ModelPilot · dsh-model-assistant

一个独立的 DSH 插件：把"一个模型 ID"变成一条正确、可解释的 DSH 模型条目，
并且只写入尽可能小的一份设置补丁。

一切都是字段级的——你能看清到底要写哪些键、触发了哪些告警、驱动真正接受了哪些控件。

## 它做什么（MVP）

在 DSH 设置里、内置模型页旁边加一个 **ModelPilot** 页面
（`settings.section`，id 为 `modelpilot.workbench`）：

1. 选一条已配置的 `pi-ai` 路由（`providers.<id>`）。
2. 按网关期望的原样输入模型 ID（永不改写）。
3. 可选地设置显示名、`contextWindow`、`maxTokens`、输入模态和推理档位。
4. 界面展示**投影后的操作**——就是字面意义上的 `settings.mutate` 操作——
   外加引擎产生的每一条告警。
5. "写入 DSH 设置"通过宿主自己的 `configForms`（`mutate(ops, expectedRevision)`）
   执行带版本围栏的写入，并自动处理冲突（重读 + 重试一次）。
6. 在同一页编辑当前路由的九个路由级字段，并管理 `apiKeyEnv` 那条引用背后的
   真实密钥：`credentials.describe` 只给出「已配置 / 未配置」，`set` / `unset`
   直接写入宿主的凭据存储。密钥不进入配置文件、settingsOps、日志或任何提示。
7. 路由设置卡片底部的「测试连接」用表单当前值做一次真实探活（不传
   `provider`、不产生任何 settingsOps），区分正常 / 空列表 / 协议不支持 /
   失败，并在任一字段改动后自动清除旧结论。

## 写入前强制执行的守卫

| 守卫 | 为什么需要 |
| --- | --- |
| **R1–R7 推理预检** | 一份格式错误的 `reasoningEfforts` 字典会让宿主拒绝**整条路由**的模型目录。坏字典先在客户端被拒：一个操作都不发。 |
| **目录替换闸门** | 在目录路由上写 `models` 会替换整个对外提供的模型目录。界面会逐条列出将消失的模型 ID，并要求勾选确认后才发出操作。 |
| **重复 ID 拒绝** | 宿主会拒绝重复的 `id`；ModelPilot 改为直接报告已存在的下标，而不是让写入失败。仅大小写不同的碰撞会告警（宿主按字面匹配）。 |
| **`modelOverrides` ⊕ `models` 互斥** | 在 `resolveRouteModels` 里这两条通道互斥；任何会违反这一点的写入都会被提前拒绝。 |
| **白名单投影** | 只写 `id · name · contextWindow · maxTokens · input · reasoningEfforts`。其余键会被丢弃，并给出可见的 `unknown-key-dropped` 告警。 |
| **`maxTokens` 双身份提示** | 模型条目的 `maxTokens` 同时会成为该模型默认的请求输出预算。界面会把这一点说清楚，绝不把它悄悄当成纯粹的能力事实。 |

## 安装

```bash
# 在本仓库的检出目录里
node scripts/build-client.mjs        # 重新生成 lib/client.js
npm pack                              # -> dsh-model-assistant-0.1.0-alpha.3.tgz
dsh plugin --profile desktop add ./dsh-model-assistant-0.1.0-alpha.3.tgz
```

然后重启 DSH（或刷新页面），打开 **设置 → ModelPilot**。

支持的宿主：`@deepseek-ai/dsh` `>=0.2.0-rc.2 <0.2.3-0`
（peer 范围由宿主自己的 `evaluatePluginCompatibility` 强制校验）。

## 开发

```bash
npm install
node --test "test/**/*.test.mjs"      # 98 个测试
node scripts/build-client.mjs          # 重建 Web 端一半
```

Web 打包产物**内联**了宿主测试覆盖的同一份投影代码（`src/core/`），
所以浏览器端和测试端不可能各自漂移。React 保持外部依赖——由宿主的
`dsh-client-modules` 加载器提供。

目录结构：

```
lib/index.js                    宿主半边（cordis 插件、Config 模式、Remote 服务）
lib/client.js                   Web 半边（由 scripts/build-client.mjs 生成）
lib/model-assistant-service.js  Remote 服务（命名空间 "modelAssistant"）
src/core/                       纯领域层：身份、候选、投影、应用、档案
src/sources/                    models.dev v1 目录解析器
src/client/index.jsx            工作台界面源码
src/host/, src/shared/          设置写入器 / 版本能力（宿主侧脚手架）
test/                           单元 + 集成 + 打包契约测试
docs/                           补料、设计（v2）、计划、证据笔记、状态
```

## 状态

- **P0** SDK 概念验证 —— 已完成（48/48）。
- **P1** 核心闭环 + 工作台 MVP —— 已完成（98/98）。身份解析器、候选引擎、
  带 R1–R7 的 pi-ai 投影器、带指纹撤销的应用服务、三态档案仓库、
  打包好的工作台界面。
- **P2** 计划中 —— `previewWire`、discovery 接入、档案屏、deepseek 方言启用。
- **P3/P4** 计划中 —— `verifySelected` 驱动确认证据、运行时策略适配器、
  原生表单桥。

已知的开放问题及其保守默认值见 `docs/DESIGN-v2.md §9`。

## 许可证

MIT。
