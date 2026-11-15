// 工单 #26 一期：pi-ai 投影的 edit / remove 模式。
//
// 验收核心：合并式写入。以现有行为基底，只覆盖真正变化的字段；compat 与
// 宿主未来新增的字段必须逐字节原样保留。create 模式的既有行为由
// test/projection/pi-ai-projection.test.mjs 与 golden 断言共同兜住。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { projectPiAi } = await import(pathToFileURL(join(root, "src", "core", "pi-ai-projection.js")).href);
const { describeModelRow, diffRow, formFromModel } = await import(
  pathToFileURL(join(root, "src", "core", "model-edit.js")).href
);
const { humanizeTokenCount } = await import(pathToFileURL(join(root, "src", "core", "domain.js")).href);

const routeOf = (models) => ({ providers: { gw: { models } } });

const existingRow = Object.freeze({
  id: "jxf/dsv4.1-pro",
  name: "jxf/dsv4.1-pro",
  contextWindow: 1000000,
  maxTokens: 32768,
  input: ["text"],
  reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
  compat: {
    supportsReasoningEffort: true,
    supportsToolChoice: false,
    nested: { keep: ["exactly", "these"] },
  },
  futureHostField: { untouched: 42 },
});

// ── 编辑（update）────────────────────────────────────────────────────────

test("update：只改 maxTokens 产出 1 条 set，路径是原下标，其余字段逐字节不变", () => {
  const host = routeOf([existingRow]);
  const result = projectPiAi({ id: existingRow.id, maxTokens: 65536 }, host, {
    routeId: "gw",
    mode: "update",
    index: 0,
  });

  assert.equal(result.settingsOps.length, 1);
  assert.equal(result.settingsOps[0].op, "set");
  assert.deepEqual(result.settingsOps[0].path, ["providers", "gw", "models", "0"]);
  assert.equal(result.settingsOps[0].value.maxTokens, 65536);

  // 除 maxTokens 外，所有字段与原行逐字节相同（包括 compat / futureHostField）。
  const expected = { ...existingRow, maxTokens: 65536 };
  assert.equal(JSON.stringify(result.settingsOps[0].value), JSON.stringify(expected));
  assert.deepEqual(result.settingsOps[0].value.compat, existingRow.compat);
  assert.deepEqual(result.settingsOps[0].value.futureHostField, { untouched: 42 });
  assert.equal(result.unsupportedControls.length, 0);
});

test("update：compat 在最深层也原样保留（事实 1 的验证）", () => {
  const host = routeOf([existingRow]);
  const result = projectPiAi({ id: existingRow.id, contextWindow: 200000 }, host, {
    routeId: "gw",
    mode: "update",
    index: 0,
  });
  assert.equal(result.settingsOps.length, 1);
  assert.deepEqual(result.settingsOps[0].value.compat, existingRow.compat);
  assert.equal(JSON.stringify(result.settingsOps[0].value.compat), JSON.stringify(existingRow.compat));
});

test("update：草稿携带未变化字段时也只覆盖真正变化的字段", () => {
  const host = routeOf([existingRow]);
  const full = {
    id: existingRow.id,
    name: existingRow.name,
    contextWindow: existingRow.contextWindow,
    maxTokens: 48000,
    input: ["text"],
    reasoning: { mode: "effort", levels: ["off", "low", "medium", "high"] },
  };
  const result = projectPiAi(full, host, { routeId: "gw", mode: "update", index: 0 });
  assert.equal(result.settingsOps.length, 1);
  const value = result.settingsOps[0].value;
  assert.equal(value.maxTokens, 48000);
  assert.equal(value.name, existingRow.name);
  assert.deepEqual(value.input, existingRow.input);
  assert.deepEqual(value.reasoningEfforts, existingRow.reasoningEfforts);
  assert.equal(JSON.stringify({ ...value, maxTokens: 32768 }), JSON.stringify(existingRow));
});

test("update：下标失效（id 不匹配）产出 stale-index 并拒绝写入", () => {
  const host = routeOf([existingRow, { id: "other/model" }]);
  const result = projectPiAi({ id: existingRow.id, maxTokens: 1024 }, host, {
    routeId: "gw",
    mode: "update",
    index: 1,
  });
  assert.equal(result.settingsOps.length, 0);
  const warning = result.warnings.find((item) => item.code === "stale-index");
  assert.ok(warning, "stale-index warning");
  assert.match(warning.message, /other\/model/);
  assert.ok(result.unsupportedControls.some((item) => item.reason === "stale-index"));
});

