// 工单 #31：长模型列表的纯视图规则测试。
//
// 分组键 / 组内短名 / 组顺序 / 摘要去重 / 密度偏好都是纯函数；真实 DOM 下的
// 折叠、搜索自动展开、密度切换与拖动见 test/client/model-list-grouping.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import {
  DENSITY_COMPACT,
  DENSITY_DETAILED,
  DENSITY_STORAGE_KEY,
  OTHER_GROUP,
  groupCountText,
  groupKeyOf,
  groupModelRows,
  groupedOrdinalOf,
  readModelListDensity,
  selectAllCheckboxState,
  sharedSummaryText,
  shortIdOf,
  writeModelListDensity,
} from "../../src/core/model-list-view.js";

test("groupKeyOf：第一段前缀；空 / 无斜杠 / 斜杠开头归到「其他」", () => {
  assert.equal(groupKeyOf("jxf/dsv4.1-flash"), "jxf");
  assert.equal(groupKeyOf("deepseek/deepseek-chat"), "deepseek");
  assert.equal(groupKeyOf("a/b/c"), "a");
  assert.equal(groupKeyOf("no-slash"), OTHER_GROUP);
  assert.equal(groupKeyOf("/leading"), OTHER_GROUP);
  assert.equal(groupKeyOf(""), OTHER_GROUP);
  assert.equal(groupKeyOf(undefined), OTHER_GROUP);
  assert.equal(groupKeyOf(42), OTHER_GROUP);
});

test("shortIdOf：只去掉自己分组的前缀", () => {
  assert.equal(shortIdOf("jxf/dsv4.1-flash", "jxf"), "dsv4.1-flash");
  assert.equal(shortIdOf("a/b/c", "a"), "b/c");
  assert.equal(shortIdOf("jxf/dsv4.1-flash", "tx"), "jxf/dsv4.1-flash");
  assert.equal(shortIdOf("no-slash", OTHER_GROUP), "no-slash");
  assert.equal(shortIdOf(undefined, "jxf"), "");
});

test("groupModelRows：组按字母序，「其他」最后，组内保持数组顺序与绝对下标", () => {
  const models = [
    { id: "tx/b" },
    { id: "jxf/a" },
    { id: "no-slash" },
    { id: "jxf/c" },
    { id: "deepseek/d" },
    { id: "tx/e" },
  ];
  const groups = groupModelRows(models);
  assert.deepEqual(groups.map((group) => group.key), ["deepseek", "jxf", "tx", OTHER_GROUP]);
  assert.deepEqual(groups.map((group) => group.rows.map((row) => row.index)), [[4], [1, 3], [0, 5], [2]]);
  assert.deepEqual(groups.map((group) => group.rows.map((row) => row.shortId)), [
    ["d"],
    ["a", "c"],
    ["b", "e"],
    ["no-slash"],
  ]);
  // 入参顺序不变，返回的 model 就是入参对象。
  assert.deepEqual(models.map((model) => model.id), [
    "tx/b",
    "jxf/a",
    "no-slash",
    "jxf/c",
    "deepseek/d",
    "tx/e",
  ]);
  assert.equal(groups[1].rows[0].model, models[1]);
});

test("groupModelRows：大小写不同的前缀是不同组，但组键按折叠字母序排", () => {
  const groups = groupModelRows([{ id: "Zeta/a" }, { id: "alpha/b" }, { id: "zeta/c" }]);
  assert.deepEqual(groups.map((group) => group.key), ["alpha", "Zeta", "zeta"]);
});

test("groupModelRows：非数组与缺失 id 不抛错，缺失 id 归「其他」", () => {
  assert.deepEqual(groupModelRows(undefined), []);
  const groups = groupModelRows([{ id: "jxf/a" }, {}, { id: 7 }, null]);
  assert.deepEqual(groups.map((group) => group.key), ["jxf", OTHER_GROUP]);
  assert.deepEqual(groups[1].rows.map((row) => row.index), [1, 2, 3]);
  assert.deepEqual(groups[1].rows.map((row) => row.shortId), ["", "", ""]);
});

