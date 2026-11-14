// 工单 #19：模型拖动排序 / 键盘排序的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，派发真实
// DragEvent / KeyboardEvent，读回列表顺序、mutate 参数、插入线计算样式、
// 失败回滚与单模型禁用。Chrome 不可用时 skip（与既有浏览器测试一致）。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { BRAND_TOKENS, buildModelReorderHtml } from "./model-reorder-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildModelReorderHtml(bundle, scheme)));
  return probes.get(scheme);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

const INITIAL_ORDER = ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash", "qwen/complete"];
const AFTER_DRAG = ["jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash", "jxf/dsv4.1-flash", "qwen/complete"];

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：每条模型行左侧有拖动手柄与只读序号`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.initial.order, INITIAL_ORDER);
    assert.deepEqual(result.initial.handles, [
      "拖动排序 第 1 位",
      "拖动排序 第 2 位",
      "拖动排序 第 3 位",
      "拖动排序 第 4 位",
    ]);
    assert.deepEqual(result.initial.ordinals, ["1", "2", "3", "4"]);
    assert.deepEqual(
      result.initial.positions,
      INITIAL_ORDER.map((id, index) => ({ id, ordinal: String(index + 1) })),
    );
    assert.ok(result.initial.handleDraggable.every(Boolean), "每行手柄都可拖动");
    assert.equal(result.initial.handleText, "⠿", "手柄显示抓取图标");
    assert.equal(result.initial.mutations, 0, "渲染不写盘");
  });

  test(`${scheme} 主题：拖动中被拖行半透明，目标位置显示品牌色插入线`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.dragStart.opacity, "0.45", "被拖行半透明");
    assert.equal(result.dragStart.insertLine, false, "尚未经过目标行时不显示插入线");
    assert.equal(result.dragOver.insertLine, true, "经过目标行显示插入线");
    assert.equal(
      result.dragOver.background,
      rgbOf(BRAND_TOKENS[scheme]),
      "插入线使用 --dsw-alias-brand-primary",
    );
    assert.equal(result.dragOver.height, "2px");
    assert.equal(result.dragOver.position, "absolute", "插入线绝对定位，不改变行高");
    assert.equal(result.dragOver.mutations, 0, "拖动过程不写盘");
  });

  test(`${scheme} 主题：松手立即一次 mutate，一条 set 重写整个 models 数组`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.drop.mutations, 1, "一次拖动只调用一次 mutate");
    assert.equal(result.drop.lastOps.length, 1, "只产出一条 op");
    const [op] = result.drop.lastOps;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models"], "整数组路径，不是叶子");
    assert.equal(op.value.length, 4, "数组长度不变");
    assert.deepEqual(result.drop.order, AFTER_DRAG);
    assert.deepEqual(result.drop.snapshotOrder, AFTER_DRAG, "宿主快照同步成新顺序");
    assert.match(result.drop.panelText, /该路由的模型（4 条）/);
  });

  test(`${scheme} 主题：排序只换位置，compat 与宿主未来字段跟着模型走`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const moved = result.drop.lastOps[0].value.find((model) => model.id === "jxf/dsv4.1-flash");
    assert.deepEqual(moved.compat, { supportsReasoningEffort: true, nested: { keep: true } });
    assert.deepEqual(moved.futureHostField, { keep: ["exactly", "these"] });
    assert.deepEqual(result.drop.compat, moved.compat);
    assert.deepEqual(result.drop.futureHostField, moved.futureHostField);
    assert.equal(result.drop.lastOps[0].value.indexOf(moved), 2, "模型内容随模型搬到第 3 位");
  });

  test(`${scheme} 主题：序号随位置实时更新，拖动状态在松手后清空`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(
      result.drop.positions,
      AFTER_DRAG.map((id, index) => ({ id, ordinal: String(index + 1) })),
    );
    const flash = result.drop.positions.find((row) => row.id === "jxf/dsv4.1-flash");
    assert.deepEqual(flash, { id: "jxf/dsv4.1-flash", ordinal: "3" });
    assert.equal(result.drop.draggingOpacityGone, "1");
    assert.equal(result.drop.insertLineGone, true);
  });

  test(`${scheme} 主题：拖动中按 Esc 取消，不写盘、顺序不变`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.escape.mutations, 0, "Esc 后即使收到 drop 也不写盘");
    assert.deepEqual(result.escape.order, INITIAL_ORDER);
    assert.equal(result.escape.insertLine, false, "Esc 后插入线消失");
  });

  test(`${scheme} 主题：↑ / ↓ 每次移动一位并立即写盘`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.arrowDown.mutations, 2, "方向键又写了一次");
    assert.deepEqual(result.arrowDown.order, ["jxf/dsv4.1-pro", "jxf/dsv4.1-flash", "tx/deepseek-v4.1-flash", "qwen/complete"]);
    assert.equal(result.arrowDown.toast, true, "成功 toast");
    assert.equal(result.arrowUp.mutations, 3);
    assert.deepEqual(result.arrowUp.order, AFTER_DRAG);
  });

  test(`${scheme} 主题：Home / End 移到首位 / 末位并立即写盘`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.home.mutations, 4);
    assert.deepEqual(result.home.order, ["qwen/complete", "jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash", "jxf/dsv4.1-flash"]);
    assert.equal(result.end.mutations, 5);
    assert.deepEqual(result.end.order, AFTER_DRAG);
  });

  test(`${scheme} 主题：mutate 失败时保持移动前顺序并显示错误 toast`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.failure.attempted, 1, "失败前只尝试一次写入");
    assert.deepEqual(result.failure.before, AFTER_DRAG);
    assert.deepEqual(result.failure.after, AFTER_DRAG, "列表回到移动前顺序");
    assert.equal(result.failure.toast, true, "显示排序未保存 toast");
  });

  test(`${scheme} 主题：重排成功后收起打开中的行内编辑（下标已变）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.editorAfterMove.editorOpenBefore, true, "先打开第一行的编辑表单");
    assert.equal(result.editorAfterMove.editorOpenAfter, false, "重排后编辑表单收起，避免指向另一条模型");
    assert.equal(result.editorAfterMove.mutations, 7);
    assert.deepEqual(result.editorAfterMove.order, ["tx/deepseek-v4.1-flash", "jxf/dsv4.1-pro", "jxf/dsv4.1-flash", "qwen/complete"]);
  });

  test(`${scheme} 主题：只有一个模型时手柄禁用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.single.rows, 1);
    assert.deepEqual(result.single.order, ["only/one"]);
    assert.equal(result.single.label, "拖动排序 第 1 位");
    assert.equal(result.single.disabled, true, "单模型时手柄禁用");
    assert.equal(result.single.draggable, false, "单模型时不可拖动");
    assert.equal(result.single.mutating, 7, "切换路由 / 单模型不产生新写入");
  });
}
