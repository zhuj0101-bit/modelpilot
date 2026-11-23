// 工单 #29：编辑 / 新增表单的模板条（工单 #42 起是选择器 +「填入」）。
//
// 与 model-edit.test.mjs 相同：headless Chrome 渲染打包后的 lib/client.js，
// 做真实点击并读回表单值、改动字段、settingsOps 与计算样式；Chrome 不可用时 skip。
// 默认模板在首次渲染前通过注入的 localStorage 桩就位。
//
// 边界说明（见第 8 项）：diffRow 只产出正整数的 token 变化，「一期只支持修改，
// 不清空字段」；因此模板里的空 token 会把表单值清空，但不会出现在「改动字段」
// 里，也不会产生写入 —— 工单 #29 明确要求不改 diffRow / projectPiAi。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import {
  EMPTY_TOKEN_TEMPLATE_SEED,
  TEMPLATE_SEED,
  buildTemplateFillHtml,
} from "./template-fill-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme, scenario, seed) {
  const key = `${scheme}:${scenario}`;
  if (!probes.has(key)) probes.set(key, runPageProbe(chrome, buildTemplateFillHtml(bundle, scheme, seed)));
  return probes.get(key);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

function token(scheme, name) {
  return rgbOf(THEME_TOKENS[scheme][name]);
}

const TEMPLATE_FORM = {
  contextWindow: "131072",
  maxTokens: "8192",
  text: true,
  image: true,
  levels: ["off", "low"],
};

const BUILTIN_FORM = {
  contextWindow: "128000",
  maxTokens: "8192",
  text: true,
  image: false,
  levels: ["off", "low", "medium", "high"],
};

const BUILTIN_HINT =
  "内置模板：基础对话 · 上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high";

