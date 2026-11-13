// 推理档位复选框组的纯逻辑测试。
// 覆盖工单要求的四种状态：全选 / 只勾 off / 全不选 / 恢复默认，
// 并断言投影引擎的 R5 守卫与字典键序。

import test from "node:test";
import assert from "node:assert/strict";
import { PI_AI_LEVELS } from "../../src/core/domain.js";
import { projectPiAi } from "../../src/core/pi-ai-projection.js";
import {
  DEFAULT_REASONING_LEVELS,
  allReasoningLevels,
  defaultReasoningLevels,
  noReasoningLevels,
  reasoningLevelsGuard,
  reasoningPolicyFor,
  toggleReasoningLevel,
} from "../../src/client/reasoning-levels.js";

const emptyRoute = { providers: { route: { models: [] } }, catalogModels: new Set() };
const project = (levels) => {
  const draft = { id: "new-model" };
  const reasoning = reasoningPolicyFor(levels);
  if (reasoning !== undefined) draft.reasoning = reasoning;
  return projectPiAi(draft, emptyRoute, { routeId: "route" });
};

test("默认勾选 off / low / medium / high", () => {
  assert.deepEqual(DEFAULT_REASONING_LEVELS, ["off", "low", "medium", "high"]);
  assert.deepEqual(defaultReasoningLevels(), ["off", "low", "medium", "high"]);
});

test("全选：七个档位按 PI_AI_LEVELS 顺序", () => {
  assert.deepEqual(allReasoningLevels(), [...PI_AI_LEVELS]);
  assert.deepEqual(allReasoningLevels(), ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
});

test("恢复默认：从全选回到默认四项", () => {
  let levels = allReasoningLevels();
  assert.equal(levels.length, 7);
  levels = defaultReasoningLevels();
  assert.deepEqual(levels, ["off", "low", "medium", "high"]);
  assert.deepEqual(levels, [...DEFAULT_REASONING_LEVELS]);
});

test("全不选：不构造 reasoning 策略，投影不含 reasoningEfforts", () => {
  const levels = noReasoningLevels();
  assert.deepEqual(levels, []);
  assert.equal(reasoningPolicyFor(levels), undefined);
  assert.equal(reasoningLevelsGuard(levels), null);

  const result = project([...levels]);
  assert.equal(result.settingsOps.length, 1);
  const row = result.settingsOps[0].value;
  assert.equal("reasoningEfforts" in row, false);
  assert.equal(result.appliedFields.includes("reasoningEfforts"), false);
});

test("只勾 off：R5 守卫拦下并给出 efforts-only-off 说明，投影丢弃全部操作", () => {
  const levels = toggleReasoningLevel([], "off");
  assert.deepEqual(levels, ["off"]);
  assert.match(reasoningLevelsGuard(levels), /efforts-only-off/);

  const result = project(levels);
  assert.deepEqual(result.settingsOps, []);
  assert.ok(
    result.unsupportedControls.some((control) => control.control === "reasoningEfforts" && control.reason === "efforts-only-off"),
    "projection reports efforts-only-off",
  );
});

test("勾选顺序无关：始终按 PI_AI_LEVELS 排序，投影字典键序一致", () => {
  let levels = [];
  for (const level of ["high", "off", "max", "low"]) levels = toggleReasoningLevel(levels, level);
  assert.deepEqual(levels, ["off", "low", "high", "max"]);

  const full = project(allReasoningLevels());
  const row = full.settingsOps[0].value;
  assert.deepEqual(Object.keys(row.reasoningEfforts), [...PI_AI_LEVELS]);
  assert.equal(row.reasoningEfforts.off, null);
});