test("groupedOrdinalOf：按分组后的阅读顺序编号，写盘仍用绝对下标", () => {
  const models = [{ id: "tx/a" }, { id: "jxf/b" }, { id: "jxf/c" }, { id: "no-slash" }];
  assert.equal(groupedOrdinalOf(models, 0), 3, "tx 组排在 jxf 之后");
  assert.equal(groupedOrdinalOf(models, 1), 1);
  assert.equal(groupedOrdinalOf(models, 2), 2);
  assert.equal(groupedOrdinalOf(models, 3), 4, "「其他」组最后");
  assert.equal(groupedOrdinalOf(undefined, 2), 3, "非数组时回落到 index + 1");
});

test("sharedSummaryText：全部逐字相同且不止一行才返回；混合 / 单行返回 null", () => {
  assert.equal(sharedSummaryText(["a", "a"]), "a");
  assert.equal(sharedSummaryText(["a", "a", "a"]), "a");
  assert.equal(sharedSummaryText(["a", "b"]), null);
  assert.equal(sharedSummaryText(["a"]), null);
  assert.equal(sharedSummaryText([]), null);
  assert.equal(sharedSummaryText(undefined), null);
  assert.equal(sharedSummaryText([undefined, undefined]), null);
});

test("密度偏好：默认 compact；详细可写入；非法值回落 compact", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, value),
  };
  assert.equal(readModelListDensity(storage), DENSITY_COMPACT);
  assert.equal(writeModelListDensity(storage, DENSITY_DETAILED), true);
  assert.equal(memory.get(DENSITY_STORAGE_KEY), DENSITY_DETAILED);
  assert.equal(readModelListDensity(storage), DENSITY_DETAILED);
  assert.equal(writeModelListDensity(storage, DENSITY_COMPACT), true);
  assert.equal(readModelListDensity(storage), DENSITY_COMPACT);
  memory.set(DENSITY_STORAGE_KEY, "compact");
  assert.equal(readModelListDensity(storage), DENSITY_COMPACT);
  memory.set(DENSITY_STORAGE_KEY, "verbose");
  assert.equal(readModelListDensity(storage), DENSITY_COMPACT);
  memory.set(DENSITY_STORAGE_KEY, "COMPACT");
  assert.equal(readModelListDensity(storage), DENSITY_COMPACT);
});

test("密度偏好：没有 storage / 读写抛异常时安静回落 compact", () => {
  assert.equal(readModelListDensity(undefined), DENSITY_COMPACT);
  assert.equal(readModelListDensity({}), DENSITY_COMPACT);
  assert.equal(writeModelListDensity(undefined, DENSITY_DETAILED), false);
  assert.equal(writeModelListDensity({}, DENSITY_DETAILED), false);
  assert.equal(writeModelListDensity({ setItem: () => {} }, "verbose"), false);
  const throwing = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  assert.equal(readModelListDensity(throwing), DENSITY_COMPACT);
  assert.equal(writeModelListDensity(throwing, DENSITY_DETAILED), false);
});

// ── 工单 #33：组头计数与全选三态 ────────────────────────────────────────────

test("groupCountText：无搜索只写总数，搜索中写命中数/总数（含 0 命中）", () => {
  assert.equal(groupCountText(3, 1, false), "3");
  assert.equal(groupCountText(3, 1, true), "1/3");
  assert.equal(groupCountText(3, 0, true), "0/3");
  assert.equal(groupCountText(0, 0, true), "0/0");
  assert.equal(groupCountText(3, 9, true), "3/3", "命中数不会超过总数");
  assert.equal(groupCountText(-1, -2, true), "0/0", "非法输入安静回落 0");
  assert.equal(groupCountText("3", 1, true), "0/0");
});

test("selectAllCheckboxState：全选 / 半选 / 未选三态与 aria 文案", () => {
  assert.deepEqual(selectAllCheckboxState(8, 8), { all: true, some: false, label: "已全选 8 条" });
  assert.deepEqual(selectAllCheckboxState(8, 3), { all: false, some: true, label: "已选 3 / 8 条" });
  assert.deepEqual(selectAllCheckboxState(8, 0), { all: false, some: false, label: "全选" });
  assert.deepEqual(selectAllCheckboxState(0, 0), { all: false, some: false, label: "全选" });
  assert.deepEqual(selectAllCheckboxState(8, 9), { all: true, some: false, label: "已全选 8 条" }, "超出上限按全选");
  assert.deepEqual(selectAllCheckboxState(8, -1), { all: false, some: false, label: "全选" });
  assert.deepEqual(selectAllCheckboxState("8", 3), { all: false, some: false, label: "全选" });
});
