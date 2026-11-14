// 工单 #23：推理档位「API 参数值」三条硬规则的纯逻辑测试。
//
// 覆盖：留空 = 用档位名；off 不参与；只保留勾选中的档位；与档位名相同的值
// 不写；折叠摘要计数；creat 表单策略与投影的衔接。

import test from "node:test";
import assert from "node:assert/strict";
import {
  customWireCount,
  sameWireMap,
  wireMapFromApiValues,
  wireMapFromEfforts,
} from "../../src/core/reasoning-wire.js";
import { reasoningPolicyFor, customReasoningWireCount } from "../../src/client/reasoning-levels.js";
import { projectPiAi } from "../../src/core/pi-ai-projection.js";

const emptyRoute = { providers: { route: { models: [] } }, catalogModels: new Set() };
const project = (levels, apiValues) => {
  const draft = { id: "new-model" };
  const reasoning = reasoningPolicyFor(levels, apiValues);
  if (reasoning !== undefined) draft.reasoning = reasoning;
  return projectPiAi(draft, emptyRoute, { routeId: "route" });
};

test("wireMapFromApiValues：只写与档位名不同的非空值", () => {
  assert.deepEqual(
    wireMapFromApiValues(["off", "low", "high", "xhigh"], {
      off: "ignored",
      low: "   ",
      high: " high_reasoning ",
      xhigh: "max",
    }),
    { high: "high_reasoning", xhigh: "max" },
  );
});

test("wireMapFromApiValues：留空 / 与档位名相同 → 不写 key（不写空串）", () => {
  assert.deepEqual(wireMapFromApiValues(["low", "medium", "high"], { low: "", medium: "   ", high: "high" }), {});
});

test("wireMapFromApiValues：只保留当前勾选的档位（取消勾选即丢弃）", () => {
  assert.deepEqual(
    wireMapFromApiValues(["off", "high"], { low: "reasoning_low", high: "high_reasoning", xhigh: "max" }),
    { high: "high_reasoning" },
  );
  assert.deepEqual(wireMapFromApiValues([], { high: "high_reasoning" }), {});
});

test("wireMapFromApiValues：未知档位键与非字符串值都忽略", () => {
  const apiValues = { high: "high_reasoning", bogus: "x", low: 42 };
  assert.deepEqual(wireMapFromApiValues(["off", "low", "high", "bogus"], apiValues), { high: "high_reasoning" });
});

test("wireMapFromEfforts：只摘出与档位名不同的字符串，off 的 null / 同名值 / 未知键都忽略", () => {
  assert.deepEqual(
    wireMapFromEfforts({ off: null, low: "low", medium: "reasoning_medium", high: 42, bogus: "x" }),
    { medium: "reasoning_medium" },
  );
  assert.deepEqual(wireMapFromEfforts(false), {});
  assert.deepEqual(wireMapFromEfforts(undefined), {});
  assert.deepEqual(wireMapFromEfforts(["high"]), {});
});

test("wireMapFromEfforts：线上值先 trim，带首尾空白的同名值不算自定义映射", () => {
  assert.deepEqual(
    wireMapFromEfforts({ off: null, low: " low ", medium: "  ", high: " high_reasoning " }),
    { high: "high_reasoning" },
  );
});

test("sameWireMap：顺序无关；键或值不同即不等", () => {
  assert.equal(sameWireMap({ high: "max", low: "low" }, { low: "low", high: "max" }), true);
  assert.equal(sameWireMap({ high: "max" }, { high: "high" }), false);
  assert.equal(sameWireMap({ high: "max" }, { high: "max", low: "low" }), false);
  assert.equal(sameWireMap(undefined, {}), true);
});

test("customWireCount / customReasoningWireCount：折叠摘要只数当前勾选的自定义值", () => {
  const apiValues = { low: "reasoning_low", high: "high", xhigh: "max" };
  assert.equal(customWireCount(["off", "low", "high"], apiValues), 1);
  assert.equal(customReasoningWireCount(["off", "low", "high"], apiValues), 1);
  assert.equal(customReasoningWireCount(["off"], apiValues), 0);
});

test("reasoningPolicyFor：没有自定义值时省略 wireMap；有值时只包含勾选档位", () => {
  assert.deepEqual(reasoningPolicyFor(["off", "high"], {}), { mode: "effort", levels: ["off", "high"] });
  assert.deepEqual(reasoningPolicyFor(["off", "high"], { high: "high" }), {
    mode: "effort",
    levels: ["off", "high"],
  });
  assert.deepEqual(reasoningPolicyFor(["off", "high"], { high: "high_reasoning" }), {
    mode: "effort",
    levels: ["off", "high"],
    wireMap: { high: "high_reasoning" },
  });
  assert.equal(reasoningPolicyFor([], { high: "high_reasoning" }), undefined);
});

test("创建投影：high 填 high_reasoning → reasoningEfforts 含 off:null 与勾选的其他档位", () => {
  const result = project(["off", "low", "medium", "high"], { high: "high_reasoning" });
  assert.equal(result.settingsOps.length, 1);
  assert.deepEqual(result.settingsOps[0].value.reasoningEfforts, {
    off: null,
    low: "low",
    medium: "medium",
    high: "high_reasoning",
  });
  assert.equal(result.unsupportedControls.length, 0);
});

test("创建投影：所有输入框留空 / 纯空格 → 线上值回到档位名，不出现空串", () => {
  const result = project(["off", "low", "high"], { low: "   ", high: "" });
  assert.deepEqual(result.settingsOps[0].value.reasoningEfforts, { off: null, low: "low", high: "high" });
  assert.equal(result.unsupportedControls.length, 0);
});

test("创建投影：取消勾选已填自定义值的档位 → 字典里没有该 key", () => {
  const result = project(["off", "low"], { low: "reasoning_low", xhigh: "max" });
  assert.deepEqual(result.settingsOps[0].value.reasoningEfforts, { off: null, low: "reasoning_low" });
});

test("创建投影：只勾 off 仍被 R5 守卫拦下，wireMap 不影响该行为", () => {
  const result = project(["off"], { off: "x" });
  assert.deepEqual(result.settingsOps, []);
  assert.ok(result.unsupportedControls.some((item) => item.reason === "efforts-only-off"));
});
