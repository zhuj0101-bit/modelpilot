// 工单 #32 第一批：路由级字段编辑与删除路由的纯逻辑测试。
//
// 验收核心：路由级写入只写叶子路径，绝不重建整个 route 对象；清空字段用
// unset；删除路由也必须先做 stale-route / last-route 守卫。这里不碰浏览器，
// 只对 src/core/route-edit.js 做单元断言。

import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const {
  CACHE_RETENTION_CHOICES,
  FALLBACK_API_PROTOCOLS,
  ROUTE_FIELD_DEFINITIONS,
  ROUTE_FIELD_KEYS,
  TRANSPORT_CHOICES,
  apiChoicesFromSchema,
  buildRouteDeleteOps,
  buildRouteEditOps,
  describeRouteSummary,
  routeDeleteBlockReason,
  routeFieldLabels,
  routeFormFromProvider,
  validateRouteForm,
} = await import(pathToFileURL(join(root, "src", "core", "route-edit.js")).href);

const ROUTE_ID = "preview-chat";

/** 九个字段全部声明、且带宿主未来字段的一条路由。 */
const provider = Object.freeze({
  displayName: "Preview Chat",
  baseURL: "https://preview.invalid/v1",
  api: "openai-completions",
  apiKeyEnv: "PREVIEW_CHAT_API_KEY",
  defaultContextWindow: 1000000,
  defaultMaxTokens: 32768,
  cacheRetention: "short",
  transport: "auto",
  timeoutMs: 60000,
  models: [{ id: "jxf/dsv4.1-flash" }, { id: "jxf/dsv4.1-pro" }],
  modelOverrides: { "jxf/dsv4.1-flash": { maxTokens: 1024 } },
  compat: { supportsReasoningEffort: true },
  futureHostField: { keep: ["exactly", "these"] },
});

/** 所有路径都必须落在 ["providers", routeId] 之下。 */
function assertRouteScoped(ops, routeId = ROUTE_ID) {
  for (const op of ops) {
    assert.equal(op.path[0], "providers", `op 不应写到 providers 之外：${JSON.stringify(op)}`);
    assert.equal(op.path[1], routeId, `op 不应写到别的路由：${JSON.stringify(op)}`);
  }
}

/** 没有任何一条 op 是对整条路由的 set（那会丢掉 models / compat / 未来字段）。 */
function assertNoWholeRouteSet(ops, routeId = ROUTE_ID) {
  for (const op of ops) {
    const wholeRoute = op.path.length === 2 && op.path[0] === "providers" && op.path[1] === routeId;
    assert.equal(
      wholeRoute && op.op === "set",
      false,
      `禁止对整条路由 set：${JSON.stringify(op)}`,
    );
  }
}

// ── 读取与展示 ─────────────────────────────────────────────────────────

test("routeFormFromProvider：九个字段预填路由上声明的值", () => {
  assert.deepEqual(routeFormFromProvider(provider), {
    displayName: "Preview Chat",
    baseURL: "https://preview.invalid/v1",
    api: "openai-completions",
    apiKeyEnv: "PREVIEW_CHAT_API_KEY",
    defaultContextWindow: "1000000",
    defaultMaxTokens: "32768",
    cacheRetention: "short",
    transport: "auto",
    timeoutMs: "60000",
  });
});

test("routeFormFromProvider：未声明字段显示空，不把宿主默认值当用户值", () => {
  const form = routeFormFromProvider({ models: [] });
  assert.deepEqual(form, {
    displayName: "",
    baseURL: "",
    api: "",
    apiKeyEnv: "",
    defaultContextWindow: "",
    defaultMaxTokens: "",
    cacheRetention: "",
    transport: "",
    timeoutMs: "",
  });
  // 非数字的 token 值 / 0 / 负数都不是合法声明，仍显示空。
  assert.equal(routeFormFromProvider({ defaultMaxTokens: "8192", defaultContextWindow: 0 }).defaultMaxTokens, "");
  assert.equal(routeFormFromProvider({ defaultContextWindow: -1 }).defaultContextWindow, "");
});

