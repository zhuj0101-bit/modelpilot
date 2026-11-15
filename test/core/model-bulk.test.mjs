// 工单 #25：主模型列表批量操作的纯规则测试。
//
// 批量写入的三条硬规则（一次 set / 下标复核 / 不能全删）在纯逻辑层钉死；
// 真实 DOM 下的搜索、勾选与一次 mutate 调用见 test/client/model-list-search-bulk.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import {
  bulkFieldsNotice,
  planBulkDelete,
  planBulkFields,
  reasoningEffortsFromLevels,
  sameIdSequence,
  summarizeBulkSelection,
} from "../../src/core/model-bulk.js";

const route = "preview-chat";

const modelsFixture = () => [
  {
    id: "jxf/dsv4.1-flash",
    name: "jxf/dsv4.1-flash",
    contextWindow: 1000000,
    maxTokens: 32768,
    input: ["text"],
    reasoningEfforts: { off: null, low: "low" },
    compat: { supportsReasoningEffort: true, nested: { keep: true } },
    futureHostField: { keep: ["exactly", "these"] },
  },
  {
    id: "jxf/dsv4.1-pro",
    name: "jxf/dsv4.1-pro",
    contextWindow: 1000000,
    maxTokens: 32768,
    input: ["text", "image"],
  },
  {
    id: "tx/deepseek-v4.1-flash",
    name: "tx/deepseek-v4.1-flash",
    contextWindow: 128000,
    maxTokens: 8192,
    input: ["text"],
  },
  {
    id: "qwen/complete",
    name: "qwen/complete",
    contextWindow: 262144,
    maxTokens: 8192,
    input: ["text"],
  },
];

const setOp = (result) => {
  assert.equal(result.ops.length, 1, "只产出一条 op");
  const [op] = result.ops;
  assert.equal(op.op, "set");
  assert.deepEqual(op.path, ["providers", route, "models"], "整数组路径，不是叶子");
  return op;
};

// ── id 序列复核 ────────────────────────────────────────────────────────────

test("sameIdSequence：长度相同但顺序不同也算变化", () => {
  assert.equal(sameIdSequence(["a", "b", "c"], ["a", "b", "c"]), true);
  assert.equal(sameIdSequence(["a", "b", "c"], ["a", "c", "b"]), false, "顺序变了，同一下标已是另一条模型");
});

test("sameIdSequence：长度 / 缺失 / 非数组都不相等", () => {
  assert.equal(sameIdSequence([], []), true);
  assert.equal(sameIdSequence(["a"], []), false);
  assert.equal(sameIdSequence(["a"], ["a", "b"]), false);
  assert.equal(sameIdSequence([undefined, "b"], [undefined, "b"]), true);
  assert.equal(sameIdSequence(undefined, []), true);
});

// ── 批量删除 ──────────────────────────────────────────────────────────────

test("批量删除：删掉选中下标，其余模型保持原顺序与内容", () => {
  const models = modelsFixture();
  const result = planBulkDelete(models, new Set([0, 2]), route);

  assert.equal(result.status, "ok");
  const op = setOp(result);
  assert.deepEqual(op.value.map((model) => model.id), ["jxf/dsv4.1-pro", "qwen/complete"]);
  assert.deepEqual(result.removed, ["jxf/dsv4.1-flash", "tx/deepseek-v4.1-flash"]);
  assert.deepEqual(op.value[0], models[1], "未选中的模型原样保留");
  assert.deepEqual(op.value[1], models[3]);
  assert.deepEqual(models.map((model) => model.id), modelsFixture().map((model) => model.id), "不修改入参数组");
});

test("批量删除：一个下标也不选时不产出 ops", () => {
  const result = planBulkDelete(modelsFixture(), new Set(), route);
  assert.equal(result.status, "empty");
  assert.deepEqual(result.ops, []);
});

test("批量删除：选中数 === 模型总数时拒绝（不能删光）", () => {
  const models = modelsFixture();
  const result = planBulkDelete(models, new Set([0, 1, 2, 3]), route);
  assert.equal(result.status, "refuse-all");
  assert.match(result.message, /至少保留一条/);
  assert.deepEqual(result.ops, []);
});

test("批量删除：越界 / 非整数下标按失效处理，不写入", () => {
  const models = modelsFixture();
  assert.equal(planBulkDelete(models, new Set([0, 9]), route).status, "stale");
  assert.equal(planBulkDelete(models, new Set([1.5]), route).status, "stale");
  assert.equal(planBulkDelete(models, new Set([-1]), route).status, "stale");
});

// ── 批量改字段 ────────────────────────────────────────────────────────────

