// 工单 #25：主模型列表搜索、多选与批量操作的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，派发真实
// input / change / click 事件，读回行顺序、mutate 参数、按钮禁用状态与提示。
// Chrome 不可用时 skip（与既有浏览器测试一致）。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildModelListHtml } from "./model-list-search-bulk-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildModelListHtml(bundle, scheme)));
  return probes.get(scheme);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

/** "rgb(r, g, b)" → 相对亮度；用于确认搜索框文字在两种主题下都 ≥ 4.5。 */
function luminance(color) {
  const [r, g, b] = color.match(/\d+/g).slice(0, 3).map((part) => {
    const channel = Number(part) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const [bright, dark] = [luminance(fg), luminance(bg)].sort((left, right) => right - left);
  return (bright + 0.05) / (dark + 0.05);
}

// 工单 #31：列表按 id 第一段分组（组按字母序），组内保持 models 数组顺序。
const INITIAL_ORDER = [
  "jxf/dsv4.1-flash",
  "jxf/dsv4.1-pro",
  "openai/gpt-case",
  "qwen/complete",
  "tx/deepseek-v4.1-flash",
];

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：搜索框与行复选框跟随 token，行高与工单 #19 一致`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const tokens = THEME_TOKENS[scheme];

    assert.equal(result.scheme, scheme);
    // 工单 #31：每个分组的第一行去掉顶部分隔线（52px），组内后续行为 61px。
    assert.deepEqual(result.geometry.rowHeights, [52, 61, 52, 52, 52], "组头之外的模型行沿用既有 modelRow 行高");
    assert.equal(result.geometry.searchBackground, rgbOf(tokens["--dsw-alias-bg-layer-1"]), "搜索框底色使用宿主 layer token");
    assert.equal(result.geometry.searchColor, rgbOf(tokens["--dsw-alias-label-primary"]), "搜索框文字使用宿主主文字色");
    assert.ok(
      contrast(result.geometry.searchColor, result.geometry.searchBackground) >= 4.5,
      "搜索框文字对比度必须 ≥ 4.5",
    );
    assert.equal(result.geometry.searchColorScheme, scheme, "搜索框继承 color-scheme");
    assert.equal(result.geometry.checkboxColorScheme, scheme, "复选框继承 color-scheme");
    assert.equal(result.geometry.checkboxHeight, 13, "原生复选框尺寸没有撑高行");
  });

  test(`${scheme} 主题：模型卡片标题行有搜索框，每行左侧有复选框，渲染不写盘`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.initial.order, INITIAL_ORDER);
    assert.equal(result.initial.searchInPanel, true, "搜索框在「该路由的模型列表」卡片内");
    assert.equal(result.initial.searchPlaceholder, "搜索模型 ID…");
    assert.equal(result.initial.searchValue, "");
    assert.equal(result.initial.checkboxCount, 5, "每条模型行都有复选框");
    assert.deepEqual(result.initial.checkboxes, INITIAL_ORDER.map((id) => `选择模型 ${id}`));
    assert.ok(result.initial.bulkText.includes("已选 0 条"));
    assert.deepEqual(result.initial.handlesDraggable, [true, true, true, true, true], "无筛选时拖动手柄仍可用");
    assert.equal(result.initial.mutations, 0);
  });

  test(`${scheme} 主题：输入即筛、不区分大小写、顺序不变，并显示计数与清空搜索`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.filtered.order, ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro"], "大写 JXF 也能匹配");
    assert.equal(result.filtered.footer, "显示 2 / 5 条");
    assert.equal(result.filtered.clearButton, true);
    assert.equal(result.filtered.mutations, 0, "搜索只影响显示，不写配置");
    assert.equal(result.filtered.searchValue, "JXF");
  });

  test(`${scheme} 主题：筛选状态下拖动手柄禁用，清空搜索后恢复`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.filtered.handlesDisabled, [true, true]);
    assert.deepEqual(result.filtered.handlesDraggable, [false, false]);
    assert.match(result.filtered.handleTitle, /筛选状态下不可排序/);
    assert.equal(result.cleared.mutations, 0);
    assert.deepEqual(result.cleared.handlesDraggable, [true, true]);
    assert.equal(result.cleared.footer, "");
    assert.equal(result.cleared.clearButton, false);
  });

  test(`${scheme} 主题：没有匹配时提示，并可从空结果清空搜索`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.noMatch.rows, 0);
    assert.match(result.noMatch.text, /没有匹配的模型/);
    assert.equal(result.noMatch.clearButton, true);
    assert.equal(result.noMatch.mutations, 0);
    assert.deepEqual(result.cleared.order, INITIAL_ORDER, "清空搜索恢复完整列表与原顺序");
  });

  test(`${scheme} 主题：勾选显示已选计数，可取消选择`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.selection.selected, ["jxf/dsv4.1-flash", "tx/deepseek-v4.1-flash"]);
    assert.ok(result.selection.bulkText.includes("已选 2 条"));
    assert.equal(result.selection.cancelDisabled, false);
    assert.deepEqual(result.cancelled.selected, []);
    assert.ok(result.cancelled.bulkText.includes("已选 0 条"));
  });

  test(`${scheme} 主题：全选只作用于当前筛选结果，再点一次只取消这些行`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.selectAllFiltered.checked, true);
    assert.ok(result.selectAllFiltered.bulkText.includes("已选 3 条"), "2 条可见 + 1 条此前勾选的隐藏行");
    assert.equal(result.selectAllFilteredOff.checked, false);
    assert.ok(result.selectAllFilteredOff.bulkText.includes("已选 1 条"), "取消全选只移除筛选结果里的 2 条");
  });

  test(`${scheme} 主题：切换路由清空搜索词与选择`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.routeSwitch.order, ["only/one"]);
    assert.equal(result.routeSwitch.searchValue, "");
    assert.deepEqual(result.routeSwitch.selected, []);
    assert.ok(result.routeSwitch.bulkText.includes("已选 0 条"));
    assert.deepEqual(result.routeBack.order, INITIAL_ORDER, "切回来是完整列表，不残留搜索词");
    assert.equal(result.routeBack.searchValue, "");
  });

  test(`${scheme} 主题：批量删除恰好一次 mutate、一条 set 整数组`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.bulkDelete.mutations, 1, "删除两条也只调用一次 mutate");
    assert.equal(result.bulkDelete.lastOps.length, 1, "只产出一条 op");
    const [op] = result.bulkDelete.lastOps;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models"], "整数组路径，不是叶子");
    assert.deepEqual(op.value.map((model) => model.id), [
      "jxf/dsv4.1-flash",
      "tx/deepseek-v4.1-flash",
      "openai/gpt-case",
    ]);
    assert.deepEqual(result.bulkDelete.snapshotOrder, op.value.map((model) => model.id));
    assert.deepEqual(result.bulkDelete.selected, []);
    assert.ok(result.bulkDelete.bulkText.includes("已选 0 条"));
    assert.equal(result.bulkDelete.toast, true);
  });

  test(`${scheme} 主题：选中全部时批量删除禁用并说明至少保留一条`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.deleteAllBlocked.selected, 3);
    assert.equal(result.deleteAllBlocked.deleteDisabled, true);
    assert.equal(result.deleteAllBlocked.deleteTitle, "不能删除全部模型；至少保留一条模型");
    assert.match(result.deleteAllBlocked.bulkText, /至少保留一条模型/);
    assert.equal(result.deleteAllBlocked.mutations, 0, "禁用状态下不会写盘");
  });

  test(`${scheme} 主题：批量改字段一次 set，只改选中模型且保留其他字段`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.bulkFieldsOpen.panel, true);
    assert.equal(result.bulkFieldsOpen.applyDisabled, true, "一个字段都没勾时不能应用");
    assert.match(result.bulkFieldsOpen.hint, /没有要修改的字段/);
    assert.equal(result.bulkFieldsReady.applyDisabled, false);
    assert.equal(result.bulkFieldsReady.maxTokens, "4096");

    assert.equal(result.bulkFields.mutations, 2, "删除 1 次 + 批量改字段 1 次");
    assert.equal(result.bulkFields.lastOps.length, 1);
    const [op] = result.bulkFields.lastOps;
    assert.deepEqual(op.path, ["providers", "preview-chat", "models"]);
    const [flash, tx, gpt] = result.bulkFields.snapshot;
    assert.equal(flash.id, "jxf/dsv4.1-flash");
    assert.equal(flash.maxTokens, 4096, "选中的模型写入同一输出上限");
    assert.deepEqual(flash.reasoningEfforts, {
      off: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
    }, "选中的模型写入同一套推理档位");
    assert.deepEqual(flash.input, ["text"], "未勾选的输入模态字段保持不变");
    assert.deepEqual(flash.compat, { supportsReasoningEffort: true, nested: { keep: true } }, "compat 原样保留");
    assert.deepEqual(flash.futureHostField, { keep: ["exactly", "these"] }, "宿主未来字段原样保留");
    assert.equal(tx.maxTokens, 8192, "未选中的模型不动");
    assert.equal(tx.reasoningEfforts, undefined);
    assert.equal(gpt.maxTokens, 4096);
    assert.deepEqual(result.bulkFields.selected, []);
    assert.equal(result.bulkFields.panelGone, true);
    assert.equal(result.bulkFields.toast, true);
  });

  test(`${scheme} 主题：单条编辑成功后清空选择，仍只有一条 set`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.editClearsSelection.mutations, 1);
    assert.equal(result.editClearsSelection.lastOps.length, 1);
    assert.deepEqual(result.editClearsSelection.lastOps[0].path, ["providers", "preview-chat", "models", "1"]);
    assert.equal(result.editClearsSelection.lastOps[0].value.maxTokens, 5000);
    assert.deepEqual(result.editClearsSelection.selected, []);
    assert.ok(result.editClearsSelection.bulkText.includes("已选 0 条"));
  });

  test(`${scheme} 主题：批量写入进行中按钮与行复选框禁用，防重复提交`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.busy.deleteDisabled, true);
    assert.equal(result.busy.cancelDisabled, true);
    assert.equal(result.busy.rowCheckboxDisabled, true);
    assert.equal(result.busy.searchUsable, true, "写入中仍可继续查看/搜索，只是不能再次提交");
    assert.equal(result.busyAfter.mutations, 1, "只提交了一次");
    assert.deepEqual(result.busyAfter.order, ["openai/gpt-case", "tx/deepseek-v4.1-flash"]);
    assert.deepEqual(result.busyAfter.selected, []);
  });

  test(`${scheme} 主题：列表被别处改动时批量操作未执行，也不写入任何东西`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.staleGuard.mutations, 0, "下标失效时不写盘");
    assert.deepEqual(result.staleGuard.snapshotOrder, ["openai/gpt-case", "tx/deepseek-v4.1-flash"], "快照保持外部改动的顺序");
    assert.equal(result.staleGuard.toast, true, "提示批量操作未执行");
    assert.deepEqual(result.staleGuard.selected, [], "失效后清空选择，要求重新核对");
  });
}
