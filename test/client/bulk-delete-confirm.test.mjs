// 工单 #33：批量删除二次确认的真实 DOM 测试。
//
// 覆盖问题二（批量删除必须先确认、正文点名 id 与隐藏条目、取消 / Esc / Tab
// 复用 ConfirmDialog）。在 light / dark 两套宿主 token 下渲染打包后的
// lib/client.js，派发真实 click / change / keydown，读回弹窗正文、mutate 参数
// 与选择集合。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildBulkDeleteConfirmHtml } from "./bulk-visibility-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildBulkDeleteConfirmHtml(bundle, scheme)));
  return probes.get(scheme);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：点批量删除先弹确认框，取消不写盘、选择不变`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.scheme, scheme);
    assert.deepEqual(result.beforeOpen.selected, ["jxf/one", "tx/one"]);
    assert.match(result.beforeOpen.bulkText, /已选 2 条/);
    assert.equal(result.beforeOpen.mutations, 0);

    assert.equal(result.opened.open, true, "点批量删除先显示确认框");
    assert.equal(result.opened.mutations, 0, "打开确认框不写盘");
    assert.match(result.opened.text, /删除 2 条模型/);
    assert.match(result.opened.text, /jxf\/one/);
    assert.match(result.opened.text, /tx\/one/);
    assert.match(result.opened.text, /此操作无法撤销/);
    assert.equal(result.opened.text.includes("不可见"), false, "全部可见时不写隐藏提示");
    assert.equal(result.opened.countText, "2", "弹窗里的 N 与批量栏一致");
    assert.match(result.opened.bulkText, /已选 2 条/);

    assert.equal(result.cancelled.dialogOpen, false, "取消后关闭");
    assert.deepEqual(result.cancelled.selected, ["jxf/one", "tx/one"], "取消不改变选择");
    assert.equal(result.cancelled.mutations, 0, "取消不写盘");
  });

  test(`${scheme} 主题：被删条目超过 5 条时正文只列前 5 条并说明另有几条`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.overflow.open, true);
    assert.equal(result.overflow.mutations, 0, "打开确认框不写盘");
    assert.equal(result.overflow.countText, "6", "标题写被删总数");
    assert.match(result.overflow.text, /acme\/one/);
    assert.match(result.overflow.text, /jxf\/two/);
    assert.match(result.overflow.text, /……另有 1 条/);
    assert.equal(result.overflow.text.includes("tx/one"), false, "第 6 条只计数，不列出");
    assert.equal(result.overflow.closed, true, "取消后关闭");
  });

  test(`${scheme} 主题：确认后一次 mutate、一条 set 整数组，成功后关闭并清空选择`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.confirmed.mutations, 1, "确认删除两条也只写一次");
    assert.equal(result.confirmed.lastOps.length, 1, "只产出一条 op");
    const [op] = result.confirmed.lastOps;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models"]);
    assert.deepEqual(op.value.map((model) => model.id), [
      "acme/one",
      "acme/two",
      "acme/three",
      "jxf/two",
      "jxf/three",
      "tx/two",
    ]);
    assert.deepEqual(result.confirmed.snapshotOrder, op.value.map((model) => model.id));
    assert.equal(result.confirmed.dialogOpen, false, "写盘成功后关闭确认框");
    assert.deepEqual(result.confirmed.selected, []);
    assert.equal(result.confirmed.toast, true);
  });

  test(`${scheme} 主题：折叠组里的已选条目在确认框点名「不可见」`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.hidden.open, true);
    assert.match(result.hidden.text, /删除 3 条模型/);
    assert.match(result.hidden.text, /3 条位于折叠或未显示的行，当前不可见/);
    assert.match(result.hidden.text, /acme\/one/);
    assert.match(result.hidden.bulkText, /已选 3 条/);
    assert.equal(result.hidden.countText, "3", "弹窗里的 N 与批量栏一致");
    assert.equal(result.hidden.mutationsAfterCancel, 0, "取消隐藏条目的删除不写盘");
  });

  test(`${scheme} 主题：Esc 关闭、Tab / Shift+Tab 焦点循环复用 ConfirmDialog`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.escape.dialogOpen, false, "Esc 关闭确认框");
    assert.deepEqual(result.escape.selected, [], "折叠组里的已选行在界面上仍不可见");
    assert.match(result.escape.bulkText, /已选 3 条/, "Esc 不改选择集合");
    assert.match(result.escape.hiddenText, /3 条未显示/);
    assert.equal(result.escape.mutations, 1, "Esc 不写盘（此前只有确认删除那一次）");

    assert.equal(result.tabTrap.forward, true, "最后一个按钮按 Tab 回到第一个");
    assert.equal(result.tabTrap.backward, true, "第一个按钮按 Shift+Tab 回到最后一个");
    assert.equal(result.tabTrap.focusables, 2, "确认框里只有取消 / 确认两个可聚焦按钮");
  });

  test(`${scheme} 主题：选中全部时批量删除禁用，弹窗不出现；取消选择 / 切路由关闭弹窗`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.deleteAllBlocked.selected, 6, "删除 2 条后剩余 6 条全部选中");
    assert.equal(result.deleteAllBlocked.deleteDisabled, true);
    assert.equal(result.deleteAllBlocked.dialogOpen, false, "禁用按钮点不开确认框");
    assert.equal(result.deleteAllBlocked.mutations, 0);

    assert.equal(result.closedByClear.dialogOpen, false, "取消选择关闭确认框");
    assert.deepEqual(result.closedByClear.selected, []);

    assert.equal(result.closedByRouteSwitch.dialogOpen, false, "切换路由关闭确认框");
    assert.deepEqual(result.closedByRouteSwitch.selected, []);
    assert.match(result.closedByRouteSwitch.bulkText, /已选 0 条/);
    assert.equal(result.closedByRouteSwitch.mutations, 1, "关闭弹窗的视图操作都不写盘");
  });
}