test("批量设输出上限：一条 set，选中模型同一 maxTokens，其他字段保留", () => {
  const models = modelsFixture();
  const result = planBulkFields(models, new Set([0, 2]), { maxTokens: 16384 }, route);

  assert.equal(result.status, "ok");
  const op = setOp(result);
  assert.deepEqual(op.value.map((model) => model.id), models.map((model) => model.id), "顺序与条数不变");
  assert.equal(op.value[0].maxTokens, 16384);
  assert.equal(op.value[2].maxTokens, 16384);
  assert.equal(op.value[1].maxTokens, 32768, "未选中的模型不动");
  assert.equal(op.value[3].maxTokens, 8192);
  assert.deepEqual(op.value[0].compat, models[0].compat);
  assert.deepEqual(op.value[0].futureHostField, models[0].futureHostField);
  assert.equal(op.value[0].contextWindow, 1000000);
  assert.equal(op.value[0].name, "jxf/dsv4.1-flash");
  assert.deepEqual(result.changed, [
    { index: 0, id: "jxf/dsv4.1-flash" },
    { index: 2, id: "tx/deepseek-v4.1-flash" },
  ]);
});

test("批量设输入模态：统一成同一个数组并保持 text / image 的规范顺序", () => {
  const result = planBulkFields(modelsFixture(), new Set([1, 2]), { input: ["image", "text", "image"] }, route);
  const op = setOp(result);
  assert.deepEqual(op.value[1].input, ["text", "image"]);
  assert.deepEqual(op.value[2].input, ["text", "image"]);
  assert.deepEqual(op.value[0].input, ["text"], "未选中的模型不动");
});

test("批量设推理档位：写同一套 reasoningEfforts，其他字段保留", () => {
  const result = planBulkFields(
    modelsFixture(),
    new Set([1, 3]),
    { reasoningLevels: ["high", "off", "low"] },
    route,
  );
  const op = setOp(result);
  const expected = { off: null, low: "low", high: "high" };
  assert.deepEqual(op.value[1].reasoningEfforts, expected);
  assert.deepEqual(op.value[3].reasoningEfforts, expected);
  assert.equal(op.value[1].maxTokens, 32768);
  assert.deepEqual(op.value[1].input, ["text", "image"]);
});

test("三个字段可以组合：仍然只有一次 set，一个 models 数组", () => {
  const result = planBulkFields(
    modelsFixture(),
    new Set([0, 1, 2]),
    { maxTokens: "65536", input: ["text"], reasoningLevels: ["medium", "max"] },
    route,
  );
  const op = setOp(result);
  assert.equal(op.value.length, 4);
  for (const index of [0, 1, 2]) {
    assert.equal(op.value[index].maxTokens, 65536);
    assert.deepEqual(op.value[index].input, ["text"]);
    assert.deepEqual(op.value[index].reasoningEfforts, { off: null, medium: "medium", max: "max" });
  }
  assert.equal(op.value[3].maxTokens, 8192, "未选中的模型保持原值");
  assert.deepEqual(result.changed.map((row) => row.index), [0, 1, 2]);
});

test("批量改字段：2000 条模型选中 1000 条，未选中项保持同一引用且顺序不变", () => {
  // 工单 #34 问题三：批量改字段仍返回完整的 models 数组（不删未选中项），
  // 只有选中的 1000 条被拷贝；另外确认这 1000 条的字段已改、其余字段原样。
  const models = Array.from({ length: 2000 }, (_, index) => ({
    id: `perf/model-${index}`,
    name: `perf/model-${index}`,
    contextWindow: 131072,
    maxTokens: 1024 + index,
    input: ["text"],
    futureHostField: { index },
  }));
  const selected = new Set();
  for (let index = 0; index < 2000; index += 2) selected.add(index);

  const result = planBulkFields(models, selected, { maxTokens: 32768 }, route);
  assert.equal(result.status, "ok");
  const op = setOp(result);
  assert.equal(op.value.length, 2000, "批量改字段不改变条数");
  assert.equal(op.value.map((model) => model.id).join(","), models.map((model) => model.id).join(","), "顺序不变");

  let selectedCopies = 0;
  for (let index = 0; index < 2000; index += 1) {
    if (selected.has(index)) {
      assert.notEqual(op.value[index], models[index], `选中的第 ${index} 条是新对象`);
      assert.equal(op.value[index].maxTokens, 32768);
      assert.equal(op.value[index].contextWindow, 131072, "未改字段原样");
      assert.deepEqual(op.value[index].input, ["text"], "未改字段原样");
      assert.deepEqual(op.value[index].futureHostField, { index }, "宿主未来字段原样");
      selectedCopies += 1;
    } else {
      assert.equal(op.value[index], models[index], `未选中的第 ${index} 条必须保持同一引用`);
    }
  }
  assert.equal(selectedCopies, 1000);
  assert.equal(result.changed.length, 1000);
  assert.deepEqual(result.changed.map((row) => row.index), [...selected].sort((left, right) => left - right));
  assert.equal(models[1].maxTokens, 1025, "不修改入参数组");
  assert.equal(models[1999].maxTokens, 3023);
});

