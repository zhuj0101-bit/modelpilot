// F1–F20 fixture matrix (B3 §9). Each case: {id, doc, expect}.
// Expect: entry-level assertions evaluated against parse output.

export const FIXTURES = [
  // F1–F3: three reasoning_options shapes
  { id: "F1-effort", doc: { p: { id: "p", name: "P", api: "https://x/v1", models: { m: { id: "m", name: "M", reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high"] }], limit: { context: 1000, output: 500 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].kind === "effort" && r.entries[0].reasoning.controls[0].values.join() === "low,high" },
  { id: "F2-toggle", doc: { p: { id: "p", models: { m: { id: "m", reasoning: true, reasoning_options: [{ type: "toggle" }], limit: { context: 10, output: 5 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].kind === "toggle" },
  { id: "F3-budget", doc: { p: { id: "p", models: { m: { id: "m", reasoning: true, reasoning_options: [{ type: "budget_tokens", min: 1024 }], limit: { context: 10, output: 5 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].kind === "budget" && r.entries[0].reasoning.controls[0].min === 1024 && r.entries[0].reasoning.controls[0].max === null },
  // F4–F7: budget min/max default variants
  { id: "F4-budget-no-min", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens" }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].min === null },
  { id: "F5-budget-min-max", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens", min: 128, max: 32768 }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].max === 32768 },
  { id: "F6-budget-max-only", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens", max: 24576 }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].min === null && r.entries[0].reasoning.controls[0].max === 24576 },
  { id: "F7-budget-zero-min", doc: { p: { models: { m: { id: "m", reasoning_options: [{ type: "budget_tokens", min: 0, max: 100 }], limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls[0].min === 0 },
  // F8: deprecated status
  { id: "F8-deprecated", doc: { p: { models: { m: { id: "m", status: "deprecated", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].status === "deprecated" },
  // F9: no reasoning at all
  { id: "F9-no-reasoning", doc: { p: { models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].reasoning.controls.length === 0 && r.entries[0].reasoning.reasoningFlag === false },
  // F10: limit.input present → semantics input
  { id: "F10-limit-input", doc: { p: { models: { m: { id: "m", limit: { context: 100, input: 50, output: 25 } } } } },
    expect: (r) => r.entries[0].contextSemantics === "input" },
  // F11: no limit.input → combined
  { id: "F11-combined", doc: { p: { models: { m: { id: "m", limit: { context: 100, output: 25 } } } } },
    expect: (r) => r.entries[0].contextSemantics === "combined" },
  // F12: canonical dangling (canonical id not present anywhere)
  { id: "F12-canonical-dangling", doc: { p: { models: { m: { id: "m", canonical_model_id: "vendor/ghost", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].canonicalModelId === "vendor/ghost" },
  // F13: case-pair ids (literal match is case-sensitive downstream)
  { id: "F13-case-pair", doc: { p: { models: { "Model": { id: "Model", limit: { context: 1, output: 1 } }, "model": { id: "model", limit: { context: 2, output: 2 } } } } },
    expect: (r) => r.entries.length === 2 && r.entries[0].id !== r.entries[1].id },
  // F14: suffixed id preserved verbatim
  { id: "F14-suffix-id", doc: { p: { models: { "m-2026-01-01": { id: "m-2026-01-01:free", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].id === "m-2026-01-01:free" },
  // F15: auto alias not resolved (kept raw)
  { id: "F15-auto-alias", doc: { p: { models: { auto: { id: "auto", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries[0].id === "auto" },
  // F16–F18: malformed entries skipped, counted
  { id: "F16-bad-model", doc: { p: { models: { good: { id: "good", limit: { context: 1, output: 1 } }, bad: "not-an-object" } } },
    expect: (r) => r.entries.length === 1 && r.errors.some((e) => e.code === "bad-model") },
  { id: "F17-provider-no-models", doc: { a: { id: "a" }, b: { id: "b", models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries.length === 1 && r.errors.some((e) => e.code === "provider-no-models") },
  { id: "F18-bad-provider", doc: { a: "junk", b: { models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r) => r.entries.length === 1 && r.errors.some((e) => e.code === "bad-provider") },
  // F19: bad root document → structural fail (caller keeps last-known-good)
  { id: "F19-bad-root-array", doc: [1, 2, 3],
    expect: (r) => r.ok === false && r.errors[0].code === "bad-root" },
  // F20: digest stability/change
  { id: "F20-digest", doc: { p: { models: { m: { id: "m", limit: { context: 1, output: 1 } } } } },
    expect: (r, aux) => r.digest === aux.sameDigest && r.digest !== aux.otherDigest },
];
