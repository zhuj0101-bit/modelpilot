// 内置模型预设：数值表、查找、表单 / 模板投影与命中检测。
// 全部纯函数，不依赖 DOM 或宿主。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const presets = await import(pathToFileURL(join(root, "src", "core", "model-presets.js")).href);
const templates = await import(pathToFileURL(join(root, "src", "core", "default-template.js")).href);

const {
  MODEL_PRESETS,
  MODEL_PRESET_IDS,
  detectPreset,
  findModelPreset,
  presetToForm,
  presetToTemplate,
} = presets;
const { formToTemplate, normalizeTemplate } = templates;

const TABLE = [
  {
    id: "basic",
    label: "基础对话",
    contextWindow: "128000",
    maxTokens: "8192",
    inputText: true,
    inputImage: false,
    levels: ["off", "low", "medium", "high"],
  },
  {
    id: "coding",
    label: "代码",
    contextWindow: "200000",
    maxTokens: "16384",
    inputText: true,
    inputImage: false,
    levels: ["off", "low", "medium", "high"],
  },
  {
    id: "long",
    label: "长文档",
    contextWindow: "1000000",
    maxTokens: "8192",
    inputText: true,
    inputImage: false,
    levels: ["off", "low", "medium", "high"],
  },
];

test("三个预设的数值与工单表格逐项相同", () => {
  assert.equal(MODEL_PRESETS.length, 3);
  assert.deepEqual(MODEL_PRESET_IDS, ["basic", "coding", "long"]);
  for (const [index, expected] of TABLE.entries()) {
    const preset = MODEL_PRESETS[index];
    assert.equal(preset.id, expected.id);
    assert.equal(preset.label, expected.label);
    assert.equal(typeof preset.hint, "string");
    // title 必须写清具体数值，不用点开就知道填什么。
    assert.ok(preset.hint.includes(`上下文 ${expected.contextWindow}`), preset.hint);
    assert.ok(preset.hint.includes(`输出 ${expected.maxTokens}`), preset.hint);
    // 悬停说明每行 ≤ 40 字（与 test/client/hint-copy-trim.test.mjs 的约束一致）。
    for (const line of preset.hint.split("\n")) {
      assert.ok(line.length <= 40, `${preset.id} 的悬停说明过长（${line.length}）：${line}`);
    }
    assert.equal(preset.values.contextWindow, expected.contextWindow);
    assert.equal(preset.values.maxTokens, expected.maxTokens);
    assert.equal(preset.values.inputText, expected.inputText);
    assert.equal(preset.values.inputImage, expected.inputImage);
    assert.deepEqual([...preset.values.reasoningLevels], expected.levels);
  }
});

test("预设是冻结的纯数据：改不动原对象", () => {
  assert.equal(Object.isFrozen(MODEL_PRESETS), true);
  assert.equal(Object.isFrozen(MODEL_PRESETS[0]), true);
  assert.equal(Object.isFrozen(MODEL_PRESETS[0].values), true);
  assert.equal(Object.isFrozen(MODEL_PRESETS[0].values.reasoningLevels), true);
  assert.throws(() => { MODEL_PRESETS[0].values.contextWindow = "1"; }, TypeError);
});

test("findModelPreset：已知 id 返回预设，未知 / 非字符串返回 null 且不抛", () => {
  assert.equal(findModelPreset("basic"), MODEL_PRESETS[0]);
  assert.equal(findModelPreset("coding"), MODEL_PRESETS[1]);
  assert.equal(findModelPreset("long"), MODEL_PRESETS[2]);
  assert.equal(findModelPreset("longchat"), null);
  assert.equal(findModelPreset(""), null);
  assert.equal(findModelPreset(null), null);
  assert.equal(findModelPreset(undefined), null);
  assert.equal(findModelPreset(1), null);
  assert.equal(findModelPreset({ id: "basic" }), null);
});