test("describeRouteSummary：输出上限 / 上下文 / 模型数", () => {
  assert.equal(describeRouteSummary(provider), "输出上限 33K · 上下文 1M · 2 个模型");
  assert.equal(
    describeRouteSummary({ models: [{ id: "only" }] }),
    "输出上限 未设置 · 上下文 未设置 · 1 个模型",
  );
  assert.equal(describeRouteSummary(undefined), "输出上限 未设置 · 上下文 未设置 · 0 个模型");
});

test("字段定义固定为九个，顺序与 labels 一致", () => {
  assert.deepEqual(ROUTE_FIELD_KEYS, [
    "displayName",
    "baseURL",
    "api",
    "apiKeyEnv",
    "defaultContextWindow",
    "defaultMaxTokens",
    "cacheRetention",
    "transport",
    "timeoutMs",
  ]);
  assert.equal(ROUTE_FIELD_DEFINITIONS.length, 9);
  assert.deepEqual(routeFieldLabels(["baseURL", "defaultMaxTokens"]), ["接口地址", "默认输出上限"]);
});

test("cacheRetention / transport 的取值清单与宿主 schema 一致", () => {
  assert.deepEqual([...CACHE_RETENTION_CHOICES], ["none", "short", "long"]);
  assert.deepEqual([...TRANSPORT_CHOICES], ["sse", "websocket", "websocket-cached", "auto"]);
});

// ── 校验 ───────────────────────────────────────────────────────────────

test("baseURL：http / https / 空串合法，ftp:// 与 abc 就地报错且不产出 op", () => {
  const base = routeFormFromProvider(provider);
  for (const value of ["http://preview.invalid/v1", "https://preview.invalid/v1", "  https://x  ", ""]) {
    assert.deepEqual(validateRouteForm({ ...base, baseURL: value }), {}, `合法值：${JSON.stringify(value)}`);
    const plan = buildRouteEditOps(ROUTE_ID, { ...base, baseURL: value }, provider);
    assert.deepEqual(plan.errors, {}, `合法值不应报错：${JSON.stringify(value)}`);
    // 只有值真的不同才产出 op；https://preview.invalid/v1 与现值为同一个值。
    assert.equal(plan.ops.length, value.trim() === provider.baseURL ? 0 : 1);
  }
  for (const value of ["ftp://x", "abc", "httpsx://y", "//preview.invalid", "http:/x"]) {
    const errors = validateRouteForm({ ...base, baseURL: value });
    assert.equal(errors.baseURL, "接口地址必须以 http:// 或 https:// 开头", `非法值：${value}`);
    const plan = buildRouteEditOps(ROUTE_ID, { ...base, baseURL: value }, provider);
    assert.deepEqual(plan.ops, [], `非法 baseURL 不应产出 op：${value}`);
    assert.equal(plan.errors.baseURL, "接口地址必须以 http:// 或 https:// 开头");
  }
});

test("数字字段：0 / -1 / abc / 1.5 / 空串以外的非法值都报错且整体不产出 op", () => {
  const base = routeFormFromProvider(provider);
  for (const field of ["defaultContextWindow", "defaultMaxTokens", "timeoutMs"]) {
    for (const value of ["0", "-1", "abc", "1.5", " 0 "]) {
      const plan = buildRouteEditOps(ROUTE_ID, { ...base, [field]: value }, provider);
      assert.equal(plan.errors[field], "请输入正整数", `${field}=${value}`);
      assert.deepEqual(plan.ops, [], `${field}=${value} 应整体拒绝，避免半套写入`);
    }
  }
  // 一个合法改动 + 一个非法字段：仍然整体拒绝。
  const mixed = buildRouteEditOps(ROUTE_ID, { ...base, baseURL: "https://next.invalid/v1", timeoutMs: "abc" }, provider);
  assert.deepEqual(mixed.ops, []);
  assert.deepEqual(Object.keys(mixed.errors), ["timeoutMs"]);
});