test("批量改字段：选中判断用 Set.has，不再对每个模型线性扫 indexes", () => {
  // 工单 #34 问题三：indexes.includes(index) 在 1000 选 2000 时约 100 万次
  // 比较；这里直接观察 Array.prototype.includes 的调用次数。maxTokens 分支
  // 不经过 MODALITIES / PI_AI_LEVELS 的 includes，基线会正好调用 2000 次。
  const models = Array.from({ length: 2000 }, (_, index) => ({ id: `perf/${index}`, maxTokens: 1024 }));
  const indexes = Array.from({ length: 1000 }, (_, index) => index * 2);
  const original = Array.prototype.includes;
  let calls = 0;
  Array.prototype.includes = function (...args) {
    calls += 1;
    return original.apply(this, args);
  };
  let result;
  try {
    result = planBulkFields(models, new Set(indexes), { maxTokens: 4096 }, route);
  } finally {
    Array.prototype.includes = original;
  }
  assert.equal(result.status, "ok");
  assert.equal(calls, 0, "每个模型不再线性扫描一遍 indexes");
});

test("批量改字段：值本来就相同时返回 no-change，不写盘", () => {
  const models = modelsFixture();
  const result = planBulkFields(models, new Set([0]), { maxTokens: 32768 }, route);
  assert.equal(result.status, "no-change");
  assert.deepEqual(result.ops, []);
});

test("批量设输出上限：非法值被拒绝", () => {
  for (const value of ["", "0", "-1", "1.5", "abc", 0, -3, NaN]) {
    const result = planBulkFields(modelsFixture(), new Set([0]), { maxTokens: value }, route);
    assert.equal(result.status, "invalid", `值 ${String(value)} 应被拒绝`);
    assert.deepEqual(result.ops, []);
  }
});

test("批量设输入模态：空数组 / 未知模态被拒绝", () => {
  assert.equal(planBulkFields(modelsFixture(), new Set([0]), { input: [] }, route).status, "invalid");
  assert.equal(planBulkFields(modelsFixture(), new Set([0]), { input: ["audio"] }, route).status, "invalid");
});

test("批量设推理档位：只勾 off / 未知档位 / 空数组被拒绝", () => {
  const onlyOff = planBulkFields(modelsFixture(), new Set([0]), { reasoningLevels: ["off"] }, route);
  assert.equal(onlyOff.status, "invalid");
  assert.equal(onlyOff.code, "efforts-only-off");
  assert.match(onlyOff.message, /思考档位|全不选/);

  assert.equal(planBulkFields(modelsFixture(), new Set([0]), { reasoningLevels: ["turbo"] }, route).status, "invalid");
  assert.equal(planBulkFields(modelsFixture(), new Set([0]), { reasoningLevels: [] }, route).status, "invalid");
});

test("批量改字段：一个字段都没勾（空 patch）被拒绝", () => {
  const result = planBulkFields(modelsFixture(), new Set([0]), {}, route);
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.ops, []);
});

test("批量改字段：越界下标按失效处理，不写入", () => {
  assert.equal(planBulkFields(modelsFixture(), new Set([4]), { maxTokens: 1 }, route).status, "stale");
});

test("reasoningEffortsFromLevels：规范顺序、off:null、未知档位忽略", () => {
  assert.deepEqual(reasoningEffortsFromLevels(["max", "off", "low", "turbo"]), {
    off: null,
    low: "low",
    max: "max",
  });
  assert.equal(reasoningEffortsFromLevels([]), undefined);
  assert.equal(reasoningEffortsFromLevels(["turbo"]), undefined);
});

test("批量操作不改入参：models 数组与选中行都保持原对象", () => {
  const models = modelsFixture();
  const snapshot = JSON.parse(JSON.stringify(models));
  planBulkDelete(models, new Set([1]), route);
  planBulkFields(models, new Set([0, 2]), { maxTokens: 4096, input: ["image"], reasoningLevels: ["low"] }, route);
  assert.deepEqual(models, snapshot);
});

// ── 工单 #33：批量删除前的可见性摘要 ────────────────────────────────────────

