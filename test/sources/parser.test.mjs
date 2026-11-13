// P0-05：models.dev v1 解析器固件测试（F1–F20，B3 §9）。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const parser = await import(pathToFileURL(join(root, "src", "sources", "models-dev-v1.js")).href);
const { FIXTURES } = await import(pathToFileURL(join(root, "test", "fixtures", "models-dev", "fixtures.mjs")).href);

const f20 = FIXTURES.find((f) => f.id === "F20-digest");
const aux = {
  sameDigest: parser.contentDigest(JSON.stringify(f20.doc)),
  otherDigest: parser.contentDigest(JSON.stringify({ changed: true })),
};

for (const fixture of FIXTURES) {
  test(`解析器固件 ${fixture.id}`, () => {
    const text = JSON.stringify(fixture.doc);
    const result = parser.parseModelsDevV1(text);
    assert.equal(fixture.expect(result, aux), true, `fixture ${fixture.id} expectation failed: ${JSON.stringify(result).slice(0, 400)}`);
  });
}

test("非法 JSON 保留上一次已知良好路径（结构性失败，不抛错）", () => {
  const result = parser.parseModelsDevV1("{not json");
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "bad-json");
});

test("超限守卫：>maxProviders 时结构性拒绝", () => {
  const doc = {};
  for (let i = 0; i < 5001; i++) doc[`p${i}`] = { models: {} };
  const result = parser.parseModelsDevV1(JSON.stringify(doc));
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "too-many-providers");
});

test("reasoning_options 上限（maxReasoningOptions=8）", () => {
  const options = Array.from({ length: 12 }, (_, i) => ({ type: "toggle" }));
  const result = parser.parseModelsDevV1(JSON.stringify({ p: { models: { m: { id: "m", reasoning_options: options, limit: { context: 1, output: 1 } } } } }));
  assert.equal(result.entries[0].reasoning.controls.length, 8);
});

test("真实快照片段：llmtech 提供方带 effort 值解析", () => {
  // 依据抓取的 api.json 重建（补齐 U6）；转义下划线已清理。
  const excerpt = {
    llmtech: {
      id: "llmtech",
      env: ["LLMTECH_API_KEY"],
      api: "https://api.llmtech.eu/v1",
      name: "LLM Tech",
      models: {
        "nvidia/Qwen3.8-27B-NVFP4": {
          id: "nvidia/Qwen3.8-27B-NVFP4",
          name: "Qwen3.8 27B",
          family: "qwen",
          reasoning: true,
          reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "medium", "xhigh"] }],
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 262144, output: 32768 },
          cost: { input: 0.25, output: 2.09, cache_read: 0.04 },
          canonical_model_id: "alibaba/qwen3.8-27b",
        },
      },
    },
  };
  const result = parser.parseModelsDevV1(JSON.stringify(excerpt));
  assert.equal(result.ok, true);
  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.context, 262144);
  assert.equal(entry.contextSemantics, "combined");
  assert.equal(entry.outputLimit, 32768);
  assert.deepEqual(entry.inputModalities, ["text", "image"]);
  assert.equal(entry.reasoning.controls.length, 2);
  assert.equal(entry.canonicalModelId, "alibaba/qwen3.8-27b");
  assert.equal(entry.cost.input, 0.25);
});
