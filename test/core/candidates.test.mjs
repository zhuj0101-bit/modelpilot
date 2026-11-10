// P1-02 tests: CandidateEngine 8-level synthesis + short-circuit semantics.

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { synthesizeCandidates } = await import(pathToFileURL(join(root, "src", "core", "candidates.js")).href);

test("full chain: profile > catalog > template > preset > default per field", () => {
  const result = synthesizeCandidates({
    profile: { contextState: "value", contextValue: 555555, budgetState: "value", budgetValue: 4444, inputState: "value", inputValue: ["text"], reasoningState: "value", reasoningValue: { mode: "effort", defaultLevel: "low" } },
    resolved: { context: 262144, inputModalities: ["text", "image"], reasoningControls: [{ kind: "effort", values: ["low", "high"] }] },
    template: { contextWindow: 999, outputBudget: 999, input: ["text"], reasoning: { mode: "inherit" } },
    preset: { contextWindow: 32768, outputBudget: 4096, input: ["text"] },
  });
  assert.equal(result.fields.contextWindow.candidate.value, 555555);
  assert.equal(result.fields.outputBudget.candidate.value, 4444);
  assert.equal(result.fields.input.candidate.via, "profile");
  assert.equal(result.fields.reasoning.candidate.via, "profile");
  assert.deepEqual(result.shortCircuited, []);
});

test("no profile: catalog context wins; budget skips catalog (capability≠budget)", () => {
  const result = synthesizeCandidates({
    resolved: { context: 262144, outputLimit: 65536, inputModalities: ["text"], reasoningControls: [{ kind: "effort", values: ["low", "medium", "high"] }] },
    preset: { contextWindow: 32768, outputBudget: 4096, input: ["text"] },
  });
  assert.equal(result.fields.contextWindow.candidate.value, 262144);
  assert.equal(result.fields.contextWindow.candidate.via, "catalog");
  // budget never inherits a catalog capability value
  assert.equal(result.fields.outputBudget.candidate.via, "preset");
  assert.equal(result.fields.input.candidate.value.join(), "text");
  assert.equal(result.fields.reasoning.candidate.value.mode, "effort");
  assert.equal(result.fields.reasoning.candidate.value.defaultLevel, "low");
});

test("touched short-circuit: late catalog does not override user edit", () => {
  const result = synthesizeCandidates({
    touched: new Set(["contextWindow"]),
    resolved: { context: 262144, inputModalities: ["text"] },
  });
  assert.deepEqual(result.shortCircuited, ["contextWindow"]);
  assert.ok(result.fields.contextWindow.shortCircuited);
});

test("locked short-circuit same as touched", () => {
  const result = synthesizeCandidates({ locked: new Set(["reasoning"]), resolved: { reasoningControls: [{ kind: "effort", values: ["low"] }] } });
  assert.ok(result.fields.reasoning.shortCircuited);
});

test("cleared field never autofills (a.md §3.B closed loop)", () => {
  const result = synthesizeCandidates({
    profile: { contextState: "cleared", budgetState: "inherit", inputState: "cleared" },
    resolved: { context: 262144, inputModalities: ["text", "image"] },
    preset: { contextWindow: 32768, outputBudget: 4096 },
  });
  assert.ok(result.fields.contextWindow.shortCircuited === false);
  // cleared → no candidate picked from any level for that field:
  assert.equal(result.fields.contextWindow.candidate, undefined);
  assert.equal(result.fields.input.candidate, undefined);
  // inherit → falls through to catalog
  assert.equal(result.fields.outputBudget.candidate.via, "preset");
});

test("unknown model: defaults still produce a proposal (unknown but not empty)", () => {
  const result = synthesizeCandidates({});
  assert.equal(result.fields.contextWindow.candidate, undefined); // no context default invented
  assert.equal(result.fields.outputBudget.candidate.via, "default-budget");
  assert.deepEqual(result.fields.input.candidate.value, ["text"]);
  assert.equal(result.fields.reasoning.candidate.value.mode, "inherit");
});

test("toggle-only reasoning maps to disabled policy", () => {
  const result = synthesizeCandidates({ resolved: { reasoningControls: [{ kind: "toggle" }] } });
  assert.equal(result.fields.reasoning.candidate.value.mode, "disabled");
});

test("input modalities filtered to host-supported set (pdf/audio kept in evidence, dropped from value)", () => {
  const result = synthesizeCandidates({ resolved: { inputModalities: ["text", "image", "pdf", "audio"] } });
  assert.deepEqual(result.fields.input.candidate.value, ["text", "image"]);
});
