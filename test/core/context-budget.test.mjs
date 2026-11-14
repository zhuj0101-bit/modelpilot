// 工单 #26 一期：maxTokens 可用上下文实算。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { COMPACTION_DEFAULTS, estimateContextBudget } = await import(
  pathToFileURL(join(root, "src", "core", "context-budget.js")).href
);

test("默认压缩常量来自 dsh-compaction-basic 的文档化默认值", () => {
  assert.deepEqual(COMPACTION_DEFAULTS, { thresholdRatio: 0.8, headroomTokens: 65536 });
});

test("1M 窗口 / 32K 输出：零损失，可用上下文等于 80% 上限", () => {
  const estimate = estimateContextBudget(1000000, 32768);
  assert.equal(estimate.ceiling, 800000);
  assert.equal(estimate.threshold, 800000);
  assert.equal(estimate.loss, 0);
  assert.equal(estimate.freeBoundary, 134464);
  assert.equal(estimate.ok, true);
});

test("1M 窗口 / 384K 输出：明显损失 31.2%", () => {
  const estimate = estimateContextBudget(1000000, 384000);
  assert.equal(estimate.ceiling, 800000);
  assert.equal(estimate.threshold, 550464);
  assert.equal(Number((estimate.loss * 100).toFixed(1)), 31.2);
  assert.equal(estimate.freeBoundary, 134464);
  assert.equal(estimate.ok, false);
});

test("1M 窗口 / 150K 输出：轻微损失 1.9%", () => {
  const estimate = estimateContextBudget(1000000, 150000);
  assert.equal(estimate.ceiling, 800000);
  assert.equal(estimate.threshold, 784464);
  assert.equal(Number((estimate.loss * 100).toFixed(1)), 1.9);
  assert.equal(estimate.ok, false);
});

test("freeBoundary 恰好等于输出上限时仍为零损失（边界）", () => {
  const zero = estimateContextBudget(1000000, 134464);
  assert.equal(zero.freeBoundary, 134464);
  assert.equal(zero.threshold, zero.ceiling);
  assert.equal(zero.loss, 0);
  assert.equal(zero.ok, true);

  const over = estimateContextBudget(1000000, 134465);
  assert.ok(over.loss > 0, "再多 1 个 token 就开始损失");
  assert.equal(over.ok, false);
});

test("无效窗口返回 null；无效输出按 0 处理", () => {
  for (const window of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, "1000"]) {
    assert.equal(estimateContextBudget(window, 32768), null, `window=${String(window)}`);
  }
  for (const maxTokens of [undefined, null, Number.NaN, -1, 0, "8192"]) {
    const estimate = estimateContextBudget(1000000, maxTokens);
    assert.equal(estimate.threshold, estimate.ceiling, `maxTokens=${String(maxTokens)}`);
    assert.equal(estimate.loss, 0);
    assert.equal(estimate.ok, true);
  }
});
