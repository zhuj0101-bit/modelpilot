// 工单 #43 缺陷 5：模板摘要里的「表单已改动」判定（纯逻辑）。
//
// templateMatchesForm 只回答「表单值是否就是这份模板的值」，不判断命中了哪个
// 预设；比对规则见 default-template.js 的注释：token 去空白后逐字比较、两个
// 模态按布尔比较、推理档位按集合比较（顺序无关）。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const repo = await import(pathToFileURL(join(root, "src", "core", "default-template.js")).href);

const { normalizeTemplate, templateMatchesForm } = repo;

const TEMPLATE = {
  contextWindow: "128000",
  maxTokens: "8192",
  inputText: true,
  inputImage: false,
  reasoningLevels: ["off", "low", "medium", "high"],
};

/** 模板值 → 表单值（templateToForm 同构；这里手写避免测试依赖被测转换）。 */
const form = (overrides = {}) => ({
  contextWindow: "128000",
  maxTokens: "8192",
  inputText: true,
  inputImage: false,
  reasoningLevels: ["off", "low", "medium", "high"],
  ...overrides,
});

test("templateMatchesForm：逐字段完全相同 → true", () => {
  assert.equal(templateMatchesForm(TEMPLATE, form()), true);
  // 模板里的 values 带着 version 字段（normalizeTemplate 的产物）也能比。
  assert.equal(templateMatchesForm(normalizeTemplate(TEMPLATE), form()), true);
});

test("templateMatchesForm：contextWindow 差一位 → false", () => {
  assert.equal(templateMatchesForm(TEMPLATE, form({ contextWindow: "128001" })), false);
  assert.equal(templateMatchesForm(TEMPLATE, form({ contextWindow: "12800" })), false);
  // 只差首尾空白不算改动：用户从别处粘贴时不该被提示「已改动」。
  assert.equal(templateMatchesForm(TEMPLATE, form({ contextWindow: " 128000 " })), true);
});

test("templateMatchesForm：maxTokens 不同 → false", () => {
  assert.equal(templateMatchesForm(TEMPLATE, form({ maxTokens: "4096" })), false);
});

test("templateMatchesForm：inputImage / inputText 不同 → false", () => {
  assert.equal(templateMatchesForm(TEMPLATE, form({ inputImage: true })), false);
  assert.equal(templateMatchesForm(TEMPLATE, form({ inputText: false })), false);
  assert.equal(
    templateMatchesForm({ ...TEMPLATE, inputImage: true }, form({ inputImage: true })),
    true,
  );
});

test("templateMatchesForm：reasoningLevels 顺序不同但集合相同 → true", () => {
  assert.equal(templateMatchesForm(TEMPLATE, form({ reasoningLevels: ["high", "off", "medium", "low"] })), true);
  // 少一档 / 多一档仍是不同。
  assert.equal(templateMatchesForm(TEMPLATE, form({ reasoningLevels: ["off", "low", "medium"] })), false);
  assert.equal(templateMatchesForm(TEMPLATE, form({ reasoningLevels: ["off", "low", "medium", "high", "max"] })), false);
});

test("templateMatchesForm：结构非法（两个模态都没勾 / 不是对象）→ false，不抛", () => {
  assert.equal(templateMatchesForm(TEMPLATE, form({ inputText: false, inputImage: false })), false);
  assert.equal(templateMatchesForm({ ...TEMPLATE, inputText: false, inputImage: false }, form()), false);
  for (const bad of [null, undefined, 42, "x", []]) {
    assert.equal(templateMatchesForm(TEMPLATE, bad), false, `form=${String(bad)}`);
    assert.equal(templateMatchesForm(bad, form()), false, `values=${String(bad)}`);
  }
});
