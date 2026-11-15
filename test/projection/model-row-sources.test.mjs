// 工单 #27：模型行摘要标注每个值的来源。
//
// 摘要必须区分「模型自己声明」「路由默认值」「三处都没有」三态；推理档位
// 没有路由级默认值，永远不带 ↑；内置目录的清单宿主没交给设置客户端，所以
// 默认不出现「目录」标记 —— 只有显式传入 catalogValueOf 这个扩展点才会。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { CATALOG_MARK, ROUTE_DEFAULT_MARK, describeModelRow, describeModelRowSource } = await import(
  pathToFileURL(join(root, "src", "core", "model-edit.js")).href
);
const { humanizeTokenCount } = await import(pathToFileURL(join(root, "src", "core", "domain.js")).href);

const routeDefaults = Object.freeze({
  defaultContextWindow: 1_000_000,
  defaultMaxTokens: 128_000,
  defaultInput: Object.freeze(["text"]),
});

const fullyDeclared = Object.freeze({
  id: "jxf/dsv4.1-pro",
  contextWindow: 131_072,
  maxTokens: 32_768,
  input: Object.freeze(["text"]),
  reasoningEfforts: Object.freeze({ off: null, low: "low", medium: "medium", high: "high" }),
});

const summaryOf = (model, route = routeDefaults, catalogValueOf) =>
  describeModelRowSource(model, humanizeTokenCount, route, catalogValueOf);

test("模型声明 contextWindow / maxTokens → 显示原值，不带任何来源标记", () => {
  const summary = summaryOf(fullyDeclared);
  assert.match(summary.text, /^窗口 131K · 输出 33K · text · 4 档$/);
  assert.equal(summary.text.includes(ROUTE_DEFAULT_MARK), false);
  assert.equal(summary.sources.contextWindow, "model");
  assert.equal(summary.sources.maxTokens, "model");
});

test("模型未声明 token、路由有默认值 → 显示 ↑ 标记与路由默认值", () => {
  const summary = summaryOf({ id: "m" });
  assert.match(summary.text, /^窗口 1M↑ · 输出 128K↑/);
  assert.equal(summary.sources.contextWindow, "route");
  assert.equal(summary.sources.maxTokens, "route");
});

test("模型未声明 token、路由也没有默认值 → 显示未设置，不带 ↑", () => {
  const summary = summaryOf({ id: "m" }, {});
  assert.match(summary.text, /^窗口 未设置 · 输出 未设置/);
  assert.equal(summary.text.includes(ROUTE_DEFAULT_MARK), false);
  assert.equal(summary.sources.contextWindow, "none");
  assert.equal(summary.sources.maxTokens, "none");
});

test("模型声明 input → 按声明显示，不带标记", () => {
  const summary = summaryOf({ id: "m", input: ["text", "image"] });
  assert.match(summary.text, /· text \/ image ·/);
  assert.equal(summary.sources.input, "model");
});

test("模型未声明 input、路由有 defaultInput → 模态带 ↑", () => {
  const summary = summaryOf({ id: "m" }, { defaultInput: ["text"] });
  assert.match(summary.text, /· text↑ ·/);
  assert.equal(summary.sources.input, "route");
});

test("路由 defaultInput 有多个模态 → ↑ 标在整个值末尾", () => {
  const summary = summaryOf({ id: "m" }, { defaultInput: ["text", "image"] });
  assert.match(summary.text, /· text \/ image↑ ·/);
});

test("模型声明 input: []（空数组）→ 算已声明，显示未设置且不带 ↑", () => {
  const summary = summaryOf({ id: "m", input: [] }, { defaultInput: ["text", "image"] });
  assert.match(summary.text, /· 未设置 ·/);
  assert.equal(summary.text.includes(ROUTE_DEFAULT_MARK), false);
  assert.equal(summary.sources.input, "model");
  assert.match(summary.title, /模态：模型声明空数组（一个模态都不开）/);
});

test("reasoningEfforts: false → 非推理，永远不带 ↑", () => {
  const summary = summaryOf({ id: "m", reasoningEfforts: false });
  assert.match(summary.text, /· 非推理$/);
  assert.equal(summary.sources.reasoningEfforts, "model");
});

test("reasoningEfforts 有 N 个键 → N 档，永远不带 ↑", () => {
  const summary = summaryOf({ id: "m", reasoningEfforts: { off: null, low: "low" } });
  assert.match(summary.text, /· 2 档$/);
  assert.equal(summary.sources.reasoningEfforts, "model");
});

test("reasoningEfforts 缺失 → 无档，来源记为 none（没有路由级默认值）", () => {
  const summary = summaryOf({ id: "m" }, routeDefaults);
  assert.match(summary.text, /无档$/);
  assert.equal(summary.sources.reasoningEfforts, "none");
  assert.match(summary.title, /推理档位：模型未声明（没有路由级默认值）/);
});

test("悬停 title 逐字段说明来源，格式为「字段：回落链」", () => {
  const summary = summaryOf({ id: "m" });
  assert.equal(
    summary.title,
    [
      "窗口：模型未声明 → 使用路由默认值 1M",
      "输出：模型未声明 → 使用路由默认值 128K",
      "模态：模型未声明 → 使用路由默认值 text",
      "推理档位：模型未声明（没有路由级默认值）",
    ].join("\n"),
  );
});

