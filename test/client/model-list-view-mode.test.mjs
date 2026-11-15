// 工单 #39：平铺 / 分组视图开关与平铺下的全局排序 —— 真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，派发真实
// click / DragEvent / KeyboardEvent，读回组头、行顺序、序号、写入的整数组、
// toast 与 localStorage。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import {
  VIEW_MODE_KEY,
  buildModelListViewModeHtml,
  buildModelListViewModeStoredHtml,
} from "./model-list-view-mode-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) {
    probes.set(scheme, runPageProbe(chrome, buildModelListViewModeHtml(bundle, scheme)));
  }
  return probes.get(scheme);
}

function storedProbe(scheme, presets) {
  const key = `${scheme}:${JSON.stringify(presets)}`;
  if (!probes.has(key)) {
    probes.set(key, runPageProbe(chrome, buildModelListViewModeStoredHtml(bundle, scheme, presets)));
  }
  return probes.get(key);
}

// 数组顺序（也是平铺视图的顺序）。
const ARRAY_ORDER = [
  "jxf/alpha",
  "tx/beta",
  "jxf/gamma",
  "standalone",
  "tx/delta",
];
// 分组视图的阅读顺序：组按字母序、「其他」最后，组内保持数组顺序。
const GROUPED_ORDER = [
  "jxf/alpha",
  "jxf/gamma",
  "tx/beta",
  "tx/delta",
  "standalone",
];
const GROUPED_NAMES = ["alpha", "gamma", "beta", "delta", "standalone"];
const CROSS_TOAST = "只能在同一分组内调整顺序；跨分组无法排序";
const FLAT_HANDLE_TITLE = "拖动排序；聚焦后可用 ↑ / ↓ / Home / End 移动";
const GROUPED_HANDLE_TITLE = "拖动排序；聚焦后可用 ↑ / ↓ / Home / End 在本组内移动";

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：默认分组视图，跨组拖动仍被拒绝且不写配置`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const initial = result.initial;

    assert.equal(result.scheme, scheme);
    assert.deepEqual(initial.groups, ["jxf", "tx", "其他"], "默认分组：有组头且按字母序");
    assert.equal(initial.groupNodes, 3);
    assert.deepEqual(initial.expanded, ["true", "true", "true"]);
    assert.deepEqual(initial.order, GROUPED_ORDER, "分组视图按组字母序渲染");
    assert.deepEqual(initial.ordinals, [1, 2, 3, 4, 5], "分组阅读顺序连续编号");
    assert.deepEqual(initial.names, GROUPED_NAMES, "分组视图显示去掉前缀的短 id");
    assert.deepEqual(initial.handleTitles, new Array(ARRAY_ORDER.length).fill(GROUPED_HANDLE_TITLE));
    assert.equal(initial.view.grouped, "true", "默认选中分组");
    assert.equal(initial.view.flat, "false");
    assert.equal(initial.view.groupedText, "分组");
    assert.equal(initial.view.flatText, "平铺");
    assert.equal(initial.view.groupedTitle, "分组：按 id 前缀折叠，组内排序");
    assert.equal(initial.view.flatTitle, "平铺：可自由拖动排序");
    assert.equal(initial.view.stored, null, "默认分组不写 storage");
    assert.equal(initial.density.compact, "true", "默认密度仍是紧凑");
    assert.equal(initial.mutations, 0, "渲染视图开关不写配置");

    assert.equal(result.groupedCrossOver.insertLine, false, "跨组经过不画插入线");
    assert.equal(result.groupedCrossOver.mutations, 0);
    assert.equal(result.groupedCrossDrop.mutations, 0, "分组视图跨组松手不写盘");
    assert.equal(result.groupedCrossDrop.lastOps, null);
    assert.deepEqual(result.groupedCrossDrop.order, GROUPED_ORDER, "组顺序仍由 id 前缀决定");
    assert.deepEqual(result.groupedCrossDrop.snapshotOrder, ARRAY_ORDER, "数组顺序不变");
    assert.equal(result.groupedCrossDrop.toast, CROSS_TOAST);
    assert.equal(result.groupedCrossDrop.insertLine, false);
  });

  test(`${scheme} 主题：切到平铺 → 无组头、行按 models 数组顺序、序号连续 1..N`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const flat = result.switchToFlat;

    assert.deepEqual(result.groupedCollapsed.order, ["jxf/alpha", "jxf/gamma", "standalone"]);
    assert.deepEqual(result.groupedCollapsed.expanded, ["true", "false", "true"]);

    assert.deepEqual(flat.groups, [], "平铺视图没有组头");
    assert.equal(flat.groupNodes, 0, "平铺视图没有分组容器");
    assert.deepEqual(flat.expanded, [], "没有可折叠的组");
    assert.deepEqual(flat.order, ARRAY_ORDER, "平铺视图按 models 数组顺序渲染");
    assert.deepEqual(flat.ordinals, [1, 2, 3, 4, 5], "平铺视图序号连续 1..N");
    assert.deepEqual(flat.names, ARRAY_ORDER, "平铺视图显示完整 id，不做组内短名");
    assert.deepEqual(flat.handleTitles, new Array(ARRAY_ORDER.length).fill(FLAT_HANDLE_TITLE));
    assert.equal(flat.view.flat, "true");
    assert.equal(flat.view.grouped, "false");
    assert.equal(flat.view.stored, "flat", "视图偏好写入 localStorage");
    assert.equal(flat.mutationsBefore, flat.mutations, "切视图不写配置");
    assert.equal(flat.mutations, 0);
    assert.equal(flat.density.compact, "true", "切视图不重置密度");
  });

  test(`${scheme} 主题：平铺下把 tx/beta 拖到 jxf/alpha 之前 → 数组首条与界面首行都是 tx/beta`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const over = result.flatCrossOver;
    const drop = result.flatDrop;

    assert.equal(over.insertLine, true, "平铺视图允许跨组拖动并显示插入线");
    assert.equal(over.lineRow, "jxf/alpha");
    // dropEffect 在合成 DataTransfer 上是只读的（规范规定非真实拖动时不生效），
    // 所以「允许放置」的判据是插入线，而不是 dropEffect 的取值。
    assert.equal(over.mutations, 0, "拖动经过不写盘");
    assert.deepEqual(over.order, ARRAY_ORDER);

    assert.equal(drop.mutations, 1, "一次拖动只写一次");
    assert.equal(drop.lastOps.length, 1, "仍然是一条整数组 set");
    const [op] = drop.lastOps;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models"]);
    assert.equal(drop.snapshotOrder[0], "tx/beta", "写入的数组首条是 tx/beta");
    assert.equal(drop.firstRow, "tx/beta", "界面首行也是 tx/beta");
    assert.deepEqual(drop.order, ["tx/beta", "jxf/alpha", "jxf/gamma", "standalone", "tx/delta"]);
    assert.deepEqual(drop.ordinals, [1, 2, 3, 4, 5]);
    assert.equal(drop.toast, "已把 tx/beta 移到第 1 位");
  });

  test(`${scheme} 主题：平铺下 Home / End 到全表首末位，↑ / ↓ 跨组连续`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    const home = result.flatKeyboardHome;
    assert.equal(home.key, "Home");
    assert.equal(home.mutations, home.mutationsBefore + 1, "Home 立即写一次");
    assert.equal(home.snapshotOrder[0], "tx/delta", "Home 移到全表首位");
    assert.deepEqual(home.order, ["tx/delta", "tx/beta", "jxf/alpha", "jxf/gamma", "standalone"]);
    assert.equal(home.toast, "已把 tx/delta 移到第 1 位");

    const end = result.flatKeyboardEnd;
    assert.equal(end.key, "End");
    assert.equal(end.mutations, end.mutationsBefore + 1);
    assert.equal(end.snapshotOrder[end.snapshotOrder.length - 1], "tx/delta", "End 移到全表末位");
    assert.deepEqual(end.order, ["tx/beta", "jxf/alpha", "jxf/gamma", "standalone", "tx/delta"]);
    assert.equal(end.toast, "已把 tx/delta 移到第 5 位");

    const down = result.flatKeyboardDown;
    assert.equal(down.key, "ArrowDown");
    assert.equal(down.mutations, down.mutationsBefore + 1);
    assert.deepEqual(down.order, ["jxf/alpha", "tx/beta", "jxf/gamma", "standalone", "tx/delta"]);
    assert.equal(down.snapshotOrder[1], "tx/beta", "↓ 跨过 jxf / tx 的组边界也连续");
    assert.equal(down.toast, "已把 tx/beta 移到第 2 位");

    const up = result.flatKeyboardUp;
    assert.equal(up.key, "ArrowUp");
    assert.equal(up.mutations, up.mutationsBefore + 1);
    assert.deepEqual(up.order, ["tx/beta", "jxf/alpha", "jxf/gamma", "standalone", "tx/delta"]);
    assert.equal(up.snapshotOrder[0], "tx/beta", "↑ 同样跨组连续");
    assert.equal(up.toast, "已把 tx/beta 移到第 1 位");
  });

  test(`${scheme} 主题：切回分组 → 组头恢复，折叠状态与切换前一致，不写配置`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const back = result.backToGrouped;

    assert.deepEqual(back.groups, ["jxf", "tx", "其他"], "组头恢复");
    assert.equal(back.groupNodes, 3);
    assert.deepEqual(back.expanded, ["true", "false", "true"], "tx 切视图前折叠过，切回来仍折叠");
    assert.deepEqual(back.order, ["jxf/alpha", "jxf/gamma", "standalone"]);
    assert.deepEqual(back.ordinals, [1, 2, 5], "折叠组里的行仍占分组阅读序号");
    assert.deepEqual(back.names, ["alpha", "gamma", "standalone"]);
    assert.deepEqual(back.handleTitles, new Array(3).fill(GROUPED_HANDLE_TITLE));
    assert.equal(back.view.grouped, "true");
    assert.equal(back.view.flat, "false");
    assert.equal(back.view.stored, "grouped");
    assert.equal(back.mutationsBefore, back.mutations, "切视图不写配置");

    assert.deepEqual(result.groupedReexpanded.expanded, ["true", "true", "true"]);
    assert.deepEqual(result.groupedReexpanded.order, GROUPED_ORDER, "展开后组顺序回到字母序");
    assert.deepEqual(result.groupedReexpanded.ordinals, [1, 2, 3, 4, 5]);
    assert.deepEqual(
      result.groupedReexpanded.snapshotOrder,
      ["tx/beta", "jxf/alpha", "jxf/gamma", "standalone", "tx/delta"],
      "分组视图只读数组顺序，切换 / 展开都不改写数组",
    );
    assert.equal(result.groupedReexpanded.mutations, back.mutations, "展开不写配置");
  });

  test(`${scheme} 主题：密度在两种视图下都工作，切视图不重置密度也不写配置`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const detailedGrouped = result.detailedGrouped;
    const detailedFlat = result.detailedFlat;
    const compactFlat = result.compactFlat;

    assert.equal(detailedGrouped.density.detailed, "true");
    assert.equal(detailedGrouped.density.compact, "false");
    assert.equal(detailedGrouped.density.stored, "detailed");
    assert.equal(detailedGrouped.srCount, 0, "详细模式没有 sr-only 摘要节点");
    assert.deepEqual(detailedGrouped.groups, ["jxf", "tx", "其他"]);
    assert.deepEqual(
      detailedGrouped.headerSummaries,
      ["窗口 131K · 输出 8K · text · 4 档", "窗口 131K · 输出 8K · text · 4 档", ""],
      "多行组把相同摘要提到组头；单行的「其他」组没有组头摘要",
    );
    assert.deepEqual(
      detailedGrouped.summaries,
      ["", "", "", "", "窗口 131K · 输出 8K · text · 4 档"],
      "组头已有的摘要不在行内重复",
    );
    assert.equal(detailedGrouped.mutationsBefore, detailedGrouped.mutations, "切密度不写配置");

    assert.deepEqual(detailedFlat.groups, [], "切到平铺仍然没有组头");
    assert.equal(detailedFlat.density.detailed, "true", "切视图保留详细密度");
    assert.equal(detailedFlat.density.stored, "detailed");
    assert.equal(detailedFlat.view.stored, "flat");
    assert.equal(detailedFlat.srCount, 0);
    assert.deepEqual(
      detailedFlat.summaries,
      new Array(5).fill("窗口 131K · 输出 8K · text · 4 档"),
      "平铺详细模式每行显示自己的摘要（没有组头摘要可去重）",
    );
    assert.deepEqual(detailedFlat.order, ["tx/beta", "jxf/alpha", "jxf/gamma", "standalone", "tx/delta"]);
    assert.equal(detailedFlat.mutationsBefore, detailedFlat.mutations, "切视图不写配置，密度也不动配置");

    assert.equal(compactFlat.density.compact, "true");
    assert.equal(compactFlat.density.stored, "compact");
    assert.equal(compactFlat.view.flat, "true");
    assert.equal(compactFlat.srCount, 5, "紧凑模式恢复 sr-only 摘要");
    assert.deepEqual(compactFlat.summaries, new Array(5).fill(""));
    assert.deepEqual(compactFlat.order, detailedFlat.order, "只切密度，行顺序不变");
  });

  test(`${scheme} 主题：平铺下搜索没有折叠分组，全选只作用于命中行`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.flatSearch.order, ["jxf/gamma"]);
    assert.deepEqual(result.flatSearch.groups, []);
    assert.equal(result.flatSearch.footer, "显示 1 / 5 条");
    assert.equal(result.flatSearch.mutations, result.flatSearchCleared.mutations);
    assert.equal(result.flatSearchSelectAll.selected, 1);
    assert.equal(result.flatSearchSelectAll.visible, 1);
    assert.deepEqual(result.flatSearchCleared.order, ["tx/beta", "jxf/alpha", "jxf/gamma", "standalone", "tx/delta"]);
  });
}

test("视图偏好从 localStorage 读回：flat 直接以平铺渲染，非法值回落分组且不覆盖", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

  const flat = await storedProbe("light", { storedView: "flat", storedDensity: "detailed" });
  assert.equal(flat.view.flat, "true", "存储 flat → 初始就是平铺");
  assert.equal(flat.view.grouped, "false");
  assert.equal(flat.view.stored, "flat");
  assert.deepEqual(flat.groups, []);
  assert.equal(flat.groupNodes, 0);
  assert.deepEqual(flat.order, ARRAY_ORDER);
  assert.deepEqual(flat.ordinals, [1, 2, 3, 4, 5]);
  assert.deepEqual(flat.names, ARRAY_ORDER);
  assert.deepEqual(flat.handleTitles, new Array(5).fill(FLAT_HANDLE_TITLE));
  assert.equal(flat.density.detailed, "true", "密度偏好独立读回");
  assert.deepEqual(flat.summaries, new Array(5).fill("窗口 131K · 输出 8K · text · 4 档"));
  assert.equal(flat.mutations, 0);

  const invalid = await storedProbe("light", { storedView: "grid", storedDensity: "compact" });
  assert.equal(invalid.view.grouped, "true", "非法视图值回落分组");
  assert.equal(invalid.view.flat, "false");
  assert.equal(invalid.view.stored, "grid", "读取非法值不覆盖存储");
  assert.deepEqual(invalid.groups, ["jxf", "tx", "其他"]);
  assert.deepEqual(invalid.order, GROUPED_ORDER);
  assert.deepEqual(invalid.names, GROUPED_NAMES);
  assert.deepEqual(invalid.handleTitles, new Array(5).fill(GROUPED_HANDLE_TITLE));
  assert.equal(invalid.srCount, 5);
  assert.equal(invalid.mutations, 0);
});

test("视图偏好 key 是全局单一 key，与路由无关", () => {
  assert.equal(VIEW_MODE_KEY, "modelpilot.model-list-view.v1");
});