test("update：越界 / 负数 / 非整数下标都拒绝为 stale-index", () => {
  const host = routeOf([existingRow]);
  for (const index of [1, -1, 0.5, "0", undefined, Number.NaN]) {
    const result = projectPiAi({ id: existingRow.id, maxTokens: 1024 }, host, {
      routeId: "gw",
      mode: "update",
      index,
    });
    assert.equal(result.settingsOps.length, 0, `index=${String(index)}`);
    assert.ok(result.warnings.some((item) => item.code === "stale-index"), `index=${String(index)}`);
  }
});

test("update：没有字段变化时不产出 op（什么都不改就别写）", () => {
  const host = routeOf([existingRow]);
  const result = projectPiAi({ id: existingRow.id }, host, { routeId: "gw", mode: "update", index: 0 });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.warnings.some((item) => item.code === "no-change"));
});

test("update：路由没有 models 数组时拒绝为 stale-index", () => {
  const result = projectPiAi({ id: "m", maxTokens: 1 }, { providers: { gw: {} } }, {
    routeId: "gw",
    mode: "update",
    index: 0,
  });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.warnings.some((item) => item.code === "stale-index"));
});

// ── 清空字段（工单 #38）─────────────────────────────────────────────────
//
// unset 不走逐字段 unset op：模型行是数组里的一项，删键必须让新对象里不存在
// 该属性。写入沿用与 moveModel / planBulkFields / confirmDelete 相同的
// 「一条 set 整数组」，并且原样保留 compat 与宿主未来字段。

test("update + unset：清空 contextWindow → 一条整数组 set，该键从行里消失", () => {
  const host = routeOf([existingRow, { id: "other/model" }]);
  const result = projectPiAi({ id: existingRow.id }, host, {
    routeId: "gw",
    mode: "update",
    index: 0,
    unset: ["contextWindow"],
  });

  assert.equal(result.settingsOps.length, 1);
  const op = result.settingsOps[0];
  assert.equal(op.op, "set");
  assert.deepEqual(op.path, ["providers", "gw", "models"]);
  assert.equal(op.value.length, 2);
  assert.equal("contextWindow" in op.value[0], false);
  assert.deepEqual(op.value[0].compat, existingRow.compat);
  assert.deepEqual(op.value[0].futureHostField, { untouched: 42 });
  assert.deepEqual(op.value[1], { id: "other/model" });
  assert.ok(!result.settingsOps.some((item) => item.op === "unset"), "不允许逐字段 unset");
  assert.ok(result.appliedFields.includes("contextWindow"));
});

test("update + unset：清空 maxTokens 与修改 contextWindow 合并为一条整数组 set", () => {
  const host = routeOf([existingRow]);
  const result = projectPiAi({ id: existingRow.id, contextWindow: 262144 }, host, {
    routeId: "gw",
    mode: "update",
    index: 0,
    unset: ["maxTokens"],
  });

  assert.equal(result.settingsOps.length, 1);
  const value = result.settingsOps[0].value[0];
  assert.equal(value.contextWindow, 262144);
  assert.equal("maxTokens" in value, false);
  assert.deepEqual(value.compat, existingRow.compat);
});

test("update + unset：现有行本来没有该字段 → no-change，不发多余的写入", () => {
  const bare = { id: "bare/model" };
  const result = projectPiAi({ id: bare.id }, routeOf([bare]), {
    routeId: "gw",
    mode: "update",
    index: 0,
    unset: ["contextWindow", "maxTokens"],
  });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.warnings.some((item) => item.code === "no-change"));
});

test("update + unset：白名单外的字段 / id 不会被删除", () => {
  const host = routeOf([existingRow]);
  const result = projectPiAi({ id: existingRow.id }, host, {
    routeId: "gw",
    mode: "update",
    index: 0,
    unset: ["compat", "futureHostField", "id"],
  });
  assert.equal(result.settingsOps.length, 0);
  assert.ok(result.warnings.some((item) => item.code === "no-change"));
});

// ── 删除（remove）────────────────────────────────────────────────────────

test("remove：用 1 条 set 重写整个 models 数组，长度减一，绝不用 unset", () => {
  const host = routeOf([existingRow, { id: "b" }, { id: "c" }]);
  const result = projectPiAi({}, host, { routeId: "gw", mode: "remove", index: 1 });
  assert.equal(result.settingsOps.length, 1);
  assert.equal(result.settingsOps[0].op, "set");
  assert.deepEqual(result.settingsOps[0].path, ["providers", "gw", "models"]);
  assert.deepEqual(result.settingsOps[0].value, [existingRow, { id: "c" }]);
  assert.ok(!result.settingsOps.some((op) => op.op === "unset" || op.op === "remove"));
});

test("remove：删除到 0 条仍是一条 set，value 为空数组", () => {
  const host = routeOf([{ id: "only" }]);
  const result = projectPiAi({}, host, { routeId: "gw", mode: "remove", index: 0 });
  assert.equal(result.settingsOps.length, 1);
  assert.deepEqual(result.settingsOps[0].value, []);
});

