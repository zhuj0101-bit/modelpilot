// 工单 #28：模型行直接删除与编辑表单顶部「收起」的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，做真实点击并
// 读回 mutate 参数、按钮禁用状态与 title。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildInlineModelDeleteHtml } from "./inline-model-delete-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme, writable = true) {
  const key = `${scheme}:${writable ? "rw" : "ro"}`;
  if (!probes.has(key)) {
    probes.set(key, runPageProbe(chrome, buildInlineModelDeleteHtml(bundle, scheme, writable)));
  }
  return probes.get(key);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：每行「编辑」「删除」并列，删除按钮可用且不展开编辑`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.initial.countText, /该路由的模型（3 条）/);
    assert.equal(result.initial.editorOpen, false);
    assert.deepEqual(result.initial.editLabels, [
      "编辑模型 jxf/dsv4.1-flash",
      "编辑模型 jxf/dsv4.1-pro",
      "编辑模型 tx/deepseek-v4.1-flash",
    ]);
    assert.deepEqual(result.initial.deleteLabels, [
      "删除模型 jxf/dsv4.1-flash",
      "删除模型 jxf/dsv4.1-pro",
      "删除模型 tx/deepseek-v4.1-flash",
    ]);
    for (const row of result.initial.rows) {
      assert.equal(row.hasEdit, true);
      assert.equal(row.hasDelete, true);
      assert.equal(row.sameActions, true);
      assert.equal(row.editBeforeDelete, true);
      assert.equal(row.deleteText, "删除");
      assert.equal(row.deleteDisabled, false);
    }
  });

  test(`${scheme} 主题：行内删除打开同一个确认弹窗并带模型 id，取消不发请求`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.dialog.open, true);
    assert.match(result.dialog.title, /^删除模型 jxf\/dsv4\.1-pro$/);
    assert.match(result.dialog.text, /jxf\/dsv4\.1-pro/);
    assert.match(result.dialog.text, /无法撤销/);
    assert.equal(result.dialog.editorOpened, false);
    assert.equal(result.dialog.mutations, 0);
    assert.equal(result.dialog.cancelled, true);
    assert.equal(result.dialog.mutationsAfterCancel, 0);
  });

  test(`${scheme} 主题：行内确认删除复用一条 set 整数组写入`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.remove.mutations, 1);
    assert.equal(result.remove.lastOps.length, 1);
    assert.equal(result.remove.lastOps[0].op, "set");
    assert.deepEqual(result.remove.lastOps[0].path, ["providers", "preview-chat", "models"]);
    assert.equal(result.remove.lastOps[0].value.length, 2);
    assert.ok(!result.remove.lastOps.some((op) => op.op === "unset"));
    assert.equal(result.remove.modelsLength, 2);
    assert.match(result.remove.listText, /该路由的模型（2 条）/);
  });

  test(`${scheme} 主题：收起按钮在无改动时立即收起，有改动时禁用并提示`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.collapse.present, true);
    assert.equal(result.collapse.headerFirstRow, true);
    assert.equal(result.collapse.cancelPresent, true);
    assert.equal(result.collapse.cleanDisabled, false);
    assert.equal(result.collapse.cleanTitle, "收起编辑表单");
    assert.equal(result.collapse.cleanClosedEditor, true);
    assert.equal(result.collapse.cleanMutations, 0);

    assert.equal(result.collapse.dirtyDisabled, true);
    assert.equal(result.collapse.dirtyTitle, "有未保存的改动，请先保存或点取消");
    assert.equal(result.collapse.bottomCancelEnabled, true);
    assert.equal(result.collapse.dirtyStillOpen, true);
    assert.equal(result.collapse.bottomCancelClosed, true);
    assert.equal(result.collapse.dirtyMutations, 0);

    assert.equal(result.collapse.reenabledAfterRevert, true);
    assert.equal(result.collapse.revertClosedEditor, true);
  });

  test(`${scheme} 主题：编辑中的行仍可直接删除，确认后收起编辑并少一条`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.editRowDelete.dialogOpen, true);
    assert.match(result.editRowDelete.title, /^删除模型 jxf\/dsv4\.1-flash$/);
    assert.equal(result.editRowDelete.editorStillOpen, true);
    assert.equal(result.editRowDelete.mutations, 1);
    assert.equal(result.editRowDelete.lastOps.length, 1);
    assert.equal(result.editRowDelete.lastOps[0].op, "set");
    assert.deepEqual(result.editRowDelete.lastOps[0].path, ["providers", "preview-chat", "models"]);
    assert.equal(result.editRowDelete.lastOps[0].value.length, 1);
    assert.equal(result.editRowDelete.editorClosed, true);
    assert.equal(result.editRowDelete.modelsLength, 1);
  });

  test(`${scheme} 主题：只剩 1 条时删除仍允许调用，产物是空数组 set`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.lastModel.dialogOpen, true);
    assert.match(result.lastModel.title, /^删除模型 tx\/deepseek-v4\.1-flash$/);
    assert.equal(result.lastModel.mutations, 1);
    assert.equal(result.lastModel.lastOps.length, 1);
    assert.equal(result.lastModel.lastOps[0].op, "set");
    assert.deepEqual(result.lastModel.lastOps[0].path, ["providers", "preview-chat", "models"]);
    assert.deepEqual(result.lastModel.lastOps[0].value, []);
    assert.equal(result.lastModel.modelsLength, 0);
    assert.equal(result.lastModel.emptyState, true);
  });

  test(`${scheme} 主题：只读模式下每行删除按钮禁用且不弹窗`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, false);
    assert.equal(result.readOnly.deleteDisabled, true);
    assert.equal(result.readOnly.dialogOpen, false);
    assert.equal(result.readOnly.mutations, 0);
    assert.equal(result.initial.rows.length, 3);
    for (const row of result.initial.rows) assert.equal(row.deleteDisabled, true);
  });
}
