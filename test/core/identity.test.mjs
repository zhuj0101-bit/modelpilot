// P1-01 tests: IdentityResolver five-level chain.

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { modelKeyStorageKey } from "../../src/core/domain.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { resolveIdentity } = await import(pathToFileURL(join(root, "src", "core", "identity.js")).href);

function baseSources() {
  return {
    connectionId: "llm-pi-ai",
    driverId: "pi-ai",
    profiles: new Map(),
    catalog: {
      route: { models: [{ id: "route-m1", name: "Route M1", contextWindow: 1000 }] },
      providerEntries: [
        { providerId: "p", modelId: "Vendor/Model-X", canonicalModelId: undefined, entry: { id: "Vendor/Model-X", contextWindow: 2000 } },
        { providerId: "p", modelId: "vendor/model-y", canonicalModelId: "Vendor/Model-Y-Canonical", entry: { id: "vendor/model-y", contextWindow: 3000 } },
        { providerId: "p", modelId: "some-long-model-name", canonicalModelId: undefined, entry: { id: "some-long-model-name" } },
      ],
    },
    rules: [],
  };
}

test("L1 local-profile: exact storage key wins with high confidence", () => {
  const sources = baseSources();
  const key = modelKeyStorageKey({ connectionId: "llm-pi-ai", driverId: "pi-ai", routeId: "gw", protocol: "openai-completions", rawModelId: "m1" });
  sources.profiles.set(key, { key, contextState: "value", contextValue: 123 });
  const result = resolveIdentity(sources, { routeId: "gw", rawModelId: "m1", protocol: "openai-completions" });
  assert.equal(result.level, "local-profile");
  assert.equal(result.evidence.confidence, "high");
  assert.equal(result.matched.contextValue, 123);
});

test("L2 route-exact: route catalog hit", () => {
  const result = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "route-m1" });
  assert.equal(result.level, "route-exact");
  assert.equal(result.matched.id, "route-m1");
});

test("L3 catalog canonical hop: request names canonical id, entry has different modelId", () => {
  const result = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "Vendor/Model-Y-Canonical" });
  assert.equal(result.level, "catalog");
  assert.equal(result.evidence.via, "canonical");
  assert.equal(result.evidence.confidence, "high");
  assert.ok(result.alternatives.some((a) => a.via === "canonical" && a.id === "vendor/model-y"));
});

test("L3 catalog casefold: case-insensitive fallback, medium confidence", () => {
  const result = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "vendor/model-x" });
  assert.equal(result.level, "catalog");
  assert.equal(result.evidence.confidence, "medium");
  assert.equal(result.matched.id, "Vendor/Model-X");
});

test("L4 user rule: glob and exact, first wins, rest are alternatives", () => {
  const sources = baseSources();
  sources.rules = [
    { id: "r1", matchRawModelId: "m-*", usePresetId: "coding" },
    { id: "r2", matchRouteId: "gw", matchRawModelId: "m-free", usePresetId: "basic" },
  ];
  const exact = resolveIdentity(sources, { routeId: "gw", rawModelId: "m-free" });
  assert.equal(exact.level, "user-rule");
  assert.equal(exact.matched.id, "r2");
  const glob = resolveIdentity(sources, { routeId: "gw", rawModelId: "m-2026-01" });
  assert.equal(glob.matched.id, "r1");
  // route mismatch excludes the rule
  const other = resolveIdentity(sources, { routeId: "other", rawModelId: "m-free" });
  assert.equal(other.level, "user-rule");
  assert.equal(other.matched.id, "r1");
});

test("L5 fuzzy: substring candidates, auto/free never guessed", () => {
  const fuzzy = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "long-model" });
  assert.equal(fuzzy.level, "fuzzy");
  assert.equal(fuzzy.matched, undefined);
  assert.ok(fuzzy.alternatives.some((a) => a.id === "some-long-model-name"));
  const auto = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "auto" });
  assert.equal(auto.evidence.note, "dynamic alias, never guessed");
  assert.equal(auto.alternatives.length, 0);
});

test("unknown route+id: fuzzy level with empty alternatives (unknown but not empty proposal)", () => {
  const result = resolveIdentity(baseSources(), { routeId: "nope", rawModelId: "zzz" });
  assert.equal(result.level, "fuzzy");
  assert.equal(result.evidence.status, "unknown");
});
