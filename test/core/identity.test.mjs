// P1-01 测试：身份解析器五级链。

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

test("L1 本地档案：精确存储键以高置信度胜出", () => {
  const sources = baseSources();
  const key = modelKeyStorageKey({ connectionId: "llm-pi-ai", driverId: "pi-ai", routeId: "gw", protocol: "openai-completions", rawModelId: "m1" });
  sources.profiles.set(key, { key, contextState: "value", contextValue: 123 });
  const result = resolveIdentity(sources, { routeId: "gw", rawModelId: "m1", protocol: "openai-completions" });
  assert.equal(result.level, "local-profile");
  assert.equal(result.evidence.confidence, "high");
  assert.equal(result.matched.contextValue, 123);
});

test("L2 路由精确：命中路由目录", () => {
  const result = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "route-m1" });
  assert.equal(result.level, "route-exact");
  assert.equal(result.matched.id, "route-m1");
});

test("L3 目录规范 id 跳转：请求给出规范 id，条目持有不同的 modelId", () => {
  const result = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "Vendor/Model-Y-Canonical" });
  assert.equal(result.level, "catalog");
  assert.equal(result.evidence.via, "canonical");
  assert.equal(result.evidence.confidence, "high");
  assert.ok(result.alternatives.some((a) => a.via === "canonical" && a.id === "vendor/model-y"));
});

test("L3 目录大小写折叠：大小写不敏感回退，中等置信度", () => {
  const result = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "vendor/model-x" });
  assert.equal(result.level, "catalog");
  assert.equal(result.evidence.confidence, "medium");
  assert.equal(result.matched.id, "Vendor/Model-X");
});

test("L4 用户规则：通配与精确，先命中者胜出，其余作为备选", () => {
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
  // 路由不匹配则排除该规则
  const other = resolveIdentity(sources, { routeId: "other", rawModelId: "m-free" });
  assert.equal(other.level, "user-rule");
  assert.equal(other.matched.id, "r1");
});

test("L5 模糊：子串候选，auto/free 绝不猜测", () => {
  const fuzzy = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "long-model" });
  assert.equal(fuzzy.level, "fuzzy");
  assert.equal(fuzzy.matched, undefined);
  assert.ok(fuzzy.alternatives.some((a) => a.id === "some-long-model-name"));
  const auto = resolveIdentity(baseSources(), { routeId: "gw", rawModelId: "auto" });
  assert.equal(auto.evidence.note, "dynamic alias, never guessed");
  assert.equal(auto.alternatives.length, 0);
});

test("未知路由+id：模糊层级且备选为空（未知但不为空的建议）", () => {
  const result = resolveIdentity(baseSources(), { routeId: "nope", rawModelId: "zzz" });
  assert.equal(result.level, "fuzzy");
  assert.equal(result.evidence.status, "unknown");
});
