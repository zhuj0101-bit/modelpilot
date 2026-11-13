// 默认模板：localStorage 读写、结构收敛、表单投影与描述。
// storage 全部注入内存桩，覆盖损坏数据与隐私模式抛异常的情况。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const repo = await import(pathToFileURL(join(root, "src", "core", "default-template.js")).href);

const {
  DEFAULT_TEMPLATE_KEY,
  describeTemplate,
  formToTemplate,
  normalizeTemplate,
  readDefaultTemplate,
  removeDefaultTemplate,
  templateToForm,
  writeDefaultTemplate,
} = repo;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const sample = {
  contextWindow: "131072",
  maxTokens: "8192",
  inputText: true,
  inputImage: false,
  reasoningLevels: ["off", "low", "medium", "high"],
};

test("空 storage：readDefaultTemplate 返回 null", () => {
  assert.equal(readDefaultTemplate(memoryStorage()), null);
});

test("写入后读回：字段逐一相等", () => {
  const storage = memoryStorage();
  assert.equal(writeDefaultTemplate(storage, sample), true);
  assert.deepEqual(readDefaultTemplate(storage), { version: 1, ...sample });
});

test("两个模态都没勾：写入返回 false 且 storage 未变化", () => {
  const storage = memoryStorage();
  assert.equal(writeDefaultTemplate(storage, sample), true);
  const before = storage.getItem(DEFAULT_TEMPLATE_KEY);
  assert.equal(writeDefaultTemplate(storage, { ...sample, inputText: false, inputImage: false }), false);
  assert.equal(storage.getItem(DEFAULT_TEMPLATE_KEY), before);
});

test("storage 里的 JSON 损坏：返回 null 且不抛", () => {
  const storage = memoryStorage();
  storage.setItem(DEFAULT_TEMPLATE_KEY, "{bad");
  assert.equal(readDefaultTemplate(storage), null);
});

test("storage 里的结构不合法：返回 null", () => {
  const storage = memoryStorage();
  storage.setItem(DEFAULT_TEMPLATE_KEY, "{}");
  assert.equal(readDefaultTemplate(storage), null);
});

test("removeDefaultTemplate 后读回 null", () => {
  const storage = memoryStorage();
  writeDefaultTemplate(storage, sample);
  assert.equal(removeDefaultTemplate(storage), true);
  assert.equal(readDefaultTemplate(storage), null);
});

test("getItem 抛异常（隐私模式）：返回 null 且不抛", () => {
  const storage = { getItem: () => { throw new Error("denied"); } };
  assert.equal(readDefaultTemplate(storage), null);
});

test("setItem 抛异常：返回 false 且不抛", () => {
  const storage = { setItem: () => { throw new Error("quota"); } };
  assert.equal(writeDefaultTemplate(storage, sample), false);
});

test("storage 为 undefined：三个函数安全返回 null / false / false", () => {
  assert.equal(readDefaultTemplate(undefined), null);
  assert.equal(writeDefaultTemplate(undefined, sample), false);
  assert.equal(removeDefaultTemplate(undefined), false);
});

test("templateToForm(null)：空表单 + 默认档位", () => {
  assert.deepEqual(templateToForm(null), {
    contextWindow: "",
    maxTokens: "",
    inputText: true,
    inputImage: false,
    reasoningLevels: ["off", "low", "medium", "high"],
  });
});

test("templateToForm(template)：返回值是副本", () => {
  const template = normalizeTemplate(sample);
  const form = templateToForm(template);
  assert.equal(form.contextWindow, "131072");
  assert.equal(form.maxTokens, "8192");
  assert.equal(form.inputText, true);
  assert.equal(form.inputImage, false);
  assert.deepEqual(form.reasoningLevels, ["off", "low", "medium", "high"]);
  form.reasoningLevels.push("max");
  assert.deepEqual(template.reasoningLevels, ["off", "low", "medium", "high"]);
});

test("formToTemplate 与 templateToForm 往返一致", () => {
  const template = normalizeTemplate(sample);
  assert.deepEqual(formToTemplate(templateToForm(template)), template);
});

test("describeTemplate 无模板：空字符串", () => {
  assert.equal(describeTemplate(null, () => "?"), "");
});

test("describeTemplate 完整模板：含四段", () => {
  const template = normalizeTemplate({ ...sample, inputImage: true });
  const parts = describeTemplate(template, (n) => (String(n) === "131072" ? "131K" : "8K")).split(" · ");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "上下文 131072（131K）");
  assert.equal(parts[1], "输出 8192（8K）");
  assert.equal(parts[2], "text + image");
  assert.equal(parts[3], "off,low,medium,high");
});

test("describeTemplate 空档位：含「不写档位」", () => {
  const template = normalizeTemplate({ ...sample, reasoningLevels: [] });
  const text = describeTemplate(template, (n) => `${n}`);
  assert.ok(text.endsWith("不写档位"));
});
