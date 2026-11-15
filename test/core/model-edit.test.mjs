// 工单 #38：编辑模型时清空 token 字段、输入模态校验与输入层 / 逻辑层共享判定。
//
// 这里只钉纯逻辑：空串 = 删除该字段、字段本来就缺失时不写多余的 unset、
// 共享的 token 判定覆盖所有边界值，以及「两个模态都不勾」的显式错误码。
// 真实 DOM 下的提示文案、保存按钮与写入结果见
// test/client/model-clear-fields.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_FORM_ERRORS,
  TOKEN_INPUT,
  classifyTokenInput,
  diffRow,
  formFromModel,
  splitEditDiff,
  validateEditForm,
} from "../../src/core/model-edit.js";

const existingRow = Object.freeze({
  id: "jxf/dsv4.1-pro",
  name: "jxf/dsv4.1-pro",
  contextWindow: 131072,
  maxTokens: 32768,
  input: ["text"],
  reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
  compat: { supportsReasoningEffort: true, nested: { keep: true } },
});

test("classifyTokenInput：空串 / 纯空白是合法清空，不是错误", () => {
  for (const value of ["", "   ", "\t", undefined, null]) {
    assert.deepEqual(classifyTokenInput(value), { status: TOKEN_INPUT.EMPTY }, `value=${JSON.stringify(value)}`);
  }
});

test("classifyTokenInput：十进制正整数合法，带前导零按数值归一", () => {
  assert.deepEqual(classifyTokenInput("131072"), { status: TOKEN_INPUT.VALID, value: 131072 });
  assert.deepEqual(classifyTokenInput("007"), { status: TOKEN_INPUT.VALID, value: 7 });
  assert.deepEqual(classifyTokenInput(" 42 "), { status: TOKEN_INPUT.VALID, value: 42 });
  assert.deepEqual(classifyTokenInput(42), { status: TOKEN_INPUT.VALID, value: 42 });
});

test("classifyTokenInput：0 / 负数 / 非数字 / 小数 / 指数一律非法", () => {
  for (const value of ["0", "-1", "-131072", "abc", "12.5", "1e3", "+42", "0x10", 0, -1, 1.5, Number.NaN]) {
    assert.equal(classifyTokenInput(value).status, TOKEN_INPUT.INVALID, `value=${JSON.stringify(value)}`);
  }
});

test("classifyTokenInput：超出安全整数范围的超长数字非法", () => {
  const tooLarge = String(Number.MAX_SAFE_INTEGER + 10);
  for (const value of ["99999999999999999999", tooLarge, Number.MAX_SAFE_INTEGER + 10]) {
    assert.equal(classifyTokenInput(value).status, TOKEN_INPUT.INVALID, `value=${JSON.stringify(value)}`);
  }
  assert.equal(classifyTokenInput(String(Number.MAX_SAFE_INTEGER)).status, TOKEN_INPUT.VALID);
});

test("diffRow：清空已有 contextWindow → 明确表示删除该字段", () => {
  const form = { ...formFromModel(existingRow), contextWindow: "" };
  assert.deepEqual(diffRow(form, existingRow), { contextWindow: null });
});

test("diffRow：清空已有 maxTokens → 明确表示删除该字段", () => {
  const form = { ...formFromModel(existingRow), maxTokens: "" };
  assert.deepEqual(diffRow(form, existingRow), { maxTokens: null });
});

test("diffRow：现有字段本来就没有 + 表单空串 → 不产生任何变化", () => {
  const bare = { id: "bare/model", input: ["text"] };
  const form = formFromModel(bare);
  assert.equal(form.contextWindow, "");
  assert.equal(form.maxTokens, "");
  assert.deepEqual(diffRow(form, bare), {});
});

test("diffRow：两个 token 字段同时清空 → 两条 unset 结果", () => {
  const form = { ...formFromModel(existingRow), contextWindow: "", maxTokens: "" };
  assert.deepEqual(diffRow(form, existingRow), { contextWindow: null, maxTokens: null });
});

test("diffRow：007 是合法输入；与已有 7 相同不产生改动，与 8 不同写出 7", () => {
  const seven = { ...existingRow, contextWindow: 7 };
  const form = formFromModel(seven);
  assert.deepEqual(diffRow({ ...form, contextWindow: "007" }, seven), {});
  assert.deepEqual(diffRow({ ...form, contextWindow: "007" }, existingRow), { contextWindow: 7 });
});

test("diffRow：非法 token 输入不产生写入（输入层已拦截）", () => {
  const form = { ...formFromModel(existingRow), contextWindow: "abc", maxTokens: "0" };
  assert.deepEqual(diffRow(form, existingRow), {});
});

test("splitEditDiff：把删除标记（null）与要写入的值分开", () => {
  assert.deepEqual(
    splitEditDiff({ contextWindow: null, maxTokens: 48000, reasoning: { mode: "effort", levels: ["low"] } }),
    {
      values: { maxTokens: 48000, reasoning: { mode: "effort", levels: ["low"] } },
      unset: ["contextWindow"],
    },
  );
  assert.deepEqual(splitEditDiff({}), { values: {}, unset: [] });
});

test("validateEditForm：两个模态都不勾且现有 input 非空 → input-empty 错误码", () => {
  const form = { ...formFromModel(existingRow), inputText: false, inputImage: false };
  assert.deepEqual(validateEditForm(form, existingRow), EDIT_FORM_ERRORS.INPUT_EMPTY);
  assert.equal(EDIT_FORM_ERRORS.INPUT_EMPTY.code, "input-empty");
  assert.equal(EDIT_FORM_ERRORS.INPUT_EMPTY.message, "至少保留一个输入模态（宿主会拒绝空 input）");
});

test("validateEditForm：保留一个模态即可保存", () => {
  const withText = { ...formFromModel(existingRow), inputText: true, inputImage: false };
  const withImage = { ...formFromModel(existingRow), inputText: false, inputImage: true };
  assert.equal(validateEditForm(withText, existingRow), null);
  assert.equal(validateEditForm(withImage, existingRow), null);
});

test("validateEditForm：现有 input 缺失或为空数组时全不勾不是错误（本来就没声明）", () => {
  const bothOff = { ...formFromModel(existingRow), inputText: false, inputImage: false };
  assert.equal(validateEditForm(bothOff, { id: "bare/model" }), null);
  assert.equal(validateEditForm(bothOff, { id: "empty/model", input: [] }), null);
  assert.equal(validateEditForm(bothOff, { id: "text/model", input: ["text"] }), EDIT_FORM_ERRORS.INPUT_EMPTY);
});