const EMPTY_FORM = {
  contextWindow: "",
  maxTokens: "",
  text: true,
  image: false,
  levels: [],
};

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：编辑表单有模板时显示按钮与模板摘要`, async (t) => {
    if (chrome === null) return skip(t);
    const { edit } = await probe(scheme, "with", TEMPLATE_SEED);
    assert.equal(edit.initial.fill.disabled, false);
    assert.equal(edit.initial.fill.text, "填入");
    // 编辑表单的初始值是模型的现有值（1000000 / 32768），与模板不同，
    // 工单 #43 缺陷 5 要求摘要如实说明；点「填入」后两者一致，这句就消失。
    assert.equal(
      edit.initial.hint,
      "模板：我的模板 · 上下文 131072（131K） · 输出 8192（8K） · text + image · off,low（表单已改动，与模板不同）",
    );
    assert.deepEqual(edit.initial.state, {
      name: "jxf/dsv4.1-flash",
      contextWindow: "1000000",
      maxTokens: "32768",
      text: true,
      image: false,
      levels: ["off", "low", "medium", "high"],
    });
    assert.equal(edit.initial.changedLine, "改动字段：无（保存已禁用）");
    assert.equal(edit.initial.saveDisabled, true);
  });

  test(`${scheme} 主题：填入后五个字段全变、显示名不动、改动字段与完整行 ops`, async (t) => {
    if (chrome === null) return skip(t);
    const { edit } = await probe(scheme, "with", TEMPLATE_SEED);
    assert.deepEqual(edit.filled.state, {
      name: "jxf/dsv4.1-flash",
      ...TEMPLATE_FORM,
    });
    assert.equal(
      edit.filled.hint,
      "模板：我的模板 · 上下文 131072（131K） · 输出 8192（8K） · text + image · off,low",
    );
    assert.equal(edit.filled.changedLine, "改动字段：上下文窗口 / 输出上限 / 输入模态 / 推理档位");
    assert.equal(edit.filled.saveDisabled, false);

    assert.equal(edit.filled.ops.length, 1);
    const [op] = edit.filled.ops;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models", "0"]);
    assert.equal(op.value.name, "jxf/dsv4.1-flash");
    assert.equal(op.value.contextWindow, 131072);
    assert.equal(op.value.maxTokens, 8192);
    assert.deepEqual(op.value.input, ["text", "image"]);
    assert.deepEqual(op.value.reasoningEfforts, { off: null, low: "low" });
    // 工单 #26 的合并式写入：compat 原样保留在完整行里。
    assert.deepEqual(op.value.compat, { chatTemplateKwargs: {}, chatTemplateArgs: {} });
  });

  test(`${scheme} 主题：反复点填入结果相同，取消不产生写入`, async (t) => {
    if (chrome === null) return skip(t);
    const { edit } = await probe(scheme, "with", TEMPLATE_SEED);
    assert.equal(edit.secondFill.identical, true);
    assert.deepEqual(edit.secondFill.state, edit.filled.state);
    assert.deepEqual(edit.secondFill.ops, edit.filled.ops);
    assert.deepEqual(edit.cancelled, { editorOpen: false, mutations: 0 });
  });

  test(`${scheme} 主题：填入后保存一条 set，保持完整行与 compat`, async (t) => {
    if (chrome === null) return skip(t);
    const { save } = await probe(scheme, "with", TEMPLATE_SEED);
    assert.equal(save.mutations, 1);
    assert.equal(save.lastOps.length, 1);
    const [op] = save.lastOps;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models", "0"]);
    assert.equal(op.value.name, "jxf/dsv4.1-flash");
    assert.equal(op.value.contextWindow, 131072);
    assert.equal(op.value.maxTokens, 8192);
    assert.deepEqual(op.value.input, ["text", "image"]);
    assert.deepEqual(op.value.reasoningEfforts, { off: null, low: "low" });
    assert.deepEqual(op.value.compat, { chatTemplateKwargs: {}, chatTemplateArgs: {} });

    assert.equal(save.savedRow.contextWindow, 131072);
    assert.equal(save.savedRow.maxTokens, 8192);
    assert.deepEqual(save.savedRow.compat, { chatTemplateKwargs: {}, chatTemplateArgs: {} });
    assert.match(save.listText, /窗口 131K · 输出 8K · text \/ image · 2 档/);
  });

  test(`${scheme} 主题：首次打开（无存储）就用内置「基础对话」模板`, async (t) => {
    if (chrome === null) return skip(t);
    const { edit, create } = await probe(scheme, "none", null);
    assert.equal(edit.initial.fill.disabled, false);
    assert.equal(edit.initial.fill.text, "填入");
    // 编辑表单先显示模型自己的值（1000000 / 32768），与内置预设不同。
    assert.equal(edit.initial.hint, `${BUILTIN_HINT}（表单已改动，与模板不同）`);
    assert.equal(edit.initial.state.contextWindow, "1000000");
    assert.equal(edit.initial.state.maxTokens, "32768");
    // 点「填入」把编辑表单从模型现有值换成内置预设值。
    assert.equal(edit.initial.clickNoop, false);
    assert.deepEqual(edit.filled.state, {
      name: "jxf/dsv4.1-flash",
      ...BUILTIN_FORM,
    });
    assert.equal(edit.cancelled.mutations, 0);

    assert.deepEqual(create.initial, BUILTIN_FORM);
    assert.equal(create.fill.disabled, false);
    assert.equal(create.fill.text, "填入");
    assert.equal(create.hintLine, BUILTIN_HINT);
    assert.equal(create.clickNoop, true);
  });

  test(`${scheme} 主题：存过自己的模板后摘要显示用户模板，不显示内置预设`, async (t) => {
    if (chrome === null) return skip(t);
    const { edit, create } = await probe(scheme, "with", TEMPLATE_SEED);
    const expectedHint =
      "模板：我的模板 · 上下文 131072（131K） · 输出 8192（8K） · text + image · off,low";
    assert.equal(edit.initial.hint, `${expectedHint}（表单已改动，与模板不同）`);
    assert.equal(create.hintLine, expectedHint);
    assert.ok(!edit.initial.hint.includes("内置模板"));
    assert.ok(!create.hintLine.includes("内置模板"));
  });

  test(`${scheme} 主题：新增表单点清空后再填入，五个字段恢复模板值`, async (t) => {
    if (chrome === null) return skip(t);
    const { create } = await probe(scheme, "with", TEMPLATE_SEED);
    const expected = { ...TEMPLATE_FORM };
    assert.deepEqual(create.initial, expected);
    assert.equal(create.fill.disabled, false);
    assert.equal(create.fill.text, "填入");
    assert.equal(create.pickerLabel, "新增模型模板");

    assert.deepEqual(create.afterClear, expected);
    assert.deepEqual(create.mutated, {
      contextWindow: "55555",
      maxTokens: "4444",
      text: true,
      image: false,
      levels: ["off", "low", "medium"],
    });
    assert.deepEqual(create.afterFill, expected);
  });

  test(`${scheme} 主题：模板空 token / 空档位如实清空表单（清空 token 现在可保存）`, async (t) => {
    if (chrome === null) return skip(t);
    const { create, edit } = await probe(scheme, "empty", EMPTY_TOKEN_TEMPLATE_SEED);
    assert.deepEqual(create.initial, EMPTY_FORM);
    assert.deepEqual(edit.filled.state, {
      name: "jxf/dsv4.1-flash",
      ...EMPTY_FORM,
    });
    assert.equal(edit.filled.zeroHint, true);
    // 工单 #38：清空 token 是合法写入 —— 一条整数组 set，两个键从行里消失。
    assert.equal(edit.filled.saveDisabled, false);
    assert.equal(edit.filled.changedLine, "改动字段：上下文窗口 / 输出上限");
    assert.equal(edit.filled.ops.length, 1);
    const [op] = edit.filled.ops;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models"]);
    assert.equal(Object.hasOwn(op.value[0], "contextWindow"), false);
    assert.equal(Object.hasOwn(op.value[0], "maxTokens"), false);
    assert.deepEqual(op.value[0].input, ["text"]);
    assert.deepEqual(op.value[0].reasoningEfforts, { off: null, low: "low", medium: "medium", high: "high_reasoning" });
  });

  test(`${scheme} 主题：按钮与提示行跟随 token，内置模板摘要可辨识`, async (t) => {
    if (chrome === null) return skip(t);
    const withResult = await probe(scheme, "with", TEMPLATE_SEED);
    const noneResult = await probe(scheme, "none", null);

    const fillTheme = withResult.edit.theme.fill;
    assert.match(fillTheme.inlineStyle, /--dsw-alias-interactive-bg-hover/);
    assert.match(fillTheme.inlineStyle, /--dsw-alias-border-l2/);
    assert.equal(fillTheme.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(fillTheme.ratio >= 4.5, `编辑填入按钮对比度 ${fillTheme.ratio}`);
    assert.equal(withResult.edit.theme.hint.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(withResult.edit.theme.hint.ratio >= 4.5, `模板摘要对比度 ${withResult.edit.theme.hint.ratio}`);

    assert.match(withResult.create.fill.inlineStyle, /--dsw-alias-interactive-bg-hover/);
    assert.ok(withResult.create.fill.ratio >= 4.5, `新增填入按钮对比度 ${withResult.create.fill.ratio}`);

    const builtin = noneResult.builtinTheme;
    assert.equal(builtin.editorFill.disabled, false);
    assert.equal(builtin.editorFill.opacity, "1");
    assert.doesNotMatch(builtin.editorFill.inlineStyle, /not-allowed/);
    assert.ok(builtin.editorFill.ratio >= 4.5, `内置模板填入按钮对比度 ${builtin.editorFill.ratio}`);
    assert.equal(builtin.hint.text, BUILTIN_HINT);
    assert.equal(builtin.hint.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(builtin.hint.ratio >= 4.5, `内置模板摘要对比度 ${builtin.hint.ratio}`);
  });
}
