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
  FALLBACK_MODALITIES,
  HOST_ROUTE_DEFAULT_FALLBACKS,
  ROUTE_DEFAULT_FIELDS,
  ROUTE_FIELD_DEFINITIONS,
  ROUTE_FIELD_KEYS,
  TRANSPORT_CHOICES,
  apiChoicesFromSchema,
  buildRouteDeleteOps,
  buildRouteEditOps,
  countRouteDefaultUsers,
  describeHostDefaultFallback,
  describeRouteDefaultCount,
  describeRouteDefaultInputUsage,
  describeRouteDefaultUsage,
  describeRouteSummary,
  modalityChoicesFromSchema,
  normalizeModalities,
  routeDefaultCountParts,
  routeDeleteBlockReason,
  routeFieldLabels,
  routeFormFromProvider,
  usesRouteDefault,
  usesRouteDefaultInput,
  validateModalityForm,
  validateRouteForm,
} = await import(pathToFileURL(join(root, "src", "core", "route-edit.js")).href);

const ROUTE_ID = "preview-chat";

/** 十个字段全部声明、且带宿主未来字段的一条路由。 */
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
  defaultInput: ["text"],
  models: [{ id: "jxf/dsv4.1-flash" }, { id: "jxf/dsv4.1-pro" }],
  modelOverrides: { "jxf/dsv4.1-flash": { maxTokens: 1024 } },
  compat: { supportsReasoningEffort: true },
  futureHostField: { keep: ["exactly", "these"] },
});

/** 十个字段全部清空的表单：模态字段用空数组（全部 chip 不选），不是空串。 */
function clearedForm() {
  return {
    ...Object.fromEntries(ROUTE_FIELD_KEYS.map((key) => [key, ""])),
    defaultInput: [],
  };
}

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