test("presetToForm：与 templateToForm 同构，且返回独立副本", () => {
  assert.deepEqual(presetToForm(MODEL_PRESETS[0]), {
    contextWindow: "128000",
    maxTokens: "8192",
    inputText: true,
    inputImage: false,
    reasoningLevels: ["off", "low", "medium", "high"],
  });
  assert.deepEqual(presetToForm(MODEL_PRESETS[1]), {
    contextWindow: "200000",
    maxTokens: "16384",
    inputText: true,
    inputImage: false,
    reasoningLevels: ["off", "low", "medium", "high"],
  });
  assert.deepEqual(presetToForm(MODEL_PRESETS[2]), {
    contextWindow: "1000000",
    maxTokens: "8192",
    inputText: true,
    inputImage: false,
    reasoningLevels: ["off", "low", "medium", "high"],
  });
  const form = presetToForm(MODEL_PRESETS[0]);
  form.reasoningLevels.push("max");
  assert.deepEqual([...MODEL_PRESETS[0].values.reasoningLevels], ["off", "low", "medium", "high"]);
});

test("presetToForm：结构非法返回 null，不抛", () => {
  assert.equal(presetToForm(null), null);
  assert.equal(presetToForm(undefined), null);
  assert.equal(presetToForm({}), null);
  assert.equal(presetToForm({ values: null }), null);
  assert.equal(presetToForm({ values: { inputText: false, inputImage: false } }), null);
});

test("presetToTemplate 能被 normalizeTemplate 接受，且与 formToTemplate 往返一致", () => {
  for (const preset of MODEL_PRESETS) {
    const template = normalizeTemplate(presetToTemplate(preset));
    assert.notEqual(template, null);
    assert.equal(template.version, 1);
    assert.equal(template.contextWindow, preset.values.contextWindow);
    assert.equal(template.maxTokens, preset.values.maxTokens);
    assert.deepEqual(formToTemplate(presetToForm(preset)), template);
  }
});

test("detectPreset：精确命中返回预设 id", () => {
  assert.equal(detectPreset(presetToForm(MODEL_PRESETS[0])), "basic");
  assert.equal(detectPreset(presetToForm(MODEL_PRESETS[1])), "coding");
  assert.equal(detectPreset(presetToForm(MODEL_PRESETS[2])), "long");
});

test("detectPreset：上下文写成字符串或数字都算命中", () => {
  const form = presetToForm(MODEL_PRESETS[0]);
  assert.equal(detectPreset({ ...form, contextWindow: 128000 }), "basic");
  assert.equal(detectPreset({ ...form, maxTokens: 8192 }), "basic");
  assert.equal(detectPreset({ ...form, contextWindow: " 128000 " }), "basic");
});

test("detectPreset：改任何一个字段都返回 null", () => {
  const form = presetToForm(MODEL_PRESETS[0]);
  assert.equal(detectPreset({ ...form, contextWindow: "999" }), null);
  assert.equal(detectPreset({ ...form, maxTokens: "999" }), null);
  assert.equal(detectPreset({ ...form, inputImage: true }), null);
  assert.equal(detectPreset({ ...form, inputText: false }), null);
  assert.equal(detectPreset({ ...form, reasoningLevels: ["off", "low", "medium"] }), null);
  assert.equal(detectPreset({ ...form, reasoningLevels: ["off", "low", "medium", "high", "max"] }), null);
  assert.equal(detectPreset({ ...form, reasoningLevels: ["off", "medium", "low", "high"] }), null);
});

test("detectPreset：空表单 / 空值 / 非对象返回 null", () => {
  assert.equal(detectPreset({}), null);
  assert.equal(detectPreset({ contextWindow: "", maxTokens: "", inputText: true, inputImage: false, reasoningLevels: [] }), null);
  assert.equal(detectPreset(null), null);
  assert.equal(detectPreset(undefined), null);
  assert.equal(detectPreset([]), null);
  assert.equal(detectPreset("basic"), null);
});

test("detectPreset：不同预设之间不会串味", () => {
  const basic = presetToForm(MODEL_PRESETS[0]);
  const coding = presetToForm(MODEL_PRESETS[1]);
  assert.equal(detectPreset({ ...coding, maxTokens: basic.maxTokens }), null);
  assert.equal(detectPreset({ ...basic, contextWindow: coding.contextWindow }), null);
});