test("remove：保留其余条目的顺序与完整对象", () => {
  const rows = [existingRow, { id: "b", compat: { x: 1 } }, { id: "c", nested: { deep: true } }];
  const result = projectPiAi({}, routeOf(rows), { routeId: "gw", mode: "remove", index: 0 });
  assert.equal(JSON.stringify(result.settingsOps[0].value), JSON.stringify([rows[1], rows[2]]));
});

test("remove：越界 / 非整数下标拒绝为 stale-index", () => {
  const host = routeOf([existingRow]);
  for (const index of [1, -1, 0.5, "0", undefined]) {
    const result = projectPiAi({}, host, { routeId: "gw", mode: "remove", index });
    assert.equal(result.settingsOps.length, 0, `index=${String(index)}`);
    assert.ok(result.warnings.some((item) => item.code === "stale-index"), `index=${String(index)}`);
  }
});

// ── create 默认行为 / 表单 diff ─────────────────────────────────────────

test("create 默认模式与显式 append 行为逐字节一致（golden）", () => {
  const draft = { id: "tflow/alpha", name: "Alpha", contextWindow: 131072, maxTokens: 8192, input: ["text"] };
  const host = { providers: { gw: { models: [{ id: "m1" }, { id: "m2" }] } } };
  const implicit = projectPiAi(draft, host, { routeId: "gw" });
  const explicit = projectPiAi(draft, host, { routeId: "gw", mode: "create", append: true });
  assert.equal(JSON.stringify(implicit), JSON.stringify(explicit));
  assert.deepEqual(implicit.settingsOps[0].path, ["providers", "gw", "models", "2"]);
  assert.deepEqual(implicit.settingsOps[0].value, {
    id: "tflow/alpha",
    name: "Alpha",
    contextWindow: 131072,
    maxTokens: 8192,
    input: ["text"],
  });
});

test("formFromModel：预填现有值，不是模板值", () => {
  const form = formFromModel(existingRow);
  assert.deepEqual(form, {
    name: "jxf/dsv4.1-pro",
    contextWindow: "1000000",
    maxTokens: "32768",
    inputText: true,
    inputImage: false,
    reasoningLevels: ["off", "low", "medium", "high"],
    reasoningApiValues: {},
    reasoningDisabled: false,
  });
});

test("diffRow：完全相同 → 空改动；只改 maxTokens → 只含 maxTokens", () => {
  const form = formFromModel(existingRow);
  assert.deepEqual(diffRow(form, existingRow), {});
  assert.deepEqual(diffRow({ ...form, maxTokens: "65536" }, existingRow), { maxTokens: 65536 });
});

test("diffRow：推理档位变化时保留现有自定义线上值，off 与同名值不写入 wireMap", () => {
  const custom = { ...existingRow, reasoningEfforts: { off: null, low: "reasoning_low", high: "reasoning_high" } };
  const form = formFromModel(custom);
  form.reasoningLevels = [...form.reasoningLevels, "xhigh"];
  const changed = diffRow(form, custom);
  assert.equal(changed.reasoning.mode, "effort");
  assert.deepEqual(changed.reasoning.levels, ["off", "low", "high", "xhigh"]);
  assert.deepEqual(changed.reasoning.wireMap, { low: "reasoning_low", high: "reasoning_high" });
});

// ── 工单 #23：API 参数值（wireMap）──────────────────────────────────────