test("数字字段：合法正整数产出 number（不是字符串），空串表示清空", () => {
  const base = routeFormFromProvider(provider);
  const plan = buildRouteEditOps(
    ROUTE_ID,
    { ...base, defaultContextWindow: "128000", defaultMaxTokens: "8192", timeoutMs: "30000" },
    provider,
  );
  assert.deepEqual(plan.ops, [
    { op: "set", path: ["providers", ROUTE_ID, "defaultContextWindow"], value: 128000 },
    { op: "set", path: ["providers", ROUTE_ID, "defaultMaxTokens"], value: 8192 },
    { op: "set", path: ["providers", ROUTE_ID, "timeoutMs"], value: 30000 },
  ]);
  const cleared = buildRouteEditOps(ROUTE_ID, { ...base, defaultMaxTokens: "" }, provider);
  assert.deepEqual(cleared.ops, [{ op: "unset", path: ["providers", ROUTE_ID, "defaultMaxTokens"] }]);
});

// ── 合并式写入：只写叶子字段 ───────────────────────────────────────────

test("什么都没改 → 0 条 op，0 个改动字段", () => {
  const plan = buildRouteEditOps(ROUTE_ID, routeFormFromProvider(provider), provider);
  assert.deepEqual(plan.ops, []);
  assert.deepEqual(plan.changed, []);
  assert.deepEqual(plan.errors, {});
  assert.deepEqual(plan.warnings, []);
});

test("只改 baseURL → 恰好 1 条 set，path 是叶子字段", () => {
  const form = { ...routeFormFromProvider(provider), baseURL: "https://preview.invalid/v2" };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider);
  assert.deepEqual(plan.ops, [
    { op: "set", path: ["providers", ROUTE_ID, "baseURL"], value: "https://preview.invalid/v2" },
  ]);
  assert.deepEqual(plan.changed, ["baseURL"]);
  assertRouteScoped(plan.ops);
});

test("改 baseURL + defaultMaxTokens → 2 条 set，各是叶子路径", () => {
  const form = {
    ...routeFormFromProvider(provider),
    baseURL: "https://preview.invalid/v3",
    defaultMaxTokens: "16384",
  };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider);
  assert.deepEqual(plan.ops, [
    { op: "set", path: ["providers", ROUTE_ID, "baseURL"], value: "https://preview.invalid/v3" },
    { op: "set", path: ["providers", ROUTE_ID, "defaultMaxTokens"], value: 16384 },
  ]);
  assert.deepEqual(plan.changed, ["baseURL", "defaultMaxTokens"]);
});

test("清空 displayName → 恰好 1 条 unset（不是 set null）", () => {
  const form = { ...routeFormFromProvider(provider), displayName: "" };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider);
  assert.deepEqual(plan.ops, [{ op: "unset", path: ["providers", ROUTE_ID, "displayName"] }]);
  assert.deepEqual(plan.changed, ["displayName"]);
});

test("九个字段全改 → 9 条 set，全部是叶子路径", () => {
  const form = {
    displayName: "Renamed",
    baseURL: "http://renamed.invalid/v1",
    api: "anthropic-messages",
    apiKeyEnv: "RENAMED_API_KEY",
    defaultContextWindow: "128000",
    defaultMaxTokens: "8192",
    cacheRetention: "long",
    transport: "websocket",
    timeoutMs: "30000",
  };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider);
  assert.equal(plan.ops.length, 9);
  assert.deepEqual(plan.changed, ROUTE_FIELD_KEYS);
  for (const op of plan.ops) {
    assert.equal(op.op, "set");
    assert.equal(op.path.length, 3, `set 必须是叶子字段：${JSON.stringify(op)}`);
  }
  assert.deepEqual(plan.ops[2], { op: "set", path: ["providers", ROUTE_ID, "api"], value: "anthropic-messages" });
  assertRouteScoped(plan.ops);
});

test("九个字段全清 → 9 条 unset，全部是叶子路径", () => {
  const form = Object.fromEntries(ROUTE_FIELD_KEYS.map((key) => [key, ""]));
  const plan = buildRouteEditOps(ROUTE_ID, form, provider);
  assert.equal(plan.ops.length, 9);
  assert.ok(plan.ops.every((op) => op.op === "unset" && op.path.length === 3));
  assert.deepEqual(new Set(plan.ops.map((op) => op.path[2])), new Set(ROUTE_FIELD_KEYS));
  assertRouteScoped(plan.ops);
});

