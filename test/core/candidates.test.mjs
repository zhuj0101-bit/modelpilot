// P1-02 测试：CandidateEngine 8 级合成 + 短路语义。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { synthesizeCandidates } = await import(pathToFileURL(join(root, "src", "core", "candidates.js")).href);

test("完整链路：每个字段的优先级为 档案 > 目录 > 模板 > 预设 > 默认", () => {
  const result = synthesizeCandidates({
    profile: { contextState: "value", contextValue: 555555, budgetState: "value", budgetValue: 4444, inputState: "value", inputValue: ["text"], reasoningState: "value", reasoningValue: { mode: "effort", defaultLevel: "low" } },
    resolved: { context: 262144, inputModalities: ["text", "image"], reasoningControls: [{ kind: "effort", values: ["low", "high"] }] },
    template: { contextWindow: 999, outputBudget: 999, input: ["text"], reasoning: { mode: "inherit" } },
    preset: { contextWindow: 32768, outputBudget: 4096, input: ["text"] },
  });
  assert.equal(result.fields.contextWindow.candidate.value, 555555);
  assert.equal(result.fields.outputBudget.candidate.value, 4444);
  assert.equal(result.fields.input.candidate.via, "profile");
  assert.equal(result.fields.reasoning.candidate.via, "profile");
  assert.deepEqual(result.shortCircuited, []);
});

test("无档案：目录的上下文胜出；预算跳过目录（能力≠预算）", () => {
  const result = synthesizeCandidates({
    resolved: { context: 262144, outputLimit: 65536, inputModalities: ["text"], reasoningControls: [{ kind: "effort", values: ["low", "medium", "high"] }] },
    preset: { contextWindow: 32768, outputBudget: 4096, input: ["text"] },
  });
  assert.equal(result.fields.contextWindow.candidate.value, 262144);
  assert.equal(result.fields.contextWindow.candidate.via, "catalog");
  // 预算从不继承目录的能力值
  assert.equal(result.fields.outputBudget.candidate.via, "preset");
  assert.equal(result.fields.input.candidate.value.join(), "text");
  assert.equal(result.fields.reasoning.candidate.value.mode, "effort");
  assert.equal(result.fields.reasoning.candidate.value.defaultLevel, "low");
});

test("已触碰短路：迟到的目录结果不覆盖用户编辑", () => {
  const result = synthesizeCandidates({
    touched: new Set(["contextWindow"]),
    resolved: { context: 262144, inputModalities: ["text"] },
  });
  assert.deepEqual(result.shortCircuited, ["contextWindow"]);
  assert.ok(result.fields.contextWindow.shortCircuited);
});

test("已锁定短路与已触碰相同", () => {
  const result = synthesizeCandidates({ locked: new Set(["reasoning"]), resolved: { reasoningControls: [{ kind: "effort", values: ["low"] }] } });
  assert.ok(result.fields.reasoning.shortCircuited);
});

test("已清除字段绝不自动填充（a.md §3.B 闭环）", () => {
  const result = synthesizeCandidates({
    profile: { contextState: "cleared", budgetState: "inherit", inputState: "cleared" },
    resolved: { context: 262144, inputModalities: ["text", "image"] },
    preset: { contextWindow: 32768, outputBudget: 4096 },
  });
  assert.ok(result.fields.contextWindow.shortCircuited === false);
  // 已清除 → 该字段不从任何层级挑选候选：
  assert.equal(result.fields.contextWindow.candidate, undefined);
  assert.equal(result.fields.input.candidate, undefined);
  // 继承 → 下落到目录
  assert.equal(result.fields.outputBudget.candidate.via, "preset");
});

test("未知模型：默认值仍产出建议（未知但不为空）", () => {
  const result = synthesizeCandidates({});
  assert.equal(result.fields.contextWindow.candidate, undefined); // 未编造上下文默认值
  assert.equal(result.fields.outputBudget.candidate.via, "default-budget");
  assert.deepEqual(result.fields.input.candidate.value, ["text"]);
  assert.equal(result.fields.reasoning.candidate.value.mode, "inherit");
});

test("仅 toggle 的推理能力映射为禁用策略", () => {
  const result = synthesizeCandidates({ resolved: { reasoningControls: [{ kind: "toggle" }] } });
  assert.equal(result.fields.reasoning.candidate.value.mode, "disabled");
});

test("输入模态过滤为宿主支持的集合（pdf/audio 保留在证据中，从值中剔除）", () => {
  const result = synthesizeCandidates({ resolved: { inputModalities: ["text", "image", "pdf", "audio"] } });
  assert.deepEqual(result.fields.input.candidate.value, ["text", "image"]);
});
