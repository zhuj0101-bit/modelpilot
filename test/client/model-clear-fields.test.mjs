// 工单 #38：清空 token 字段 / 输入模态校验的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，做真实输入与
// 点击，读回提示文案、保存按钮状态、投影预览与 mutate 参数。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildModelClearHtml } from "./model-clear-fields-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildModelClearHtml(bundle, scheme)));
  return probes.get(scheme);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：打开编辑表单时 token 字段预填，未改动不可保存`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.initial, {
      contextWindow: "131072",
      maxTokens: "32768",
      saveDisabled: true,
      clearNotes: 0,
    });
  });

  test(`${scheme} 主题：清空 contextWindow → 保存可用，字段下方出现清空提示`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.clearContext.saveDisabled, false);
    assert.equal(result.clearContext.clearNotes, 1);
    assert.equal(result.clearContext.error, false);
    assert.match(result.clearContext.changedLine, /改动字段：上下文窗口/);
    assert.equal(result.clearContext.ops.length, 1);
    assert.equal(result.clearContext.ops[0].op, "set");
    assert.deepEqual(result.clearContext.ops[0].path, ["providers", "preview-clear", "models"]);
    assert.equal(Object.hasOwn(result.clearContext.ops[0].value[0], "contextWindow"), false);
    assert.equal(result.clearContext.ops[0].value[0].maxTokens, 32768);
    assert.deepEqual(result.clearContext.ops[0].value[0].compat, { supportsReasoningEffort: true });
  });

  test(`${scheme} 主题：两个 token 字段都清空 → 两处提示，保存仍可用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.clearBoth.saveDisabled, false);
    assert.equal(result.clearBoth.clearNotes, 2);
    assert.match(result.clearBoth.changedLine, /上下文窗口/);
    assert.match(result.clearBoth.changedLine, /输出上限/);
  });

  test(`${scheme} 主题：保存后两个键从模型对象里消失，其余字段原样保留`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.save.mutations, 1);
    assert.equal(result.save.lastOps.length, 1);
    assert.equal(result.save.lastOps[0].op, "set");
    assert.deepEqual(result.save.lastOps[0].path, ["providers", "preview-clear", "models"]);
    assert.equal(result.save.lastOps[0].value.length, 2);
    assert.equal(Object.hasOwn(result.save.lastOps[0].value[0], "contextWindow"), false);
    assert.equal(Object.hasOwn(result.save.lastOps[0].value[0], "maxTokens"), false);
    assert.deepEqual(result.save.lastOps[0].value[0].compat, { supportsReasoningEffort: true });
    assert.deepEqual(result.save.lastOps[0].value[1], {
      id: "tx/no-input",
      name: "tx/no-input",
      maxTokens: 8192,
      reasoningEfforts: false,
    });
    assert.equal(result.save.hasContextWindow, false);
    assert.equal(result.save.hasMaxTokens, false);
    assert.equal(result.save.contextWindow, undefined);
    assert.equal(result.save.maxTokens, undefined);
    assert.deepEqual(result.save.compat, { supportsReasoningEffort: true });
    assert.match(result.save.listText, /窗口 未设置 · 输出 未设置 · text · 非推理/);
    assert.equal(result.save.editorClosed, true);
  });

  test(`${scheme} 主题：重新打开已清空的模型 → 空值、保存禁用、没有多余的清空提示`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.reopen, {
      contextWindow: "",
      maxTokens: "",
      saveDisabled: true,
      clearNotes: 0,
    });
  });

  test(`${scheme} 主题：007 被输入层接受并归一到 7；超长数字被拒绝并回显`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.leadingZero.value, "007");
    assert.equal(result.leadingZero.saveDisabled, false);
    assert.equal(result.leadingZero.error, false);
    assert.deepEqual(result.leadingZero.ops[0].path, ["providers", "preview-clear", "models", "0"]);
    assert.equal(result.leadingZero.ops[0].value.contextWindow, 7);

    assert.equal(result.oversized.value, "");
    assert.equal(result.oversized.saveDisabled, true);
    assert.equal(result.oversized.error, true);
  });

  test(`${scheme} 主题：两个模态都不勾 → 保存禁用 + 字段下方说明；留一个即可保存`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.modalityNone.checkedText, false);
    assert.equal(result.modalityNone.checkedImage, false);
    assert.equal(result.modalityNone.saveDisabled, true);
    assert.equal(result.modalityNone.error, true);

    assert.equal(result.modalityImage.saveDisabled, false);
    assert.equal(result.modalityImage.error, false);
    assert.deepEqual(result.modalityImage.ops[0].path, ["providers", "preview-clear", "models", "0"]);
    assert.deepEqual(result.modalityImage.ops[0].value.input, ["image"]);

    assert.equal(result.modalityBackToNone.saveDisabled, true);
    assert.equal(result.modalityBackToNone.error, true);
  });

  test(`${scheme} 主题：模型本来没有 input 时两个框空着不算清空，改其他字段仍可保存`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.noExistingInput.checkedText, false);
    assert.equal(result.noExistingInput.checkedImage, false);
    assert.equal(result.noExistingInput.error, false);
    assert.equal(result.noExistingInput.saveDisabled, false);
  });
}