test("api / cacheRetention / transport 设值 → 3 条 set；清空 → 3 条 unset", () => {
  const base = routeFormFromProvider(provider);
  const setPlan = buildRouteEditOps(
    ROUTE_ID,
    { ...base, api: "azure-openai-responses", cacheRetention: "long", transport: "sse" },
    provider,
  );
  assert.deepEqual(setPlan.ops, [
    { op: "set", path: ["providers", ROUTE_ID, "api"], value: "azure-openai-responses" },
    { op: "set", path: ["providers", ROUTE_ID, "cacheRetention"], value: "long" },
    { op: "set", path: ["providers", ROUTE_ID, "transport"], value: "sse" },
  ]);
  const unsetPlan = buildRouteEditOps(ROUTE_ID, { ...base, api: "", cacheRetention: "", transport: "" }, provider);
  assert.deepEqual(unsetPlan.ops, [
    { op: "unset", path: ["providers", ROUTE_ID, "api"] },
    { op: "unset", path: ["providers", ROUTE_ID, "cacheRetention"] },
    { op: "unset", path: ["providers", ROUTE_ID, "transport"] },
  ]);
});

test("早已未声明的字段再留空 → 不产生多余的 unset", () => {
  const bare = { models: [] };
  const plan = buildRouteEditOps("gw", routeFormFromProvider(bare), bare);
  assert.deepEqual(plan.ops, []);
});

test("未知表单字段被忽略，不会写到 providers 之外", () => {
  const form = { ...routeFormFromProvider(provider), extraField: "nope", compat: { hacked: true } };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider);
  assert.deepEqual(plan.ops, []);
});

test("所有 op 都以 [\"providers\", routeId] 为前缀", () => {
  const scenarios = [
    { ...routeFormFromProvider(provider), baseURL: "https://next.invalid/v1" },
    { ...routeFormFromProvider(provider), displayName: "", timeoutMs: "" },
    Object.fromEntries(ROUTE_FIELD_KEYS.map((key) => [key, ""])),
  ];
  for (const form of scenarios) {
    const plan = buildRouteEditOps("another-route", form, { ...provider, id: "another-route" });
    assertRouteScoped(plan.ops, "another-route");
  }
});

test("任何 op 都不是对整条路由的 set（否则会丢 models / compat / 未来字段）", () => {
  const scenarios = [
    routeFormFromProvider(provider),
    { ...routeFormFromProvider(provider), baseURL: "https://next.invalid/v1", defaultMaxTokens: "16384" },
    Object.fromEntries(ROUTE_FIELD_KEYS.map((key) => [key, ""])),
    { ...routeFormFromProvider(provider), api: "anthropic-messages" },
  ];
  for (const form of scenarios) {
    const plan = buildRouteEditOps(ROUTE_ID, form, provider);
    assertNoWholeRouteSet(plan.ops);
    // 编辑 op 的 set 至少写到第 3 段（providers / routeId / field）。
    for (const op of plan.ops.filter((candidate) => candidate.op === "set")) {
      assert.ok(op.path.length >= 3, `set 必须是叶子：${JSON.stringify(op)}`);
    }
  }
});

test("携带 models / compat / futureHostField 的路由对象从不被整条读取或重写", () => {
  // 纯函数只读取九个字段；路由的其它内容连出现在 ops 里的机会都没有。
  const snapshot = JSON.stringify(provider);
  const form = { ...routeFormFromProvider(provider), baseURL: "https://next.invalid/v1" };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider);
  assert.equal(JSON.stringify(provider), snapshot, "输入对象必须保持不可变");
  assert.equal(JSON.stringify(plan.ops).includes("models"), false);
  assert.equal(JSON.stringify(plan.ops).includes("compat"), false);
  assert.equal(JSON.stringify(plan.ops).includes("futureHostField"), false);
});

// ── stale-route 守卫（编辑）───────────────────────────────────────────