test("summarizeBulkSelection：按绝对下标升序给出 id，并点名不可见条数", () => {
  const models = modelsFixture();
  const summary = summarizeBulkSelection(models, new Set([2, 0]), [0]);
  assert.deepEqual(summary, {
    count: 2,
    ids: ["jxf/dsv4.1-flash", "tx/deepseek-v4.1-flash"],
    hiddenCount: 1,
    hiddenIndexes: [2],
  });
});

test("summarizeBulkSelection：全部可见时 hiddenCount 为 0", () => {
  const summary = summarizeBulkSelection(modelsFixture(), new Set([1, 3]), [0, 1, 2, 3]);
  assert.equal(summary.count, 2);
  assert.equal(summary.hiddenCount, 0);
  assert.deepEqual(summary.hiddenIndexes, []);
});

test("summarizeBulkSelection：缺失 id 回落序号，与 planBulkDelete 文案一致", () => {
  const models = [{ id: "a/one" }, {}, { id: "" }];
  const summary = summarizeBulkSelection(models, new Set([1, 2]), []);
  assert.deepEqual(summary.ids, ["第 2 个模型", ""]);
  const plan = planBulkDelete(models, new Set([1, 2]), route);
  assert.equal(plan.status, "ok");
  assert.deepEqual(plan.removed, summary.ids, "确认框与真正删除的 id 来自同一规则");
});

test("summarizeBulkSelection：越界 / 非法下标按失效处理，返回空摘要", () => {
  assert.deepEqual(summarizeBulkSelection(modelsFixture(), new Set([0, 9]), [0]), {
    count: 0,
    ids: [],
    hiddenCount: 0,
    hiddenIndexes: [],
  });
  assert.deepEqual(summarizeBulkSelection(modelsFixture(), new Set([1.5]), []).ids, []);
});

test("summarizeBulkSelection：不改入参，非法 visibleIndexes 忽略", () => {
  const models = modelsFixture();
  const snapshot = JSON.parse(JSON.stringify(models));
  const summary = summarizeBulkSelection(models, new Set([0]), [0, 99, -1, 1.5, "1"]);
  assert.equal(summary.hiddenCount, 0);
  assert.equal(summary.count, 1);
  assert.deepEqual(models, snapshot);
  assert.deepEqual(summarizeBulkSelection(models, new Set([0]), undefined).hiddenCount, 1);
});

// ── 工单 #35：changed 只收真正发生变化的行 ──────────────────────────────────

const partialModels = () => [
  { id: "a", maxTokens: 8192 },
  { id: "b", maxTokens: 8192 },
  { id: "c", maxTokens: 4096 },
];

test("批量改字段：部分行已是目标值时 changed 只收真实变化的行", () => {
  const result = planBulkFields(partialModels(), new Set([0, 1, 2]), { maxTokens: 8192 }, "r1");
  assert.equal(result.status, "ok");
  assert.equal(result.changed.length, 1, "只有 c 需要写盘");
  assert.deepEqual(result.changed, [{ index: 2, id: "c" }]);
  assert.equal(result.ops.length, 1, "仍然只有一条 set 整数组");
});

test("批量改字段：全部行都变化时 changed 收齐所有选中行", () => {
  const result = planBulkFields(partialModels(), new Set([0, 1, 2]), { maxTokens: 16384 }, "r1");
  assert.equal(result.status, "ok");
  assert.deepEqual(result.changed.map((row) => row.id), ["a", "b", "c"]);
});

test("批量改字段：全部已是目标值才返回 no-change", () => {
  const result = planBulkFields(partialModels(), new Set([0, 1]), { maxTokens: 8192 }, "r1");
  assert.equal(result.status, "no-change");
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.ops, []);
});

test("批量改字段：changed 保持下标升序，带 index 与 id", () => {
  const result = planBulkFields(partialModels(), new Set([2, 0]), { maxTokens: 2048 }, "r1");
  assert.deepEqual(result.changed, [
    { index: 0, id: "a" },
    { index: 2, id: "c" },
  ]);
});

test("批量改字段提示：部分变化时写真实改动条数与已是目标值的条数", () => {
  assert.equal(bulkFieldsNotice(1, 3), "已批量更新 1 条模型（3 条中 2 条已是目标值）");
  assert.equal(bulkFieldsNotice(3, 3), "已批量更新 3 条模型");
  assert.equal(bulkFieldsNotice(1, 1), "已批量更新 1 条模型");
  assert.equal(bulkFieldsNotice(0, 2), "已批量更新 0 条模型（2 条中 2 条已是目标值）");
});
