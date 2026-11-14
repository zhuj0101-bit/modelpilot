// 工单 #19：模型拖动排序的纯逻辑测试。
//
// 顺序只能靠重写整个 models 数组表达（数组下标没有叶子路径）；这里钉住
// 三件事：只换位置不改内容、绝不原地修改、无效下标一律不产出 op。

import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { MODEL_MOVE_WARNINGS, moveModel } = await import(
  pathToFileURL(join(root, "src", "core", "route-edit.js")).href
);

const ROUTE_ID = "preview-chat";

/** 三条带 compat / 宿主未来字段的模型；排序只应改变它们在数组里的位置。 */
const MODELS = Object.freeze([
  Object.freeze({
    id: "jxf/dsv4.1-flash",
    name: "jxf/dsv4.1-flash",
    contextWindow: 1000000,
    maxTokens: 32768,
    input: ["text"],
    compat: { supportsReasoningEffort: true, nested: { keep: true } },
    futureHostField: { keep: ["exactly", "these"] },
  }),
  Object.freeze({ id: "jxf/dsv4.1-pro", name: "jxf/dsv4.1-pro", contextWindow: 1000000, maxTokens: 32768 }),
  Object.freeze({ id: "tx/deepseek-v4.1-flash", name: "tx/deepseek-v4.1-flash", contextWindow: 128000, maxTokens: 8192 }),
]);

const ids = (models) => models.map((model) => model.id);

test("moveModel：0 → 2 返回新数组，其余保持相对顺序", () => {
  const result = moveModel(MODELS, 0, 2, ROUTE_ID);
  assert.deepEqual(ids(result.models), ["jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash", "jxf/dsv4.1-flash"]);
  assert.notEqual(result.models, MODELS, "必须返回新数组");
  assert.deepEqual(ids(MODELS), ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash"], "原数组顺序不变");
});

test("moveModel：不修改传入的数组（深比较原数组逐字节不变）", () => {
  const snapshot = JSON.stringify(MODELS);
  const result = moveModel(MODELS, 2, 0, ROUTE_ID);
  assert.equal(JSON.stringify(MODELS), snapshot, "传入数组未被原地 splice");
  assert.notEqual(result.models, MODELS);
});

test("moveModel：from === to 返回 no-change 告警且不产出 op", () => {
  const result = moveModel(MODELS, 1, 1, ROUTE_ID);
  assert.equal(result.models, undefined);
  assert.equal(result.ops, undefined);
  assert.equal(result.warning.code, MODEL_MOVE_WARNINGS.noChange);
  assert.match(result.warning.message, /no-change/);
});

test("moveModel：越界 / 负数 / 非整数一律返回 stale-index，不产出 op", () => {
  const cases = [
    [-1, 0],
    [0, 3],
    [3, 0],
    [0, 0.5],
    [1.5, 0],
    [NaN, 1],
    [0, "1"],
  ];
  for (const [from, to] of cases) {
    const result = moveModel(MODELS, from, to, ROUTE_ID);
    assert.equal(result.warning?.code, MODEL_MOVE_WARNINGS.staleIndex, `${String(from)} → ${String(to)}`);
    assert.equal(result.ops, undefined, `${String(from)} → ${String(to)} 不应产出 op`);
    assert.equal(result.models, undefined);
  }
  const empty = moveModel([], 0, 0, ROUTE_ID);
  assert.equal(empty.warning?.code, MODEL_MOVE_WARNINGS.staleIndex);
});

test("moveModel：models 缺失 / 不是数组时返回 invalid-models", () => {
  for (const value of [undefined, null, {}, "models"]) {
    const result = moveModel(value, 0, 1, ROUTE_ID);
    assert.equal(result.warning?.code, MODEL_MOVE_WARNINGS.invalidModels);
    assert.equal(result.ops, undefined);
  }
});

test("moveModel：产出恰好 1 条整数组 set，path 是 providers.<route>.models", () => {
  const result = moveModel(MODELS, 0, 1, ROUTE_ID);
  assert.equal(result.ops.length, 1);
  const [op] = result.ops;
  assert.equal(op.op, "set");
  assert.deepEqual(op.path, ["providers", ROUTE_ID, "models"]);
  assert.equal(op.value, result.models, "op.value 与新数组是同一个引用");
  assert.equal(op.path.length, 3, "不写 models.<i> 叶子路径");
});

test("moveModel：新数组长度不变，元素对象逐字节不变", () => {
  const result = moveModel(MODELS, 2, 0, ROUTE_ID);
  assert.equal(result.models.length, MODELS.length);
  assert.equal(JSON.stringify(result.models), JSON.stringify([MODELS[2], MODELS[0], MODELS[1]]));
  for (const model of MODELS) {
    assert.ok(result.models.includes(model), `元素 ${model.id} 按引用原样搬走`);
  }
});

test("moveModel：compat / 宿主未来字段跟着模型走，不按位置留下", () => {
  const result = moveModel(MODELS, 0, 2, ROUTE_ID);
  const moved = result.models[2];
  assert.equal(moved.id, "jxf/dsv4.1-flash");
  assert.deepEqual(moved.compat, { supportsReasoningEffort: true, nested: { keep: true } });
  assert.deepEqual(moved.futureHostField, { keep: ["exactly", "these"] });
  for (const other of result.models.slice(0, 2)) {
    assert.equal(Object.hasOwn(other, "compat"), false);
    assert.equal(Object.hasOwn(other, "futureHostField"), false);
  }
});

test("moveModel：省略 routeId 时只返回重排后的数组，不产出 op", () => {
  const result = moveModel(MODELS, 0, 2);
  assert.deepEqual(ids(result.models), ["jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash", "jxf/dsv4.1-flash"]);
  assert.deepEqual(result.ops, []);
});
