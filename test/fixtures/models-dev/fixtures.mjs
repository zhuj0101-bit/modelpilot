// F1–F20 固件矩阵（B3 §9）。每个用例：{id, doc, expect}。
// expect：针对解析输出求值的条目级断言。

export const FIXTURES = [
  // F1–F3：三种 reasoning_options 形态
  { id: "F1-effort", doc: { p: { id: "p", name: "P", api: "https://x/v1", models: { m: { id: "m", name: "M", reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high"] }], limit: { context: 1000, output: 500 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].kind === "effort" && r.entries[0].reasoning.controls[0].values.join() === "low,high" },
  { id: "F2-toggle", doc: { p: { id: "p", models: { m: { id: "m", reasoning: true, reasoning_options: [{ type: "toggle" }], limit: { context: 10, output: 5 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].kind === "toggle" },
  { id: "F3-budget", doc: { p: { id: "p", models: { m: { id: "m", reasoning: true, reasoning_options: [{ type: "budget_tokens", min: 1024 }], limit: { context: 10, output: 5 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].kind === "budget" && r.entries[0].reasoning.controls[0].min === 1024 && r.entries[0].reasoning.controls[0].max === null },
  // F4–F7：budget 最小/最大默认值变体
  { id: "F4-budget-no-min", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens" }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].min === null },
  { id: "F5-budget-min-max", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens", min: 128, max: 32768 }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].max === 32768 },
  { id: "F6-budget-max-only", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens", max: 24576 }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].min === null && r.entries[0].reasoning.controls[0].max === 24576 },
  { id: "F7-budget-zero-min", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens", min: 0, max: 100 }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].min === 0 },
  // F8：deprecated 状态
  { id: "F8-deprecated", doc: { p: { models: { m: { id: "m", status: "deprecated", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].status === "deprecated" },
  // F9：完全没有推理配置
  { id: "F9-no-reasoning", doc: { p: { models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls.length === 0 && r.entries[0].reasoning.reasoningFlag === false },
  // F10：存在 limit.input → 语义为 input
  { id: "F10-limit-input", doc: { p: { models: { m: { id: "m", limit: { context: 100, input: 50, output: 25 } } } } },
    expect: (r) => r.entries[0].contextSemantics === "input" },
  // F11：无 limit.input → combined
  { id: "F11-combined", doc: { p: { models: { m: { id: "m", limit: { context: 100, output: 25 } } } } },
    expect: (r) => r.entries[0].contextSemantics === "combined" },
  // F12：规范 id 悬空（canonical id 在任何处都不存在）
  { id: "F12-canonical-dangling", doc: { p: { models: { m: { id: "m", canonical_model_id: "vendor/ghost", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].canonicalModelId === "vendor/ghost" },
  // F13：大小写成对 id（下游的字面匹配区分大小写）
  { id: "F13-case-pair", doc: { p: { models: { "Model": { id: "Model", limit: { context: 1, output: 1 } }, "model": { id: "model", limit: { context: 2, output: 2 } } } } },
    expect: (r) => r.entries.length === 2 && r.entries[0].id !== r.entries[1].id },
  // F14：带后缀的 id 逐字保留
  { id: "F14-suffix-id", doc: { p: { models: { "m-2026-01-01": { id: "m-2026-01-01:free", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].id === "m-2026-01-01:free" },
  // F15：auto 别名不解析（原样保留）
  { id: "F15-auto-alias", doc: { p: { models: { auto: { id: "auto", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].id === "auto" },
  // F16–F18：畸形条目被跳过并计数
  { id: "F16-bad-model", doc: { p: { models: { good: { id: "good", limit: { context: 1, output: 1 } }, bad: "not-an-object" } } },
    expect: (r) => r.entries.length === 1 && r.errors.some((e) => e.code === "bad-model") },
  { id: "F17-provider-no-models", doc: { a: { id: "a" }, b: { id: "b", models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries.length === 1 && r.errors.some((e) => e.code === "provider-no-models") },
  { id: "F18-bad-provider", doc: { a: "junk", b: { models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries.length === 1 && r.errors.some((e) => e.code === "bad-provider") },
  // F19：根文档非法 → 结构性失败（调用方保留上一次已知良好值）
  { id: "F19-bad-root-array", doc: [1, 2, 3],
    expect: (r) => r.ok === false && r.errors[0].code === "bad-root" },
  // F20：摘要的稳定性/变化
  { id: "F20-digest", doc: { p: { models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r, aux) => r.digest === aux.sameDigest && r.digest !== aux.otherDigest },
];
