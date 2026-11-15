// 工单 #24：全部路由总览的纯规则测试（排序 / 引用名 / 分批 / 三态 / 摘要）。
//
// 这些断言不碰浏览器：分批上限、去重和「未知 ≠ 未配置」是宿主契约，
// 应该在纯层就钉死；真实 DOM 下的行文案与切换在 route-overview.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import {
  DESCRIBE_BATCH_SIZE,
  OVERVIEW_KEY_TEXT,
  buildRouteOverview,
  compareRouteIds,
  credentialCellOf,
  credentialStateOf,
  describeBatches,
  describeOverviewSummary,
  overviewCredentialRefs,
  routeCredentialRef,
} from "../../src/core/route-overview.js";

const route = (overrides = {}) => ({ api: "openai-completions", models: [], ...overrides });

test("批量上限与宿主 MAX_DESCRIBE_REFS 一致：64", () => {
  assert.equal(DESCRIBE_BATCH_SIZE, 64);
});

test("路由引用名：apiKeyEnv 非空时原样使用（首尾空白不算名字的一部分）", () => {
  assert.equal(routeCredentialRef("route-a", route({ apiKeyEnv: "CUSTOM_KEY" })), "CUSTOM_KEY");
  assert.equal(routeCredentialRef("route-a", route({ apiKeyEnv: "  SPACED_KEY  " })), "SPACED_KEY");
});

test("路由引用名：apiKeyEnv 缺失 / 空 / 纯空白 → 回落 deriveKeyRef(routeId)", () => {
  assert.equal(routeCredentialRef("beta-relay", route()), "BETA_RELAY_API_KEY");
  assert.equal(routeCredentialRef("beta-relay", route({ apiKeyEnv: "" })), "BETA_RELAY_API_KEY");
  assert.equal(routeCredentialRef("beta-relay", route({ apiKeyEnv: "   " })), "BETA_RELAY_API_KEY");
  assert.equal(routeCredentialRef("My--Route.v2", route()), "MY_ROUTE_V2_API_KEY");
});

test("路由 id 字母序与 Object.keys 的插入顺序无关", () => {
  const providers = {
    zeta: route(),
    alpha: route(),
    "9route": route(),
    Beta: route(),
  };
  assert.deepEqual(
    buildRouteOverview(providers).map((row) => row.id),
    ["9route", "Beta", "alpha", "zeta"],
  );
  assert.deepEqual(
    Object.keys(providers),
    ["zeta", "alpha", "9route", "Beta"],
    "输入顺序未变，输出仍排序",
  );
  assert.ok(compareRouteIds("a", "b") < 0);
  assert.ok(compareRouteIds("b", "a") > 0);
  assert.equal(compareRouteIds("a", "a"), 0);
});

test("总览行读取模型数：models 数组长度；缺失 / 非数组按 0", () => {
  const providers = {
    "two-models": route({ models: [{ id: "a" }, { id: "b" }] }),
    "no-models": route({ models: undefined }),
    "bad-models": route({ models: null }),
    "catalog-route": { api: "openai-completions" },
  };
  const rows = buildRouteOverview(providers);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId["two-models"].modelCount, 2);
  assert.equal(byId["no-models"].modelCount, 0);
  assert.equal(byId["bad-models"].modelCount, 0);
  assert.equal(byId["catalog-route"].modelCount, 0);
});

test("总览行读取协议：空 / 非字符串 → 空串（渲染层显示「未指定」）", () => {
  const rows = buildRouteOverview({
    a: route({ api: "anthropic-messages" }),
    b: route({ api: "" }),
    c: route({ api: undefined }),
    d: route({ api: 42 }),
  });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.a.api, "anthropic-messages");
  assert.equal(byId.b.api, "");
  assert.equal(byId.c.api, "");
  assert.equal(byId.d.api, "");
});

test("非对象 providers 不抛错：返回空清单", () => {
  for (const value of [undefined, null, [], "providers", 7]) {
    assert.deepEqual(buildRouteOverview(value), []);
  }
});

test("引用名去重：同一引用被多条路由共用时只查一次，保留首次出现顺序", () => {
  const rows = buildRouteOverview({
    alpha: route({ apiKeyEnv: "SHARED_KEY" }),
    beta: route({ apiKeyEnv: "BETA_KEY" }),
    gamma: route({ apiKeyEnv: "SHARED_KEY" }),
    delta: route(),
  });
  assert.deepEqual(
    overviewCredentialRefs(rows),
    ["SHARED_KEY", "BETA_KEY", "DELTA_API_KEY"],
  );
});

test("分批：0 个 ref 不发请求；1 / 64 个各 1 批", () => {
  assert.deepEqual(describeBatches([]), []);
  assert.deepEqual(describeBatches(["A"]), [["A"]]);
  const sixtyFour = Array.from({ length: 64 }, (_, index) => `KEY_${index}`);
  const batches = describeBatches(sixtyFour);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], sixtyFour);
});