test("formFromModel：只预填「值与档位名不同」的条目，off:null 与同名值不预填", () => {
  const custom = {
    ...existingRow,
    reasoningEfforts: { off: null, low: "reasoning_low", medium: "medium", high: "high_reasoning", xhigh: "max" },
  };
  const form = formFromModel(custom);
  assert.deepEqual(form.reasoningLevels, ["off", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(form.reasoningApiValues, { low: "reasoning_low", high: "high_reasoning", xhigh: "max" });
  assert.equal(form.reasoningDisabled, false);
});

test("formFromModel：reasoningEfforts:false → reasoningDisabled，且不勾任何档位、不预填参数值", () => {
  const form = formFromModel({ id: "plain/model", reasoningEfforts: false });
  assert.equal(form.reasoningDisabled, true);
  assert.deepEqual(form.reasoningLevels, []);
  assert.deepEqual(form.reasoningApiValues, {});
});

test("formFromModel：reasoningEfforts 缺失 → 七档全不勾、API 参数值全空", () => {
  const form = formFromModel({ id: "missing/model" });
  assert.equal(form.reasoningDisabled, false);
  assert.deepEqual(form.reasoningLevels, []);
  assert.deepEqual(form.reasoningApiValues, {});
});

test("diffRow：只改 API 参数值、档位集合不变 → 识别为改动并带 wireMap", () => {
  const form = formFromModel(existingRow);
  form.reasoningApiValues = { ...form.reasoningApiValues, high: "high_reasoning" };
  assert.deepEqual(diffRow(form, existingRow), {
    reasoning: {
      mode: "effort",
      levels: ["off", "low", "medium", "high"],
      wireMap: { high: "high_reasoning" },
    },
  });
});

test("diffRow + projectPiAi(update)：只改 high 的参数值 → 写出 { off:null, high:'high_reasoning', … }", () => {
  const form = formFromModel(existingRow);
  form.reasoningApiValues = { high: "high_reasoning" };
  const changed = diffRow(form, existingRow);
  const result = projectPiAi({ id: existingRow.id, ...changed }, routeOf([existingRow]), {
    routeId: "gw",
    mode: "update",
    index: 0,
  });
  assert.equal(result.settingsOps.length, 1);
  assert.deepEqual(result.settingsOps[0].value.reasoningEfforts, {
    off: null,
    low: "low",
    medium: "medium",
    high: "high_reasoning",
  });
  assert.equal(result.unsupportedControls.length, 0);
});

test("diffRow：把自定义值改回与档位名相同 → 识别为改动并从 wireMap 移除", () => {
  const custom = { ...existingRow, reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high_reasoning" } };
  const form = formFromModel(custom);
  assert.deepEqual(form.reasoningApiValues, { high: "high_reasoning" });
  form.reasoningApiValues = { high: "high" };
  const changed = diffRow(form, custom);
  assert.deepEqual(changed.reasoning, { mode: "effort", levels: ["off", "low", "medium", "high"] });
  assert.equal("wireMap" in changed.reasoning, false);
});

test("diffRow：值填空串 / 纯空格 / 与档位名相同 → 都不写 wireMap，也不产生改动", () => {
  for (const value of ["", "   ", "high"]) {
    const form = formFromModel(existingRow);
    form.reasoningApiValues = { high: value };
    assert.deepEqual(diffRow(form, existingRow), {}, `value=${JSON.stringify(value)}`);
  }
});

test("diffRow：取消勾选已填自定义值的档位 → 该条 wireMap 一并丢弃", () => {
  const custom = {
    ...existingRow,
    reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high", xhigh: "max" },
  };
  const form = formFromModel(custom);
  form.reasoningApiValues = { ...form.reasoningApiValues, xhigh: "max" };
  form.reasoningLevels = ["off", "low", "medium", "high"];
  const changed = diffRow(form, custom);
  assert.deepEqual(changed.reasoning, { mode: "effort", levels: ["off", "low", "medium", "high"] });
  assert.equal("xhigh" in (changed.reasoning.wireMap ?? {}), false);
  assert.equal("wireMap" in changed.reasoning, false);
});

test("diffRow：off 不允许填值；即便表单带了 apiValues.off 也被忽略", () => {
  const form = formFromModel(existingRow);
  form.reasoningApiValues = { off: "shutdown" };
  assert.deepEqual(diffRow(form, existingRow), {});
});

test("diffRow：档位集合与 API 参数值都没变 → 空改动（保存保持禁用）", () => {
  const custom = { ...existingRow, reasoningEfforts: { off: null, low: "reasoning_low", high: "high_reasoning" } };
  const form = formFromModel(custom);
  assert.deepEqual(diffRow(form, custom), {});
});

test("diffRow：现有线上值带首尾空白时，打开表单但不改动 → 仍为空改动", () => {
  const custom = { ...existingRow, reasoningEfforts: { off: null, low: " low ", medium: "medium", high: " high_reasoning " } };
  const form = formFromModel(custom);
  assert.deepEqual(form.reasoningApiValues, { high: "high_reasoning" });
  assert.deepEqual(diffRow(form, custom), {});
});

test("diffRow：只改参数值、不改档位时，投影的字典合法且不含空串", () => {
  const form = formFromModel(existingRow);
  form.reasoningApiValues = { high: "  high_reasoning  ", low: "   " };
  const changed = diffRow(form, existingRow);
  const result = projectPiAi({ id: existingRow.id, ...changed }, routeOf([existingRow]), {
    routeId: "gw",
    mode: "update",
    index: 0,
  });
  assert.equal(result.unsupportedControls.length, 0);
  assert.deepEqual(result.settingsOps[0].value.reasoningEfforts, {
    off: null,
    low: "low",
    medium: "medium",
    high: "high_reasoning",
  });
});


test("describeModelRow：窗口 / 输出 / 模态 / 档位数", () => {
  assert.equal(
    describeModelRow(existingRow, humanizeTokenCount),
    "窗口 1M · 输出 33K · text · 4 档",
  );
  assert.equal(
    describeModelRow({ id: "m", input: ["text", "image"], reasoningEfforts: false }, humanizeTokenCount),
    "窗口 未设置 · 输出 未设置 · text / image · 非推理",
  );
});
