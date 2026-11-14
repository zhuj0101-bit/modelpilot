// 工单 #21：从目录新建路由的纯逻辑测试。
//
// 覆盖目录行整理 / 搜索、provider id 约束、三种目录状态（有目录 / 目录外 /
// 目录外但没写模型）下生成的唯一一条 set op，以及「密钥值绝不出现」这条
// 硬约束。DOM 交互在 test/client/new-route.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const repo = await import(pathToFileURL(join(root, "src", "core", "route-create.js")).href);
const {
  NEW_ROUTE_ERRORS,
  PROVIDER_ID_MAX_LENGTH,
  buildRouteCreatePlan,
  catalogKnowsProvider,
  defaultProtocolChoice,
  filterCatalogRows,
  normalizeModelIds,
  normalizeProviderId,
  routeCatalogRows,
} = repo;

const catalog = [
  { provider: "anthropic", displayName: "Anthropic", settingsNs: "llm-pi-ai", settingsPath: ["providers", "anthropic"], declared: false },
  { provider: "minimax-cn", displayName: "MiniMax CN", settingsNs: "llm-pi-ai", settingsPath: ["providers", "minimax-cn"], declared: false },
  { provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai", settingsPath: ["providers", "openai"], declared: false },
];

test("routeCatalogRows：只保留当前命名空间，已配置标灰的依据来自 existingIds", () => {
  const rows = routeCatalogRows(
    [
      ...catalog,
      { provider: "deepseek", displayName: "DeepSeek", settingsNs: "llm-deepseek", settingsPath: ["providers", "deepseek"] },
      { provider: "legacy", displayName: "Legacy", settingsPath: ["providers", "legacy"] },
    ],
    { settingsNs: "llm-pi-ai", existingIds: ["anthropic"] },
  );
  assert.deepEqual(rows.map((row) => row.provider), ["anthropic", "minimax-cn", "openai", "legacy"]);
  assert.equal(rows[0].configured, true);
  assert.equal(rows[1].configured, false);
  assert.equal(rows[3].configured, false);
});

test("routeCatalogRows：重复 provider 只保留第一条，displayName 缺失时回落到 id", () => {
  const rows = routeCatalogRows(
    [
      { provider: "anthropic", displayName: "Anthropic", settingsNs: "llm-pi-ai" },
      { provider: "anthropic", displayName: "重复项", settingsNs: "llm-pi-ai" },
      { provider: "minimax-cn", settingsNs: "llm-pi-ai" },
    ],
    { settingsNs: "llm-pi-ai" },
  );
  assert.deepEqual(rows.map((row) => row.provider), ["anthropic", "minimax-cn"]);
  assert.equal(rows[0].displayName, "Anthropic");
  assert.equal(rows[1].displayName, "minimax-cn");
});

test("filterCatalogRows：按 provider id 过滤，忽略大小写与首尾空白", () => {
  const rows = routeCatalogRows(catalog, { settingsNs: "llm-pi-ai" });
  assert.deepEqual(filterCatalogRows(rows, "  MINI ").map((row) => row.provider), ["minimax-cn"]);
  assert.deepEqual(filterCatalogRows(rows, "anthropic").map((row) => row.provider), ["anthropic"]);
  assert.equal(filterCatalogRows(rows, "no-such-provider").length, 0);
  assert.equal(filterCatalogRows(rows, "").length, rows.length);
});

test("catalogKnowsProvider：declared=true 表示目录描述不了，缺省 declared 按未知处理", () => {
  assert.equal(catalogKnowsProvider(catalog, "anthropic"), true);
  assert.equal(catalogKnowsProvider([{ provider: "relay", declared: true }], "relay"), false);
  assert.equal(catalogKnowsProvider([{ provider: "relay" }], "relay"), true);
  assert.equal(catalogKnowsProvider(catalog, ""), false);
});

test("normalizeProviderId：只去首尾空白，不改变大小写", () => {
  assert.equal(normalizeProviderId("  my-relay  "), "my-relay");
  assert.equal(normalizeProviderId(undefined), "");
});

test("provider id：小写字母 / 数字 / 连字符合法，长度上限 64", () => {
  const relay = { provider: "my-relay-01", displayName: "My Relay", settingsNs: "llm-pi-ai" };
  const ok = buildRouteCreatePlan({ mode: "catalog", providerId: "my-relay-01", catalog: [...catalog, relay], existingIds: [] });
  assert.equal(ok.ok, true);
  const long = "a".repeat(PROVIDER_ID_MAX_LENGTH);
  assert.equal(buildRouteCreatePlan({ mode: "catalog", providerId: long, catalog: [{ provider: long }] }).ok, true);
  const tooLong = "a".repeat(PROVIDER_ID_MAX_LENGTH + 1);
  const tooLongPlan = buildRouteCreatePlan({ mode: "catalog", providerId: tooLong, catalog: [{ provider: tooLong }] });
  assert.equal(tooLongPlan.ok, false);
  assert.equal(tooLongPlan.errors.providerId, NEW_ROUTE_ERRORS.providerIdFormat);
});

test("provider id：大写 / 下划线 / 点 / 前导连字符 / 空格都不合法，且不产出 op", () => {
  for (const providerId of ["My-Relay", "my_relay", "my.relay", "-relay", "my relay"]) {
    const plan = buildRouteCreatePlan({
      mode: "custom",
      providerId,
      baseURL: "https://relay.example.com/v1",
      modelIds: "m/one",
      catalog: [],
    });
    assert.equal(plan.ok, false, providerId);
    assert.equal(plan.op, null, providerId);
    assert.equal(plan.errors.providerId, NEW_ROUTE_ERRORS.providerIdFormat, providerId);
  }
});

test("provider id：空值报必填；与已存在路由重名报「该路由已存在」", () => {
  const empty = buildRouteCreatePlan({ mode: "custom", providerId: "   ", baseURL: "https://x.invalid/v1", catalog: [] });
  assert.equal(empty.errors.providerId, NEW_ROUTE_ERRORS.providerIdRequired);
  const duplicate = buildRouteCreatePlan({ mode: "catalog", providerId: "anthropic", catalog, existingIds: ["anthropic"] });
  assert.equal(duplicate.errors.providerId, NEW_ROUTE_ERRORS.providerIdExists);
  assert.equal(duplicate.op, null);
});

test("默认协议：优先 openai-completions，其次 schema 首项，最后内置白名单", () => {
  assert.equal(defaultProtocolChoice(["anthropic-messages", "openai-completions"]), "openai-completions");
  assert.equal(defaultProtocolChoice(["anthropic-messages", "openai-responses"]), "anthropic-messages");
  assert.equal(defaultProtocolChoice([]), "openai-completions");
  assert.equal(defaultProtocolChoice(undefined), "openai-completions");
});

test("normalizeModelIds：逗号 / 中文逗号 / 换行 / 空格分隔，去空去重", () => {
  assert.deepEqual(normalizeModelIds("m/one, m/two，m/three\nm/one  m/four"), ["m/one", "m/two", "m/three", "m/four"]);
  assert.deepEqual(normalizeModelIds(["m/one", "", " m/two ", "m/one"]), ["m/one", "m/two"]);
  assert.deepEqual(normalizeModelIds(""), []);
});

test("目录选择（目录里有）：恰好 1 条 set，value 不含 models", () => {
  const plan = buildRouteCreatePlan({ mode: "catalog", providerId: "anthropic", catalog, existingIds: [] });
  assert.equal(plan.ok, true);
  assert.equal(plan.catalogKnown, true);
  assert.deepEqual(plan.op, { op: "set", path: ["providers", "anthropic"], value: {} });
  assert.equal("models" in plan.op.value, false);
});

test("目录选择：provider id 不在目录里时拒绝，不产出 op", () => {
  const plan = buildRouteCreatePlan({ mode: "catalog", providerId: "not-listed", catalog, existingIds: [] });
  assert.equal(plan.ok, false);
  assert.equal(plan.op, null);
  assert.equal(plan.errors.providerId, NEW_ROUTE_ERRORS.providerIdNotInCatalog);
});

test("自定义（目录外）：1 条 set，value 含 models 且至少 1 条，密钥只写引用名", () => {
  const plan = buildRouteCreatePlan({
    mode: "custom",
    providerId: "my-relay",
    baseURL: " https://relay.example.com/v1 ",
    api: "openai-completions",
    apiKeyEnv: "MY_RELAY_API_KEY",
    modelIds: "relay/alpha, relay/beta",
    catalog,
    existingIds: [],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.catalogKnown, false);
  assert.deepEqual(plan.op, {
    op: "set",
    path: ["providers", "my-relay"],
    value: {
      api: "openai-completions",
      baseURL: "https://relay.example.com/v1",
      apiKeyEnv: "MY_RELAY_API_KEY",
      models: [{ id: "relay/alpha" }, { id: "relay/beta" }],
    },
  });
  const serialized = JSON.stringify(plan.op);
  assert.equal(serialized.includes("sk-"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("自定义（目录外）没有模型：拒绝并给出「自定义路由至少需要一条模型」", () => {
  const plan = buildRouteCreatePlan({
    mode: "custom",
    providerId: "my-relay",
    baseURL: "https://relay.example.com/v1",
    modelIds: " , ",
    catalog,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.op, null);
  assert.equal(plan.errors.models, NEW_ROUTE_ERRORS.modelsRequired);
});

test("自定义（目录里有）：不写 models，只写用户填的 baseURL / api / apiKeyEnv", () => {
  const plan = buildRouteCreatePlan({
    mode: "custom",
    providerId: "anthropic",
    baseURL: "https://relay.example.com/v1",
    api: "anthropic-messages",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelIds: "claude/one",
    catalog,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.catalogKnown, true);
  assert.deepEqual(plan.op.value, {
    api: "anthropic-messages",
    baseURL: "https://relay.example.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  });
  assert.equal("models" in plan.op.value, false);
});

test("自定义：接口地址为空 / 非 http(s):// 时拒绝，不产出 op", () => {
  for (const baseURL of ["", "   ", "ftp://relay.invalid/v1", "relay.invalid/v1", "//relay.invalid/v1"]) {
    const plan = buildRouteCreatePlan({
      mode: "custom",
      providerId: "my-relay",
      baseURL,
      modelIds: "relay/one",
      catalog,
    });
    assert.equal(plan.ok, false, baseURL);
    assert.equal(plan.op, null, baseURL);
    assert.equal(plan.errors.baseURL, NEW_ROUTE_ERRORS.baseURL, baseURL);
  }
  const upper = buildRouteCreatePlan({
    mode: "custom",
    providerId: "my-relay",
    baseURL: "HTTPS://relay.invalid/v1",
    modelIds: "relay/one",
    catalog,
  });
  assert.equal(upper.ok, true);
});

test("自定义：api / apiKeyEnv 留空时不写这两个键，baseURL 仍保留", () => {
  const plan = buildRouteCreatePlan({
    mode: "custom",
    providerId: "my-relay",
    baseURL: "http://127.0.0.1:8080/v1",
    api: "",
    apiKeyEnv: "",
    modelIds: "local/one",
    catalog: [],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.op.value, { baseURL: "http://127.0.0.1:8080/v1", models: [{ id: "local/one" }] });
});

test("任何成功计划都只有一条 set op，path 恰好是 providers/<id>", () => {
  const plans = [
    buildRouteCreatePlan({ mode: "catalog", providerId: "openai", catalog }),
    buildRouteCreatePlan({ mode: "custom", providerId: "relay-1", baseURL: "https://r.invalid/v1", modelIds: "m", catalog }),
    buildRouteCreatePlan({ mode: "custom", providerId: "anthropic", baseURL: "https://r.invalid/v1", catalog }),
  ];
  for (const plan of plans) {
    assert.equal(plan.ok, true);
    assert.equal(plan.op.op, "set");
    assert.equal(plan.op.path.length, 2);
    assert.equal(plan.op.path[0], "providers");
  }
});

test("existingIds 用 Set 也能查重（调用方可能传快照键集合）", () => {
  const plan = buildRouteCreatePlan({ mode: "catalog", providerId: "anthropic", catalog, existingIds: new Set(["anthropic"]) });
  assert.equal(plan.ok, false);
  assert.equal(plan.errors.providerId, NEW_ROUTE_ERRORS.providerIdExists);
});
