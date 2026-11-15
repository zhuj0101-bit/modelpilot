// 工单 #25：主模型列表批量操作的纯规则测试。
//
// 批量写入的三条硬规则（一次 set / 下标复核 / 不能全删）在纯逻辑层钉死；
// 真实 DOM 下的搜索、勾选与一次 mutate 调用见 test/client/model-list-search-bulk.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import {
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
