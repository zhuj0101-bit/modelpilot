// P1-03 tests: pi-ai projection (R1–R7 pre-check, mutual exclusion, gates).

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

test("hand-declared empty route: append at models.0, no replacement warning", () => {
  const result = projectPiAi({ id: "tflow/alpha", name: "Alpha", contextWindow: 131072, maxTokens: 8192 }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 1);
  assert.deepEqual(result.settingsOps[0].path, ["providers", "gw", "models", "0"]);
  assert.equal(result.settingsOps[0].value.id, "tflow/alpha");
  assert.ok(!result.warnings.some((w) => w.code === "catalog-replacement"));
  assert.ok(result.appliedFields.includes("contextWindow"));
});

test("catalog route: replacement gate withholds ops until acked", () => {
  const result = projectPiAi({ id: "new-model" }, catalogRoute, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 0);
  const gate = result.warnings.find((w) => w.code === "catalog-replacement");
  assert.ok(gate, "gate present");
  assert.deepEqual(gate.removedCatalogIds, ["cat-a", "cat-b"]);
  assert.equal(gate.requiresAck, true);
  // Acked → ops emitted
  const acked = projectPiAi({ id: "new-model" }, catalogRoute, { routeId: "gw", ackedReplacement: true });
  assert.equal(acked.settingsOps.length, 1);
});

test("route with models: append at String(length), preserving existing order", () => {
  const result = projectPiAi({ id: "m3" }, routeWithModels([{ id: "m1" }, { id: "m2" }]), { routeId: "gw" });
  assert.deepEqual(result.settingsOps[0].path, ["providers", "gw", "models", "2"]);
});

test("duplicate id refused (and casefold warned)", () => {
  const dup = projectPiAi({ id: "m1" }, routeWithModels([{ id: "m1" }]), { routeId: "gw" });
  assert.equal(dup.settingsOps.length, 0);
  assert.ok(dup.unsupportedControls.some((u) => u.reason === "duplicate-model-id"));
  const caseDup = projectPiAi({ id: "M1" }, routeWithModels([{ id: "m1" }]), { routeId: "gw" });
  assert.ok(caseDup.warnings.some((w) => w.code === "duplicate-model-id-casefold"));
  assert.equal(caseDup.settingsOps.length, 1); // warn, not refuse (host matches literally)
});

test("modelOverrides + models channel conflict refuses", () => {
  const host = { providers: { gw: { modelOverrides: { "cat-a": { name: "x" } } } } };
  const result = projectPiAi({ id: "m" }, host, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.unsupportedControls.some((u) => u.reason === "overrides-channel-conflict"));
});

test("R pre-check: bad reasoningEfforts dict drops ALL ops (route-killer guard)", () => {
  // only-off dict → host would refuse the whole route
  const result = projectPiAi({ id: "m", reasoning: { mode: "effort", levels: ["off"], defaultLevel: "off" } }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.unsupportedControls.some((u) => u.reason === "efforts-only-off"));
});

test("effort dict: off:null + wire values, xhigh allowed when explicitly listed", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "effort", levels: ["off", "low", "xhigh"] } }, handDeclared, { routeId: "gw" });
  const row = result.settingsOps[0]?.value;
  assert.deepEqual(row.reasoningEfforts, { off: null, low: "low", xhigh: "xhigh" });
});

test("wire map overrides default spelling (effort → custom wire value)", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "effort", levels: ["off", "high"], wireMap: { high: "reasoning_effort" } } }, handDeclared, { routeId: "gw" });
  assert.deepEqual(result.settingsOps[0].value.reasoningEfforts, { off: null, high: "reasoning_effort" });
});

test("disabled policy → reasoningEfforts:false (non-reasoning declaration)", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "disabled" } }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps[0].value.reasoningEfforts, false);
});

test("budget policy → profile-only, no reasoningEfforts write", () => {
  const result = projectPiAi({ id: "m", reasoning: { mode: "budget", tokens: 4096 } }, handDeclared, { routeId: "gw" });
  assert.equal(result.settingsOps[0].value.reasoningEfforts, undefined);
  assert.ok(result.profileOnlyFields.includes("reasoningBudget"));
});

test("input modalities filtered to text/image; unknown keys dropped with warning", () => {
  const result = projectPiAi({ id: "m", input: ["text", "pdf"], customField: 1 }, handDeclared, { routeId: "gw" });
  assert.deepEqual(result.settingsOps[0].value.input, ["text"]);
  assert.ok(result.warnings.some((w) => w.code === "unknown-key-dropped" && /customField/.test(w.message)));
});

test("maxTokens dual-identity warning present", () => {
  const result = projectPiAi({ id: "m", maxTokens: 4096 }, handDeclared, { routeId: "gw" });
  assert.ok(result.warnings.some((w) => w.code === "max-tokens-dual-identity"));
});

test("context input-semantics warning", () => {
  const result = projectPiAi({ id: "m", contextWindow: 100000, contextSemantics: "input" }, handDeclared, { routeId: "gw" });
  assert.ok(result.warnings.some((w) => w.code === "context-input-semantics"));
});
