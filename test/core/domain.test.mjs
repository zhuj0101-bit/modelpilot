// 工作台「显示名跟随模型 ID」的纯推导规则（B4）。
// 客户端只负责 touched 标记与状态写入；去掉前缀这件事必须在领域层可测。

import test from "node:test";
import assert from "node:assert/strict";
import { displayNameFromModelId, humanizeTokenCount } from "../../src/core/domain.js";

test("带前缀的模型 ID：取最后一段", () => {
  assert.equal(displayNameFromModelId("tflow/alpha-32b"), "alpha-32b");
  assert.equal(displayNameFromModelId("other/beta"), "beta");
  assert.equal(displayNameFromModelId("x/y"), "y");
});

test("无斜杠的模型 ID：显示名等于模型 ID 本身", () => {
  assert.equal(displayNameFromModelId("sn-deepseek-v4-1-flash-1017"), "sn-deepseek-v4-1-flash-1017");
});

test("多段模型 ID：只保留最后一段", () => {
  assert.equal(displayNameFromModelId("a/b/c"), "c");
});

test("空模型 ID：显示名为空字符串", () => {
  assert.equal(displayNameFromModelId(""), "");
});

test("结果去掉首尾空白（含最后一段为空的情况）", () => {
  assert.equal(displayNameFromModelId("  tflow/alpha-32b  "), "alpha-32b");
  assert.equal(displayNameFromModelId("a/b/ c "), "c");
  assert.equal(displayNameFromModelId("tflow/"), "");
});

test("humanizeTokenCount：问题 2 表中的 K/M 表示法", () => {
  const cases = [
    [0, ""],
    [-1, ""],
    ["abc", ""],
    [999, "999"],
    [1000, "1K"],
    [8192, "8K"],
    [131072, "131K"],
    [200000, "200K"],
    [262144, "262K"],
    [1000000, "1M"],
    [1048576, "1M"],
    [1500000, "1.5M"],
    [2000000, "2M"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(humanizeTokenCount(input), expected, `humanizeTokenCount(${input})`);
  }
});

test("humanizeTokenCount：非数字与非正数返回空字符串", () => {
  assert.equal(humanizeTokenCount("abc"), "");
  assert.equal(humanizeTokenCount(-1), "");
  assert.equal(humanizeTokenCount(Number.NaN), "");
  assert.equal(humanizeTokenCount(Number.POSITIVE_INFINITY), "");
});
