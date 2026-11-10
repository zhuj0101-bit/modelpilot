# P1 前置核证（B2-Q1/Q3/Q8 关闭）

## P1 执行纪要（2026-11-10）

- P1-01 IdentityResolver 7/7（L3 语义修正：canonicalModelId===rawModelId 也算 canonical 命中；L4 规则排序 exact>glob>route-only）。
- P1-02 CandidateEngine 8/8（**cleared 语义升级**：a.md §3.B 的"不再自动填"是全链条屏蔽，不只跳过 stored link——noAutofill 标志贯穿 decide()）。
- P1-03 pi-ai 投影器 13/13（R1–R7 预检、替换闸门 withheld-ops、互斥拒绝、casefold 警告不拒写）。
- P1-04/05 ApplyService 8/8（prepare 幂等 planId、unacked 闸门、profile-first、conflict 重试一次、指纹撤销外部修改拒覆盖）。
- P1-06 ProfileRepository 6/6（stale-write 单调版本守卫、cleared round-trip、路由隔离、%2F 转义）。
- 事故与修复：P0 提交时 src/sources/models-dev-v1.js 因目录整理被误删（测试进了 git、实现没进）——P1 全量回归暴露后重建。教训：整理目录后必须立即全量回归再提交。
- 全量回归 **90/90**。


## B2-Q1：mutate op 的 dict key 编码 — ✅ 关闭 [已核对-源码]

`applyPathOp`/`isVolatilePath` 以 **string[] 段**寻址（`schema.dict?.[key]` 直接查表，不做任何点号拆分）；`validatePaths` 的 `path.join(".")` 只用于**报错文案**，不影响寻址语义。因此：

- **dict key（providerId/模型 id）允许任意字符串，含 `.`、`/`、`:`、中文**——不需要转义。
- **ModelKey 复合键的百分号编码（B1-OQ4）只用于自有 ns 的存储键**（我们自己的 JSON 字段），与宿主写入路径无关；宿主路径直接用原始段。
- 结论：SettingsWriter 的 op path = `["providers", providerId, "models", String(i), field]`，providerId 原样。B1 设计中的"转义规则"限定在 ProfileRepository 存储键层。

## B2-Q3：deepseek thinking 与 reasoningEffort:off 优先级 — ✅ 关闭 [已核对-源码]

`dsh-llm-deepseek/lib/index.js`（0.2.1，两版同构）：

1. **Config 校验期**（L402）：`thinking === "disabled" && reasoningEffort !== undefined && reasoningEffort !== "off"` → 配置直接报错。即：disabled 与非 off effort 互斥，off 可以共存。
2. **请求期**（L1707）：`effort = options.reasoningEffort ?? defaults.reasoningEffort ?? (thinking === "disabled" ? "off" : "high")`——优先级：**显式请求 > 路由配置 > thinking 推导**（disabled→off，否则 high）。
3. **请求期校验**（L1708-1713）：effort ∈ {off,low,high,max}，且 `thinking==="disabled" && effort !== "off"` → UNSUPPORTED_REASONING_EFFORT。
4. **wire 形态**（L1720-1721）：`thinking: {type: effort==="off" ? "disabled" : "enabled"}` + effort 非 off 时 `output_config: {effort}`。

**投影规则定案**：deepseek 投影器的路由级 reasoning 输出**单值 reasoningEffort（off|low|high|max）**；`disabled` 语义 = `reasoningEffort: "off"`（宿主自己会把 off 翻译成 thinking disabled）。不写 `thinking` 字段（避免与 effort 冲突触发 L402 校验错）；用户选择 disabled → 投影为 off 并在 UI 注明"= thinking disabled"。

## B2-Q8：路由级 reasoning 叠加 — ✅ 关闭 [已核对-源码]

pi-ai 侧（audit 02-S3 已核）：`resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning)`——**请求显式 > 路由 reasoning 字段 > 模型默认**；模型级 reasoningEfforts dict 决定可选项集合。叠加语义安全：路由级 `reasoning` 只是缺省档，投影器写模型级 dict 不会被路由级覆盖（请求优先级在 dict 之上）。deepseek 侧同理（L1707 请求 > 路由）。**定案**：路由级 `reasoning` 字段投影默认不写（保持宿主现值），per-model 差异全部走模型级 dict（pi-ai）/依赖请求显式 effort（deepseek）。