test("模型声明的字段，其 title 不出现「使用路由默认值」字样", () => {
  const summary = summaryOf(fullyDeclared);
  assert.equal(summary.title.includes("使用路由默认值"), false);
  assert.equal(summary.title, [
    "窗口：模型声明 131K",
    "输出：模型声明 33K",
    "模态：模型声明 text",
    "推理档位：模型声明 4 档",
  ].join("\n"));
});

test("route 缺失 → 按模型自己判定，不抛错、不显示 ↑", () => {
  const summary = describeModelRowSource({ id: "m", contextWindow: 8192 }, humanizeTokenCount);
  assert.match(summary.text, /^窗口 8K · 输出 未设置/);
  assert.equal(summary.text.includes(ROUTE_DEFAULT_MARK), false);
  assert.equal(summary.sources.maxTokens, "none");
});

test("route 是非对象（字符串 / 数组 / null）→ 不抛错、不显示 ↑", () => {
  for (const route of ["not-a-route", [], null, 42]) {
    const summary = summaryOf({ id: "m" }, route);
    assert.match(summary.text, /^窗口 未设置 · 输出 未设置 · 未设置 · 无档$/);
    assert.equal(summary.text.includes(ROUTE_DEFAULT_MARK), false);
  }
});

test("model 为 null / 非对象 → 返回一句「未设置」占位，不抛错", () => {
  for (const model of [null, undefined, "not-a-model", 42, []]) {
    const summary = summaryOf(model);
    assert.equal(summary.text, "未设置");
    assert.equal(summary.title, "未设置");
    assert.deepEqual(summary.sources, {});
  }
});

test("路由 defaultInput 是空数组 → 不构成有效默认值，不显示 ↑", () => {
  const summary = summaryOf({ id: "m" }, { defaultInput: [] });
  assert.match(summary.text, /· 未设置 · 无档$/);
  assert.equal(summary.text.includes(ROUTE_DEFAULT_MARK), false);
  assert.equal(summary.sources.input, "none");
});

test("token 值统一走 humanizeTokenCount，不自己写格式化", () => {
  const calls = [];
  const humanize = (value) => {
    calls.push(value);
    return "H";
  };
  const summary = describeModelRowSource({ id: "m", contextWindow: 4096 }, humanize, routeDefaults);
  assert.match(summary.text, /^窗口 H · 输出 H/);
  assert.deepEqual(calls, [4096, 128_000]);
});

test("describeModelRow 兼容旧的两参签名，输出与旧实现一致", () => {
  assert.equal(
    describeModelRow(fullyDeclared, humanizeTokenCount),
    "窗口 131K · 输出 33K · text · 4 档",
  );
  assert.equal(
    describeModelRow({ id: "m", input: ["text", "image"], reasoningEfforts: false }, humanizeTokenCount),
    "窗口 未设置 · 输出 未设置 · text / image · 非推理",
  );
});

test("多个字段来源混在一起时，每个字段各自标注", () => {
  const summary = summaryOf(
    { id: "m", contextWindow: 131_072, reasoningEfforts: false },
    routeDefaults,
  );
  assert.equal(summary.text, "窗口 131K · 输出 128K↑ · text↑ · 非推理");
  assert.deepEqual(summary.sources, {
    contextWindow: "model",
    maxTokens: "route",
    input: "route",
    reasoningEfforts: "model",
  });
});

test("目录扩展点：catalogValueOf 给值 → 标 ·目录，并优先于路由默认值", () => {
  const catalogValueOf = (model, field) => (field === "contextWindow" ? 262_144 : undefined);
  const summary = summaryOf({ id: "m" }, routeDefaults, catalogValueOf);
  assert.match(summary.text, /^窗口 262K·目录 · 输出 128K↑/);
  assert.equal(summary.sources.contextWindow, "catalog");
  assert.match(summary.title, /窗口：模型未声明 → 内置目录 262K/);
});

test("目录扩展点：catalogValueOf 没有值 → 回落到路由默认值，不出现「目录」", () => {
  const summary = summaryOf({ id: "m" }, routeDefaults, () => undefined);
  assert.equal(summary.text.includes(CATALOG_MARK), false);
  assert.match(summary.text, /^窗口 1M↑ · 输出 128K↑/);
});

test("不传 catalogValueOf → 绝不假装知道目录给了什么", () => {
  const summary = summaryOf({ id: "m" }, routeDefaults);
  assert.equal(summary.text.includes(CATALOG_MARK), false);
  assert.equal(summary.title.includes("内置目录"), false);
});

test("模型声明了 display 不了的 token（0）→ 仍算已声明，不回落路由默认值", () => {
  const summary = summaryOf({ id: "m", contextWindow: 0 }, routeDefaults);
  assert.match(summary.text, /^窗口 未设置 · 输出 128K↑/);
  assert.equal(summary.text.includes("窗口 1M↑"), false);
  assert.equal(summary.sources.contextWindow, "model");
});

test("sources 覆盖四个字段，且取值只在 model / catalog / route / none 之内", () => {
  const summary = summaryOf({ id: "m" }, routeDefaults);
  assert.deepEqual(Object.keys(summary.sources).sort(), ["contextWindow", "input", "maxTokens", "reasoningEfforts"]);
  for (const source of Object.values(summary.sources)) {
    assert.ok(["model", "catalog", "route", "none"].includes(source));
  }
});

test("title 恰好四行，每行都以「窗口 / 输出 / 模态 / 推理档位：」开头", () => {
  const lines = summaryOf({ id: "m" }).title.split("\n");
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((line) => line.split("：")[0]), ["窗口", "输出", "模态", "推理档位"]);
});
