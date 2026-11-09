# 收拢对齐登记表（主会话裁决用）

## 跨章节依赖与对齐点

| # | 来源 | 要求 | 承接方 | 状态 |
| --- | --- | --- | --- | --- |
| A1 | B5 | B1 SettingsWriter 支持 per-ns 提交粒度（档案 ns 失败时宿主 skipped） | B1 | 待 B1 回收合并 |
| A2 | B5 | B1「重试一次」定义为"重读+重定位+重 diff 后重提"（非重放 ops） | B1 | 待 B1 回收合并 |
| A3 | B5 | B2 ProjectionResult 暴露 riskAck 字段位（catalog 强制继续 ack 绑定 planId） | B2 | 待 B2 回收合并 |
| A4 | B4 | B2 回填 StoredField 三态枚举显示名 | B2 | 待 B2 回收合并 |
| A5 | B4 | B2 回填五级匹配链命名（B4 按 exact→canonical/alias→route→protocol→global→none 书写；B3 用 档案→exact→目录→规则→fuzzy——**两处粒度不同非冲突：B4 是 UI 链展示名，B3 是引擎级**，收拢时统一映射表） | B2/B3 | 收拢裁决 |
| A6 | B4 | B1 明确 controlAcknowledged 的判定与返回形态（未返回前 UI 显示「未验证」） | B1 | 待 B1 回收合并 |
| A7 | B4 | B5 消费 generation 绑定预览失效 + 并选状态机 | B5 | B5 已留接口位，收拢对表 |
| A8 | B4 | B2/B4 对齐 modelOverrides 出口互斥判据（B5 OQ-5 同源） | B2/B5 | 收拢裁决 |
| A9 | B3 | P0-05 fixture F1-F20 清单 | PLAN | 收拢采纳 |

## 主会话已裁事项（合并进 DESIGN-v2 时执行）

- R-N1：P0-02 echo 不需要 ./typert manifest（gateway SRC fallback，见 docs/p0-evidence-notes.md N1）；B1 若写了 manifest 必要性论述，合并时降级为 P2+ 项。
- R-N2：B4 工作台注册形态与 B1 的 settings.section 注册设计对齐（id=modelpilot.workbench；settings-models 是插件 id=models 的 section——ModelPilot 自挂 section 与 provider-card/footer 注入并存）。
- R-N3：五级链命名统一表（引擎名 ↔ UI 名）：local-profile→档案 / route-exact→exact / catalog→目录（含 canonical/alias） / user-rule→规则 / fuzzy→模糊。B3 §3 与 B4 §5 均以此为准。

## 待 B1/B2 回收后必查

1. B1 VersionCapabilities 是否含 nativeReasoningEditing（B4 §3 依赖）与 supportsConfigure。
2. B1 缓存布局是否与 B3 §1.2 的 models-dev-v1.json / last-known-good 一致。
3. B2 pi-ai 投影是否含 resolveModelReasoning 客户端预检复刻（写坏导致整路由解析失败的风险）。
4. B2 deepseek 投影 unsupported 拒绝（U4）。
5. B1/B2/B5 的 ledger 事件 schema 三处是否同构（以 B5 §8 为准，其余对齐）。
