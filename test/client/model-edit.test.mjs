// 工单 #26 一期：模型列表 / 行内编辑 / 删除确认 / 预算提示的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下用 headless Chrome 渲染打包后的 lib/client.js，
// 做真实点击并读回表单值、mutate 参数与计算样式。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildModelEditHtml } from "./model-edit-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildModelEditHtml(bundle, scheme)));
  return probes.get(scheme);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

function token(scheme, name) {
  return rgbOf(THEME_TOKENS[scheme][name]);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：模型列表显示 id / 窗口 / 输出 / 模态 / 档位数`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.initial.countText, /该路由的模型（3 条）/);
    assert.equal(result.initial.editButtons.length, 3);
    assert.match(result.initial.summaries[0], /窗口 1M · 输出 33K · text · 4 档/);
    assert.match(result.initial.summaries[1], /窗口 1M · 输出 33K · text · 4 档/);
    assert.match(result.initial.summaries[2], /窗口 128K · 输出 8K · text · 无档/);
  });

  test(`${scheme} 主题：编辑表单预填现有值，未改动时保存禁用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.edit, {
      contextWindow: "1000000",
      maxTokens: "32768",
      name: "jxf/dsv4.1-flash",
      saveDisabled: true,
      compatNotice: false,
      editorOpen: true,
      zeroHint: true,
      slightHint: true,
      strongHint: true,
      canSaveAfterChange: true,
    });
  });

  test(`${scheme} 主题：同时只展开一条，compat 提示只在有 compat 时出现`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.switch.firstEditorGone, true);
    assert.equal(result.switch.secondEditorOpen, true);
    assert.equal(result.switch.compatNotice, true);
    assert.equal(result.switch.saveDisabled, true);
    assert.equal(result.switch.name, "jxf/dsv4.1-pro");
  });

  test(`${scheme} 主题：保存 compat 模型产出 1 条 set，compat 原样保留`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.save.mutations, 1);
    assert.equal(result.save.lastOps.length, 1);
    assert.equal(result.save.lastOps[0].op, "set");
    assert.deepEqual(result.save.lastOps[0].path, ["providers", "preview-chat", "models", "1"]);
    assert.equal(result.save.lastOps[0].value.maxTokens, 48000);
    assert.deepEqual(result.save.lastOps[0].value.compat, {
      supportsReasoningEffort: true,
      nested: { keep: true },
    });
    assert.match(result.save.listAfter, /输出 48K/);
    assert.deepEqual(result.save.compatAfter, { supportsReasoningEffort: true, nested: { keep: true } });
  });

  test(`${scheme} 主题：自绘删除确认，确认后一条 set 重写 models 数组`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.deleteDialog.open, true);
    assert.match(result.deleteDialog.text, /jxf\/dsv4\.1-pro/);
    assert.match(result.deleteDialog.text, /无法撤销/);
    assert.ok(result.deleteDialog.danger.ratio >= 4.5, `删除按钮对比度 ${result.deleteDialog.danger.ratio}`);
    assert.equal(result.deleteDialog.cancelled, true);
    assert.equal(result.remove.mutations, 2);
    assert.equal(result.remove.lastOps.length, 1);
    assert.equal(result.remove.lastOps[0].op, "set");
    assert.deepEqual(result.remove.lastOps[0].path, ["providers", "preview-chat", "models"]);
    assert.equal(result.remove.lastOps[0].value.length, 2);
    assert.ok(!result.remove.lastOps.some((op) => op.op === "unset"));
    assert.equal(result.remove.modelsLength, 2);
    assert.match(result.remove.listAfter, /该路由的模型（2 条）/);
  });

  test(`${scheme} 主题：stale-index 拒绝写入并提示重试`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.stale.message, true);
    assert.equal(result.stale.saveDisabled, true);
    assert.match(result.stale.opCount, /保存将写入的 settingsOps（0 条）/);
  });

  test(`${scheme} 主题：删到 0 条显示空态且不崩`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.empty.countText, /该路由的模型（0 条）/);
    assert.equal(result.empty.message, true);
    assert.equal(result.empty.modelsLength, 0);
  });

  test(`${scheme} 主题：列表 / 编辑表单 / compat / 预算提示跟随 token`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.theme.panel.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.theme.editor.background, token(scheme, "--dsw-alias-bg-base"));
    assert.equal(result.theme.compatibility.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.ok(result.theme.compatibility.ratio >= 4.5, `compat 提示对比度 ${result.theme.compatibility.ratio}`);
    assert.ok(result.theme.budget.ratio >= 4.5, `预算提示对比度 ${result.theme.budget.ratio}`);
    assert.match(result.theme.budget.text, /可用上下文 800,000（零损失 ✓）/);
    assert.match(result.theme.budget.text, /按默认压缩策略估算/);
    assert.equal(result.deleteDialog.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.deleteDialog.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(result.deleteDialog.danger.ratio >= 4.5);
  });
}