test("编辑时路由已不存在 → stale-route 且不产出 op", () => {
  const form = routeFormFromProvider(provider);
  for (const missing of [undefined, null, [], "not-a-route"]) {
    const plan = buildRouteEditOps(ROUTE_ID, { ...form, baseURL: "https://next.invalid/v1" }, missing);
    assert.deepEqual(plan.ops, []);
    assert.equal(plan.warnings[0].code, "stale-route");
    assert.match(plan.warnings[0].message, /stale-route/);
  }
  const emptyId = buildRouteEditOps("", form, provider);
  assert.equal(emptyId.warnings[0].code, "stale-route");
});

// ── 删除路由 ───────────────────────────────────────────────────────────

test("删除路由 → 恰好 1 条 unset，path 是 [\"providers\", routeId]", () => {
  const plan = buildRouteDeleteOps(ROUTE_ID, {
    "preview-chat": provider,
    "backup-route": { models: [] },
  });
  assert.deepEqual(plan.ops, [{ op: "unset", path: ["providers", ROUTE_ID] }]);
  assert.deepEqual(plan.warnings, []);
});

test("删除已不存在的路由 → stale-route 告警且拒绝写入", () => {
  for (const providers of [undefined, {}, { "backup-route": { models: [] } }]) {
    const plan = buildRouteDeleteOps(ROUTE_ID, providers);
    assert.deepEqual(plan.ops, []);
    assert.equal(plan.warnings[0].code, "stale-route");
  }
});

test("只剩一个路由 → last-route 告警「至少要保留一个路由」", () => {
  const plan = buildRouteDeleteOps(ROUTE_ID, { "preview-chat": provider });
  assert.deepEqual(plan.ops, []);
  assert.equal(plan.warnings[0].code, "last-route");
  assert.equal(plan.warnings[0].message, "至少要保留一个路由");
});

test("routeDeleteBlockReason：1 个及以下禁用，2 个以上可删", () => {
  assert.equal(routeDeleteBlockReason(0), "至少要保留一个路由");
  assert.equal(routeDeleteBlockReason(1), "至少要保留一个路由");
  assert.equal(routeDeleteBlockReason(2), null);
  assert.equal(routeDeleteBlockReason(3), null);
});

// ── 协议清单：schema 优先，读不到时退回内置 ────────────────────────────

const schemaOps = Object.freeze({
  rehydrate: (serialized) => serialized,
  nodeAtPath: (root, path) => (
    path.length === 3 && path[0] === "providers" && path[2] === "api" ? root.apiNode : undefined
  ),
});

test("apiChoicesFromSchema：从 union 成员读协议，过滤非字符串并去重", () => {
  const namespaceSchema = {
    apiNode: {
      type: "union",
      list: [
        { value: "openai-completions" },
        { value: "anthropic-messages" },
        { value: "openai-completions" },
        { value: "" },
        { value: 42 },
        { value: "future-protocol" },
      ],
    },
  };
  const result = apiChoicesFromSchema(schemaOps, namespaceSchema);
  assert.equal(result.source, "schema");
  assert.deepEqual(result.choices, ["openai-completions", "anthropic-messages", "future-protocol"]);
});

test("apiChoicesFromSchema：读不到 schema / 路径不是 union / 抛错时退回内置七种", () => {
  const cases = [
    apiChoicesFromSchema(undefined, {}),
    apiChoicesFromSchema(schemaOps, undefined),
    apiChoicesFromSchema({}, {}),
    apiChoicesFromSchema(schemaOps, { apiNode: { type: "object" } }),
    apiChoicesFromSchema(schemaOps, { apiNode: { type: "union", list: [] } }),
    apiChoicesFromSchema(
      { rehydrate: () => ({}), nodeAtPath: () => { throw new Error("schema broken"); } },
      {},
    ),
  ];
  for (const result of cases) {
    assert.equal(result.source, "fallback");
    assert.deepEqual(result.choices, [...FALLBACK_API_PROTOCOLS]);
  }
  assert.equal(FALLBACK_API_PROTOCOLS.length, 7);
});

test("apiChoicesFromSchema：不修改传入的 schema 对象", () => {
  const namespaceSchema = { apiNode: { type: "union", list: [{ value: "openai-completions" }] } };
  const snapshot = JSON.stringify(namespaceSchema);
  apiChoicesFromSchema(schemaOps, namespaceSchema);
  assert.equal(JSON.stringify(namespaceSchema), snapshot);
});