test("routeFormFromProvider：十个字段预填路由上声明的值", () => {
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
    defaultInput: ["text"],
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
    defaultInput: [],
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

// ── 路由默认值与模型声明的关系（工单 #34）────────────────────────────

test("usesRouteDefault：模型自己声明了字段 → 不受影响，另一个字段仍按各自声明判断", () => {
  assert.equal(usesRouteDefault({ id: "a", maxTokens: 8192 }), false);
  assert.equal(usesRouteDefault({ id: "a", contextWindow: 128000 }, undefined, "contextWindow"), false);
  // 只声明 contextWindow：窗口不受影响，输出上限仍受路由默认值影响。
  assert.equal(usesRouteDefault({ id: "a", contextWindow: 128000 }), true);
  assert.equal(usesRouteDefault({ id: "a", contextWindow: 128000 }, undefined, "contextWindow"), false);
});

test("usesRouteDefault：内置目录优先于路由默认值（Set 与宿主 Map 都支持）", () => {
  const catalog = new Set(["jxf/dsv4.1-flash"]);
  const undeclared = { id: "jxf/dsv4.1-flash" };
  assert.equal(usesRouteDefault(undeclared, catalog), false);
  assert.equal(usesRouteDefault(undeclared, catalog, "contextWindow"), false);
  assert.equal(usesRouteDefault(undeclared, new Map([["jxf/dsv4.1-flash", { maxTokens: 1 }]])), false);
  // 目录里没有的 id 仍然受路由默认值影响。
  assert.equal(usesRouteDefault({ id: "other/model" }, catalog), true);
  // 传 undefined / 非对象时按「没有目录事实」处理，不抛错。
  assert.equal(usesRouteDefault({ id: "other/model" }, undefined), true);
  assert.equal(usesRouteDefault(null, catalog), false);
});

test("countRouteDefaultUsers：两个字段各自统计，不合并成「是否完全声明」", () => {
  const models = [
    { id: "none-declared" },
    { id: "window-only", contextWindow: 128000 },
    { id: "both-declared", contextWindow: 200000, maxTokens: 8192 },
  ];
  const usage = countRouteDefaultUsers(models);
  assert.equal(usage.total, 3);
  assert.equal(usage.contextWindow.count, 1);
  assert.deepEqual(usage.contextWindow.models.map((model) => model.id), ["none-declared"]);
  assert.equal(usage.maxTokens.count, 2);
  assert.deepEqual(usage.maxTokens.models.map((model) => model.id), ["none-declared", "window-only"]);
});

test("countRouteDefaultUsers：内置目录里的 id 按字段排除，不影响另一个字段", () => {
  const models = [
    { id: "catalog-both" }, // 两个字段都由目录给
    { id: "custom-window-only", contextWindow: 128000 }, // 窗口自己声明，输出上限还没有
    { id: "custom" }, // 两个字段都没有声明
  ];
  const usage = countRouteDefaultUsers(models, new Set(["catalog-both"]));
  assert.equal(usage.contextWindow.count, 1);
  assert.deepEqual(usage.contextWindow.models.map((model) => model.id), ["custom"]);
  assert.equal(usage.maxTokens.count, 2);
  assert.deepEqual(usage.maxTokens.models.map((model) => model.id), ["custom-window-only", "custom"]);
});

test("countRouteDefaultUsers：没有模型时两个字段都没有受影响条目", () => {
  for (const models of [undefined, null, [], "not-an-array"]) {
    const usage = countRouteDefaultUsers(models);
    assert.equal(usage.total, 0);
    assert.deepEqual(usage.contextWindow, { count: 0, models: [] });
    assert.deepEqual(usage.maxTokens, { count: 0, models: [] });
  }
  // 总数与界面上「N 个模型」一致；非对象条目不参与计数，也不会抛错。
  const mixed = countRouteDefaultUsers([null, { id: "ok" }, "not-a-model"]);
  assert.equal(mixed.total, 3);
  assert.equal(mixed.maxTokens.count, 1);
  assert.deepEqual(mixed.maxTokens.models.map((model) => model.id), ["ok"]);
});

test("describeRouteDefaultUsage：每条写清未声明什么，并标注另一个字段已声明", () => {
  assert.equal(describeRouteDefaultUsage({ id: "a" }), "未声明 contextWindow / maxTokens");
  assert.equal(
    describeRouteDefaultUsage({ id: "a", contextWindow: 128000 }),
    "未声明 maxTokens（已声明 contextWindow）",
  );
  assert.equal(
    describeRouteDefaultUsage({ id: "a", maxTokens: 8192 }),
    "未声明 contextWindow（已声明 maxTokens）",
  );
  assert.equal(
    describeRouteDefaultUsage({ id: "a", contextWindow: 128000, maxTokens: 8192 }),
    "已声明 contextWindow / maxTokens",
  );
});

test("describeRouteDefaultCount：全部 / 部分 / 全部不受影响 / 没有模型 四种状态", () => {
  assert.equal(describeRouteDefaultCount("defaultContextWindow", 0, 0), null);
  assert.equal(describeRouteDefaultCount("defaultMaxTokens", 0, 0), null);
  assert.equal(
    describeRouteDefaultCount("defaultContextWindow", 3, 3),
    "默认上下文：当前路由 3 个模型全部使用这两个值。",
  );
  assert.equal(
    describeRouteDefaultCount("defaultMaxTokens", 3, 2),
    "默认输出上限：当前路由 3 个模型中有 2 个会使用这两个值。",
  );
  assert.equal(
    describeRouteDefaultCount("defaultMaxTokens", 3, 0),
    "默认输出上限：当前路由 3 个模型都已声明自己的值，这两个输入框不影响它们。",
  );
  // 部分状态拆成三段：界面把中间那段「2 个」做成就地展开按钮。
  assert.deepEqual(routeDefaultCountParts("defaultMaxTokens", 3, 2), {
    prefix: "默认输出上限：当前路由 3 个模型中有 ",
    countText: "2 个",
    suffix: "会使用这两个值。",
  });
  assert.equal(routeDefaultCountParts("defaultMaxTokens", 3, 3).countText, null);
  assert.equal(routeDefaultCountParts("defaultMaxTokens", 0, 0), null);
});

test("routeDefaultCountParts：未知字段直接报错，不拼出没有标签的句子", () => {
  assert.throws(() => routeDefaultCountParts("defaultTopK", 3, 1), /未知的路由默认值字段/);
});

test("describeHostDefaultFallback：留空回落到内置常量 / text，而不是「不限制」", () => {
  assert.equal(
    describeHostDefaultFallback("defaultContextWindow"),
    "默认上下文：留空 → 宿主使用内置默认值 1,000,000（1M）",
  );
  assert.equal(
    describeHostDefaultFallback("defaultMaxTokens"),
    "默认输出上限：留空 → 宿主使用内置默认值 128,000（128K）",
  );
  assert.equal(
    describeHostDefaultFallback("defaultInput"),
    "默认输入模态：留空 → 宿主使用内置默认值 text（未声明 input 的模型按纯文本处理）",
  );
  assert.equal(describeHostDefaultFallback("defaultTopK"), null);
  assert.deepEqual(HOST_ROUTE_DEFAULT_FALLBACKS, {
    defaultContextWindow: 1_000_000,
    defaultMaxTokens: 128_000,
    defaultInput: ["text"],
  });
  assert.deepEqual(
    ROUTE_DEFAULT_FIELDS.map((field) => [field.key, field.modelField, field.kind]),
    [
      ["defaultContextWindow", "contextWindow", "token"],
      ["defaultMaxTokens", "maxTokens", "token"],
      ["defaultInput", "input", "modalities"],
    ],
  );
});

// ── defaultInput：多选模态（工单 #22）─────────────────────────────────

test("normalizeModalities：按候选顺序排、去重、丢非字符串，未知值按原顺序补在末尾", () => {
  assert.deepEqual(normalizeModalities(["image", "text"], ["text", "image"]), ["text", "image"]);
  assert.deepEqual(normalizeModalities(["text", "text", "image"], ["text", "image"]), ["text", "image"]);
  assert.deepEqual(normalizeModalities(["audio", "image", "text"], ["text", "image"]), ["text", "image", "audio"]);
  assert.deepEqual(normalizeModalities([" audio ", "image"], ["text", "image"]), ["image", "audio"]);
  assert.deepEqual(normalizeModalities([3, null, "", "  ", "text"], ["text", "image"]), ["text"]);
  assert.deepEqual(normalizeModalities(undefined), []);
  assert.deepEqual(normalizeModalities("text"), []);
  assert.deepEqual(FALLBACK_MODALITIES, ["text", "image"]);
});

test("routeFormFromProvider：defaultInput 预填声明的模态并按候选顺序归一化，未声明为 []", () => {
  assert.deepEqual(routeFormFromProvider({ defaultInput: ["image", "text"] }).defaultInput, ["text", "image"]);
  assert.deepEqual(routeFormFromProvider({ defaultInput: [] }).defaultInput, []);
  assert.deepEqual(routeFormFromProvider({ defaultInput: "text" }).defaultInput, []);
  // 旧 schema 认识、当前候选清单没有的模态不被静默丢掉。
  assert.deepEqual(routeFormFromProvider({ defaultInput: ["audio", "text"] }).defaultInput, ["text", "audio"]);
});

test("defaultInput：选 text + image → 1 条 set 叶子路径，value 是数组", () => {
  const form = { ...routeFormFromProvider(provider), defaultInput: ["text", "image"] };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider, { modalities: ["text", "image"] });
  assert.deepEqual(plan.ops, [
    { op: "set", path: ["providers", ROUTE_ID, "defaultInput"], value: ["text", "image"] },
  ]);
  assert.deepEqual(plan.changed, ["defaultInput"]);
  assertRouteScoped(plan.ops);
  assertNoWholeRouteSet(plan.ops);
});

test("defaultInput：全部取消选择 → 1 条 unset，不是 set []（宿主拒绝空数组）", () => {
  for (const selection of [[], undefined, null, "", "image"]) {
    const form = { ...routeFormFromProvider(provider), defaultInput: selection };
    const plan = buildRouteEditOps(ROUTE_ID, form, provider, { modalities: ["text", "image"] });
    assert.deepEqual(
      plan.ops,
      [{ op: "unset", path: ["providers", ROUTE_ID, "defaultInput"] }],
      `选择：${JSON.stringify(selection)}`,
    );
  }
});

test("defaultInput：写入顺序按候选清单排，不按点击顺序", () => {
  const base = routeFormFromProvider({ ...provider, defaultInput: ["image"] });
  // 先点 image（本来就有）再点 text，表单里 text 追加在末尾；产出仍按白名单顺序。
  const form = { ...base, defaultInput: normalizeModalities([...base.defaultInput, "text"], ["text", "image"]) };
  assert.deepEqual(form.defaultInput, ["text", "image"]);
  const plan = buildRouteEditOps(ROUTE_ID, form, { ...provider, defaultInput: ["image"] }, { modalities: ["text", "image"] });
  assert.deepEqual(plan.ops, [
    { op: "set", path: ["providers", ROUTE_ID, "defaultInput"], value: ["text", "image"] },
  ]);
});

test("defaultInput：与路由原值做结构比较，集合相同（顺序不同）不产出 op", () => {
  const swapped = Object.freeze({ ...provider, defaultInput: ["image", "text"] });
  const plan = buildRouteEditOps(ROUTE_ID, routeFormFromProvider(swapped), swapped, {
    modalities: ["text", "image"],
  });
  assert.deepEqual(plan.ops, []);
  assert.deepEqual(plan.changed, []);
  // 引用不同但元素相同：同样不算改动。
  const sameCopy = Object.freeze({ ...provider, defaultInput: ["text"] });
  assert.deepEqual(
    buildRouteEditOps(ROUTE_ID, routeFormFromProvider(provider), sameCopy, { modalities: ["text", "image"] }).ops,
    [],
  );
});

test("defaultInput：路由上已有空数组 → 表单全部不选 → 1 条 unset（空数组不算声明）", () => {
  const emptyArray = Object.freeze({ ...provider, defaultInput: [] });
  const plan = buildRouteEditOps(ROUTE_ID, routeFormFromProvider(emptyArray), emptyArray, {
    modalities: ["text", "image"],
  });
  assert.deepEqual(plan.ops, [{ op: "unset", path: ["providers", ROUTE_ID, "defaultInput"] }]);
});

test("defaultInput：未知模态拒绝写入；路由上已声明的未来模态允许原样保留", () => {
  const form = { ...routeFormFromProvider(provider), defaultInput: ["text", "future-modality"] };
  const rejected = buildRouteEditOps(ROUTE_ID, form, provider, { modalities: ["text", "image"] });
  assert.equal(rejected.errors.defaultInput, "存在未知的输入模态：future-modality");
  assert.deepEqual(rejected.ops, [], "整体拒绝，避免半套写入");

  const withFuture = Object.freeze({ ...provider, defaultInput: ["text", "future-modality"] });
  const kept = buildRouteEditOps(ROUTE_ID, routeFormFromProvider(withFuture), withFuture, {
    modalities: ["text", "image"],
  });
  assert.deepEqual(kept.errors, {});
  assert.deepEqual(kept.ops, [], "已声明的现有值不算用户的新选择，不产出 op");
  assert.deepEqual(validateModalityForm(routeFormFromProvider(withFuture), withFuture, ["text", "image"]), {});
});

test("usesRouteDefaultInput：声明了 input（含空数组）或目录描述 → 不受路由默认值影响", () => {
  const catalog = new Set(["catalog/model"]);
  assert.equal(usesRouteDefaultInput({ id: "a" }), true);
  assert.equal(usesRouteDefaultInput({ id: "a", input: [] }), false, "空数组也是明确声明");
  assert.equal(usesRouteDefaultInput({ id: "a", input: ["text"] }), false);
  assert.equal(usesRouteDefaultInput({ id: "catalog/model" }, catalog), false);
  assert.equal(usesRouteDefaultInput({ id: "custom" }, catalog), true);
  assert.equal(usesRouteDefaultInput(null, catalog), false);
});

test("countRouteDefaultUsers：第三个字段 input 独立计数，空数组算已声明", () => {
  const models = [
    { id: "undeclared" },
    { id: "empty-array", input: [] },
    { id: "declared", input: ["text", "image"] },
    { id: "tokens-only", contextWindow: 128000, maxTokens: 8192 },
  ];
  const usage = countRouteDefaultUsers(models);
  assert.equal(usage.total, 4);
  assert.equal(usage.input.count, 2);
  assert.deepEqual(usage.input.models.map((model) => model.id), ["undeclared", "tokens-only"]);
  // 只声明 token 字段的模型：输入模态受影响、输出上限不受影响（互不合并）。
  assert.equal(usage.maxTokens.count, 3);
  assert.equal(usage.maxTokens.models.includes(models[3]), false, "tokens-only 声明了 maxTokens");
  assert.equal(usage.input.models.includes(models[3]), true, "tokens-only 没声明 input");
  // 目录描述的 id 同样排除在 input 计数之外。
  const withCatalog = countRouteDefaultUsers(models, new Set(["tokens-only"]));
  assert.deepEqual(withCatalog.input.models.map((model) => model.id), ["undeclared"]);
  // 没有模型时三个字段都是空计数。
  assert.deepEqual(countRouteDefaultUsers([]).input, { count: 0, models: [] });
});

test("countRouteDefaultUsers：只声明 input 的模型在模态计数里不受影响、在输出上限计数里受影响", () => {
  const models = [
    { id: "input-only", input: ["text", "image"] },
    { id: "tokens-only", contextWindow: 128000, maxTokens: 8192 },
  ];
  const usage = countRouteDefaultUsers(models);
  assert.equal(usage.input.count, 1);
  assert.deepEqual(usage.input.models.map((model) => model.id), ["tokens-only"]);
  assert.equal(usage.maxTokens.count, 1);
  assert.deepEqual(usage.maxTokens.models.map((model) => model.id), ["input-only"]);
});

test("describeRouteDefaultInputUsage：写清 input 未声明 / 空数组 / 已声明", () => {
  assert.equal(describeRouteDefaultInputUsage({ id: "a" }), "未声明 input（路由默认值生效）");
  assert.equal(describeRouteDefaultInputUsage({ id: "a", input: [] }), "已声明 input（空数组：一个模态都不开）");
  assert.equal(describeRouteDefaultInputUsage({ id: "a", input: ["text", "image"] }), "已声明 input（text / image）");
});

test("routeDefaultCountParts / describeRouteDefaultCount：模态字段用自己的措辞", () => {
  assert.equal(
    describeRouteDefaultCount("defaultInput", 3, 3),
    "默认输入模态：当前路由 3 个模型全部使用这个默认值。",
  );
  assert.equal(
    describeRouteDefaultCount("defaultInput", 3, 2),
    "默认输入模态：当前路由 3 个模型中有 2 个会使用这个默认值。",
  );
  assert.equal(
    describeRouteDefaultCount("defaultInput", 3, 0),
    "默认输入模态：当前路由 3 个模型都已声明自己的模态，这个多选项不影响它们。",
  );
  assert.deepEqual(routeDefaultCountParts("defaultInput", 3, 2), {
    prefix: "默认输入模态：当前路由 3 个模型中有 ",
    countText: "2 个",
    suffix: "会使用这个默认值。",
  });
  assert.equal(routeDefaultCountParts("defaultInput", 0, 0), null);
});

test("modalityChoicesFromSchema：从 array.inner 的 union 读模态，过滤非字符串并去重", () => {
  const modalSchemaOps = {
    rehydrate: (serialized) => serialized,
    nodeAtPath: (root, path) => {
      if (path.length === 3 && path[0] === "providers" && path[2] === "defaultInput") return root.input;
      if (path.length === 1 && path[0] === "0" && root?.type === "array") return root.inner;
      return undefined;
    },
  };
  const namespaceSchema = {
    input: {
      type: "array",
      inner: {
        type: "union",
        list: [
          { value: "text" },
          { value: "image" },
          { value: "text" },
          { value: "" },
          { value: 42 },
          { value: "audio" },
        ],
      },
    },
  };
  const snapshot = JSON.stringify(namespaceSchema);
  assert.deepEqual(modalityChoicesFromSchema(modalSchemaOps, namespaceSchema), {
    choices: ["text", "image", "audio"],
    source: "schema",
  });
  assert.equal(JSON.stringify(namespaceSchema), snapshot, "不修改传入的 schema 对象");

  const broken = [
    modalityChoicesFromSchema(undefined, {}),
    modalityChoicesFromSchema(modalSchemaOps, undefined),
    modalityChoicesFromSchema({}, {}),
    modalityChoicesFromSchema(modalSchemaOps, { input: { type: "union", list: [{ value: "text" }] } }),
    modalityChoicesFromSchema(modalSchemaOps, { input: { type: "array" } }),
    modalityChoicesFromSchema(modalSchemaOps, { input: { type: "array", inner: { type: "union", list: [] } } }),
    modalityChoicesFromSchema(
      { rehydrate: () => ({}), nodeAtPath: () => { throw new Error("schema broken"); } },
      {},
    ),
  ];
  for (const result of broken) {
    assert.deepEqual(result, { choices: [...FALLBACK_MODALITIES], source: "fallback" });
  }
});

test("字段定义固定为十个，defaultInput 追加在末尾，顺序与 labels 一致", () => {
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
    "defaultInput",
  ]);
  assert.equal(ROUTE_FIELD_DEFINITIONS.length, 10);
  assert.deepEqual(ROUTE_FIELD_DEFINITIONS[9], { key: "defaultInput", label: "默认输入模态", kind: "modalities" });
  assert.deepEqual(routeFieldLabels(["baseURL", "defaultMaxTokens", "defaultInput"]), ["接口地址", "默认输出上限", "默认输入模态"]);
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

test("十个字段全改 → 10 条 set，全部是叶子路径", () => {
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
    defaultInput: ["text", "image"],
  };
  const plan = buildRouteEditOps(ROUTE_ID, form, provider, { modalities: ["text", "image"] });
  assert.equal(plan.ops.length, 10);
  assert.deepEqual(plan.changed, ROUTE_FIELD_KEYS);
  for (const op of plan.ops) {
    assert.equal(op.op, "set");
    assert.equal(op.path.length, 3, `set 必须是叶子字段：${JSON.stringify(op)}`);
  }
  assert.deepEqual(plan.ops[2], { op: "set", path: ["providers", ROUTE_ID, "api"], value: "anthropic-messages" });
  assert.deepEqual(plan.ops[9], {
    op: "set",
    path: ["providers", ROUTE_ID, "defaultInput"],
    value: ["text", "image"],
  });
  assertRouteScoped(plan.ops);
});

test("十个字段全清 → 10 条 unset，全部是叶子路径", () => {
  const form = clearedForm();
  const plan = buildRouteEditOps(ROUTE_ID, form, provider, { modalities: ["text", "image"] });
  assert.equal(plan.ops.length, 10);
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
    clearedForm(),
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
    clearedForm(),
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
  // 纯函数只读取十个字段；路由的其它内容连出现在 ops 里的机会都没有。
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