test("分批：65 个 ref → 恰好 2 批（64 + 1）", () => {
  const refs = Array.from({ length: 65 }, (_, index) => `KEY_${index}`);
  const batches = describeBatches(refs);
  assert.deepEqual(batches.map((batch) => batch.length), [64, 1]);
  assert.deepEqual(batches.flat(), refs, "不丢不重，顺序不变");
});

test("分批：128 个 ref → 恰好 2 批（64 + 64）", () => {
  const refs = Array.from({ length: 128 }, (_, index) => `KEY_${index}`);
  const batches = describeBatches(refs);
  assert.deepEqual(batches.map((batch) => batch.length), [64, 64]);
  assert.equal(new Set(batches.flat()).size, 128);
});

test("分批：非正 / 非法 batch 大小退回 64，不产生空批", () => {
  const refs = ["A", "B"];
  for (const size of [0, -1, 1.5, Number.NaN, "64", null]) {
    assert.deepEqual(describeBatches(refs, size), [["A", "B"]], String(size));
  }
});

test("三态判定：configured 严格布尔；缺失 / 非布尔 → 未知（不是未配置）", () => {
  assert.equal(credentialStateOf("A", { A: { configured: true } }), "configured");
  assert.equal(credentialStateOf("A", { A: { configured: false } }), "unconfigured");
  assert.equal(credentialStateOf("A", { A: {} }), "unknown");
  assert.equal(credentialStateOf("A", { A: { configured: "true" } }), "unknown");
  assert.equal(credentialStateOf("A", {}), "unknown");
  assert.equal(credentialStateOf("A", undefined), "unknown");
  assert.equal(credentialStateOf("A", null), "unknown");
});

test("单元格字形：● / ○ / ?，loading 时是 … 且文案为读取中", () => {
  const configured = credentialCellOf("A", { A: { configured: true } });
  const unconfigured = credentialCellOf("A", { A: { configured: false } });
  const unknown = credentialCellOf("A", {});
  assert.deepEqual(configured, { kind: "configured", glyph: "●", text: "已配置" });
  assert.deepEqual(unconfigured, { kind: "unconfigured", glyph: "○", text: "未配置" });
  assert.deepEqual(unknown, { kind: "unknown", glyph: "?", text: "未知" });
  assert.deepEqual(
    credentialCellOf("A", {}, { loading: true }),
    { kind: "loading", glyph: "…", text: "正在读取密钥状态…" },
  );
  assert.equal(OVERVIEW_KEY_TEXT.loading, "正在读取密钥状态…");
});

test("摘要：尚未展开时只报条数，不伪造密钥状态", () => {
  const rows = buildRouteOverview({ a: route(), b: route() });
  assert.equal(describeOverviewSummary(rows, {}, "idle"), "全部路由（2 条）");
  assert.equal(describeOverviewSummary(rows, {}, "error"), "全部路由（2 条）");
});

test("摘要：加载中只说正在读取，不出现「未配置」", () => {
  const rows = buildRouteOverview({ a: route(), b: route() });
  const text = describeOverviewSummary(rows, {}, "loading");
  assert.equal(text, "全部路由（2 条 · 正在读取密钥状态…）");
  assert.ok(!text.includes("未配"));
});

test("摘要：ready 时输出「N 条 · X 条密钥已配 · Y 条未配」", () => {
  const rows = buildRouteOverview({
    a: route({ apiKeyEnv: "A_KEY" }),
    b: route({ apiKeyEnv: "B_KEY" }),
    c: route({ apiKeyEnv: "C_KEY" }),
    d: route({ apiKeyEnv: "D_KEY" }),
    e: route(),
  });
  const info = {
    A_KEY: { configured: true },
    B_KEY: { configured: true },
    C_KEY: { configured: true },
    D_KEY: { configured: true },
    E_API_KEY: { configured: false },
  };
  assert.equal(
    describeOverviewSummary(rows, info, "ready"),
    "全部路由（5 条 · 4 条密钥已配 · 1 条未配）",
  );
});

test("摘要：未知行单独计数，不混进「未配」", () => {
  const rows = buildRouteOverview({ a: route({ apiKeyEnv: "A_KEY" }), b: route({ apiKeyEnv: "B_KEY" }) });
  const text = describeOverviewSummary(rows, { A_KEY: { configured: true } }, "partial");
  assert.equal(text, "全部路由（2 条 · 1 条密钥已配 · 0 条未配 · 1 条未知）");
  assert.ok(!text.includes("1 条未配"), "未知不能显示成未配");
});

test("总览构建不修改 providers（输入不可变）", () => {
  const providers = { a: route({ apiKeyEnv: "A_KEY" }), b: route() };
  const before = JSON.stringify(providers);
  buildRouteOverview(providers);
  overviewCredentialRefs(buildRouteOverview(providers));
  assert.equal(JSON.stringify(providers), before);
});
