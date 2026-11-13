// P1-03 测试：pi-ai 投影（R1–R7 预检、互斥、闸门）。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { projectPiAi } = await import(pathToFileURL(join(root, "src", "core", "pi-ai-projection.js")).href);

const emptyHost = { providers: {} };
const handDeclared = { providers: { gw: {} } };
const catalogRoute = { providers: { gw: {} }, catalogModels: new Set(["cat-a", "cat-b"]) };
const routeWithModels = (rows) => ({ providers: { gw: { models: rows } } });

test("手工声明的空路由：在 models.0 处追加，无替换告警", () => {
  const result = projectPiAi({ id: "tflow/alpha", name: "Alpha", contextWindow: 131072, maxTokens: 8192 }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 1);
  assert.deepEqual(result.settingsOps[0].path, ["providers", "gw", "models", "0"]);
  assert.equal(result.settingsOps[0].value.id, "tflow/alpha");
  assert.ok(!result.warnings.some((w) => w.code === "catalog-replacement"));
  assert.ok(result.appliedFields.includes("contextWindow"));
});

test("目录路由：替换闸门在确认前扣留操作", () => {
  const result = projectPiAi({ id: "new-model" }, catalogRoute, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 0);
  const gate = result.warnings.find((w) => w.code === "catalog-replacement");
  assert.ok(gate, "gate present");
  assert.deepEqual(gate.removedCatalogIds, ["cat-a", "cat-b"]);
  assert.equal(gate.requiresAck, true);
  // 已确认 → 输出操作
  const acked = projectPiAi({ id: "new-model" }, catalogRoute, { routeId: "gw", ackedReplacement: true });
  assert.equal(acked.settingsOps.length, 1);
});

test("带模型的路由：在 String(length) 处追加，保留既有顺序", () => {
  const result = projectPiAi({ id: "m3" }, routeWithModels([{ id: "m1" }, { id: "m2" }]), { routeId: "gw" });
  assert.deepEqual(result.settingsOps[0].path, ["providers", "gw", "models", "2"]);
});

test("重复 id 拒绝（且大小写折叠给出告警）", () => {
  const dup = projectPiAi({ id: "m1" }, routeWithModels([{ id: "m1" }]), { routeId: "gw" });
  assert.equal(dup.settingsOps.length, 0);
  assert.ok(dup.unsupportedControls.some((u) => u.reason === "duplicate-model-id"));
  const caseDup = projectPiAi({ id: "M1" }, routeWithModels([{ id: "m1" }]), { routeId: "gw" });
  assert.ok(caseDup.warnings.some((w) => w.code === "duplicate-model-id-casefold"));
  assert.equal(caseDup.settingsOps.length, 1); // 告警不拒绝（宿主按字面匹配）
});

test("modelOverrides 与 models 通道冲突时拒绝", () => {
  const host = { providers: { gw: { modelOverrides: { "cat-a": { name: "x" } } } } };
  const result = projectPiAi({ id: "m" }, host, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.unsupportedControls.some((u) => u.reason === "overrides-channel-conflict"));
});

test("R 预检：非法 reasoningEfforts 字典丢弃全部操作（路由杀手守卫）", () => {
  // 仅 off 的字典 → 宿主会拒绝整个路由
  const result = projectPiAi({ id: "m", reasoning: { mode: "effort", levels: ["off"], defaultLevel: "off" } }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.unsupportedControls.some((u) => u.reason === "efforts-only-off"));
});

test("effort 字典：off:null + wire 值，显式列出时允许 xhigh", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "effort", levels: ["off", "low", "xhigh"] } }, handDeclared, { routeId: "gw" });
  const row = result.settingsOps[0]?.value;
  assert.deepEqual(row.reasoningEfforts, { off: null, low: "low", xhigh: "xhigh" });
});

test("wire 映射覆盖默认拼写（effort → 自定义 wire 值）", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "effort", levels: ["off", "high"], wireMap: { high: "reasoning_effort" } } }, handDeclared, { routeId: "gw" });
  assert.deepEqual(result.settingsOps[0].value.reasoningEfforts, { off: null, high: "reasoning_effort" });
});

test("禁用策略 → reasoningEfforts:false（非推理声明）", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "disabled" } }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps[0].value.reasoningEfforts, false);
});

test("预算策略 → 仅档案，不写 reasoningEfforts", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "budget", tokens: 4096 } }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps[0].value.reasoningEfforts, undefined);
  assert.ok(result.profileOnlyFields.includes("reasoningBudget"));
});

test("输入模态过滤为 text/image；未知键带告警丢弃", () => {
  const result = projectPiAi({ id: "m", input: ["text", "pdf"], customField: 1 }, handDeclared, { routeId: "gw" });
  assert.deepEqual(result.settingsOps[0].value.input, ["text"]);
  assert.ok(result.warnings.some((w) => w.code === "unknown-key-dropped" && /customField/.test(w.message)));
});

test("maxTokens 双身份告警存在", () => {
  const result = projectPiAi({ id: "m", maxTokens: 4096 }, handDeclared, { routeId: "gw" });
  assert.ok(result.warnings.some((w) => w.code === "max-tokens-dual-identity"));
});

test("上下文 input 语义告警", () => {
  const result = projectPiAi({ id: "m", contextWindow: 100000, contextSemantics: "input" }, handDeclared, { routeId: "gw" });
  assert.ok(result.warnings.some((w) => w.code === "context-input-semantics"));
});
