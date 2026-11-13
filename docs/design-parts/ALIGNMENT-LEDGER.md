# 收拢对齐登记表（主会话裁决用）

## 跨章节依赖与对齐点

| # | 来源 | 要求 | 承接方 | 状态 |
| --- | --- | --- | --- | --- |
| A1 | B5 | B1 的 `SettingsWriter` 支持按命名空间粒度提交（档案命名空间失败时宿主侧标记为跳过） | B1 | 待 B1 回收合并 |
| A2 | B5 | B1「重试一次」定义为"重读 + 重定位 + 重算差异后重新提交"（不是重放操作序列） | B1 | 待 B1 回收合并 |
| A3 | B5 | B2 的 `ProjectionResult` 暴露 `riskAck` 字段位（目录强制继续的确认绑定 `planId`） | B2 | 待 B2 回收合并 |
| A4 | B4 | B2 回填 `StoredField` 三态枚举的显示名 | B2 | 待 B2 回收合并 |
| A5 | B4 | B2 回填五级匹配链命名（B4 按精确→规范化/别名→路由→协议→全局→无书写；B3 用档案→精确→目录→规则→模糊——**两处粒度不同并不冲突：B4 是界面链路展示名，B3 是引擎级**，收拢时统一映射表） | B2/B3 | 收拢裁决 |
| A6 | B4 | B1 明确 `controlAcknowledged` 的判定与返回形态（未返回前界面显示「未验证」） | B1 | 待 B1 回收合并 |
| A7 | B4 | B5 消费 `generation` 绑定预览失效 + 并选状态机 | B5 | B5 已留接口位，收拢对表 |
| A8 | B4 | B2/B4 对齐 `modelOverrides` 出口互斥的判据（B5 的 OQ-5 同源） | B2/B5 | 收拢裁决 |
| A9 | B3 | P0-05 `fixture` 的 F1-F20 清单 | PLAN | 收拢采纳 |

## 主会话已裁事项（合并进 DESIGN-v2 时执行）

- R-N1：P0-02 的 `echo` 不需要 `./typert` 清单（`gateway` 的源码回退，见 `docs/p0-evidence-notes.md` N1）；B1 若写了清单必要性论述，合并时降级为 P2+ 项。
- R-N2：B4 工作台注册形态与 B1 的 `settings.section` 注册设计对齐（`id=modelpilot.workbench`；`settings-models` 是插件 `id=models` 的 `section`——ModelPilot 自挂 `section` 与 provider-card/footer 注入并存）。
- R-N3：五级链命名统一表（引擎名 ↔ 界面名）：本地档案→档案／路由精确→精确／目录→目录（含规范化/别名）／用户规则→规则／模糊→模糊。B3 §3 与 B4 §5 均以此为准。

## 待 B1/B2 回收后必查

1. B1 的 `VersionCapabilities` 是否含 `nativeReasoningEditing`（B4 §3 依赖）与 `supportsConfigure`。
2. B1 的缓存布局是否与 B3 §1.2 的 `models-dev-v1.json`／最后可用快照（`last-known-good`）一致。
3. B2 的 `pi-ai` 投影是否含 `resolveModelReasoning` 的客户端预检复刻（写坏会让整条路由解析失败的风险）。
4. B2 的 `deepseek` 投影对 `unsupported` 的拒绝（U4）。
5. B1/B2/B5 的台账事件 `schema` 三处是否同构（以 B5 §8 为准，其余对齐）。