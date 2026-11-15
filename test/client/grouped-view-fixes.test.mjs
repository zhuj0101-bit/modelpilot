// 工单 #32：分组视图下的两处行为失配 —— 跨组拖动必须被拒绝，紧凑模式的
// 摘要必须在键盘 / 触屏 / 读屏下也能拿到。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，派发真实
// DragEvent / KeyboardEvent / click，读回插入线、mutate 参数、列表顺序、
// aria-label 与 sr-only 节点的计算样式。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildGroupedViewFixesHtml } from "./grouped-view-fixes-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildGroupedViewFixesHtml(bundle, scheme)));
  return probes.get(scheme);
}

const CROSS_TOAST = "只能在同一分组内调整顺序；跨分组无法排序";
const INITIAL_ORDER = [
  "acme/zeta",
  "acme/alpha",
  "acme/flash",
  "jxf/dsv4.1-flash",
  "jxf/dsv4.1-pro",
  "jxf/dsv4-pro-reason",
  "tx/deepseek-v4.1-flash",
  "tx/deepseek-v4.1-pro",
  "standalone",
];
const SAME_GROUP_ORDER = [
  "acme/zeta",
  "acme/alpha",
  "acme/flash",
  "jxf/dsv4.1-pro",
  "jxf/dsv4-pro-reason",
  "jxf/dsv4.1-flash",
  "tx/deepseek-v4.1-flash",
  "tx/deepseek-v4.1-pro",
  "standalone",
];
const KEYBOARD_ORDER = [
  "acme/zeta",
  "acme/alpha",
  "acme/flash",
  "jxf/dsv4-pro-reason",
  "jxf/dsv4.1-flash",
  "jxf/dsv4.1-pro",
  "tx/deepseek-v4.1-flash",
  "tx/deepseek-v4.1-pro",
  "standalone",
];
const SHARED_SUMMARY = "窗口 131K · 输出 8K · text · 4 档";

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：默认紧凑且渲染不写盘`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.__error, undefined, result.__error ?? "");
    assert.deepEqual(result.compact.order, INITIAL_ORDER);
    assert.equal(result.compact.mutations, 0, "渲染不写盘");
    assert.equal(result.compact.storage, null, "默认紧凑不写 localStorage");
  });

  test(`${scheme} 主题：跨组拖动经过别的组不画插入线，dropEffect 为 none`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.crossOver.insertLine, false, "落点在 tx 组时不显示插入线");
    assert.equal(result.crossOver.lineRow, "", "插入线不属于任何行");
    assert.equal(result.crossOver.dropEffect, "none", "跨组落点显示禁止放置");
    assert.equal(result.crossOver.opacity, "0.45", "被拖行仍保持半透明");
    assert.equal(result.crossOver.mutations, 0, "拖动过程不写盘");
    assert.deepEqual(result.crossOver.order, INITIAL_ORDER);
  });

  test(`${scheme} 主题：从跨组行移回本组行，插入线恢复；再跨组又消失`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.sameOverAfterCross.insertLine, true, "回到 jxf 组后显示插入线");
    assert.equal(result.sameOverAfterCross.lineRow, "jxf/dsv4.1-pro", "插入线画在本组目标行上");
    assert.equal(result.sameOverAfterCross.mutations, 0);
    assert.equal(result.crossAgain.insertLine, false, "再次经过 tx 组时插入线清空");
    assert.equal(result.crossAgain.lineRow, "");
    assert.equal(result.crossAgain.dropEffect, "none");
    assert.equal(result.crossAgain.mutations, 0);
  });

  test(`${scheme} 主题：跨组松手不写盘、不产生 op，提示只能同组排序`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.crossDrop.mutations, 0, "跨组拖动不调用 mutate");
    assert.equal(result.crossDrop.lastOps, null, "跨组拖动不产生任何 settingsOps");
    assert.deepEqual(result.crossDrop.order, INITIAL_ORDER, "界面顺序保持不变");
    assert.deepEqual(result.crossDrop.snapshotOrder, INITIAL_ORDER, "配置数组顺序保持不变");
    assert.equal(result.crossDrop.toast, CROSS_TOAST, "给出跨组拒绝提示");
    assert.equal(result.crossDrop.insertLine, false, "松手后插入线消失");
    assert.equal(result.crossDrop.opacity, "1", "松手后拖动状态清空");
  });

  test(`${scheme} 主题：跨组拖动按 Esc 取消，不写盘也不弹提示`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.crossCancel.mutations, 0);
    assert.deepEqual(result.crossCancel.order, INITIAL_ORDER);
    assert.deepEqual(result.crossCancel.snapshotOrder, INITIAL_ORDER);
    assert.equal(result.crossCancel.toastPresent, false, "取消不是拒绝，不弹任何提示");
    assert.equal(result.crossCancel.toast, "");
    assert.equal(result.crossCancel.insertLine, false);
  });

  test(`${scheme} 主题：同组拖动行为不变：一次 mutate、一条整数组 set`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.sameOver.insertLine, true);
    assert.equal(result.sameOver.lineRow, "jxf/dsv4-pro-reason");
    assert.equal(result.sameDrop.mutations, 1, "整个流程只有同组拖动写盘一次");
    assert.equal(result.sameDrop.opCount, 1);
    assert.equal(result.sameDrop.lastOps[0].op, "set");
    assert.deepEqual(result.sameDrop.lastOps[0].path, ["providers", "preview-chat", "models"]);
    assert.equal(result.sameDrop.lastOps[0].value.length, INITIAL_ORDER.length);
    assert.deepEqual(result.sameDrop.order, SAME_GROUP_ORDER);
    assert.deepEqual(result.sameDrop.snapshotOrder, SAME_GROUP_ORDER);
    assert.match(result.sameDrop.toast, /已把 jxf\/dsv4\.1-flash 移到第 6 位/);
    const groups = Object.fromEntries(result.sameDrop.groups.map((row) => [row.id, row.group]));
    assert.deepEqual(groups, Object.fromEntries(INITIAL_ORDER.map((id) => [id, id.includes("/") ? id.slice(0, id.indexOf("/")) : "其他"])));
  });

  test(`${scheme} 主题：反方向跨组（tx → jxf）同样被拒绝`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.reverseCross.mutations, 1, "反方向跨组不新增 mutate");
    assert.deepEqual(result.reverseCross.order, SAME_GROUP_ORDER);
    assert.deepEqual(result.reverseCross.snapshotOrder, SAME_GROUP_ORDER);
    assert.equal(result.reverseCross.toast, CROSS_TOAST);
  });

  test(`${scheme} 主题：拖到「其他」组同样被拒绝`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.otherCross.mutations, 1, "跨到「其他」组不新增 mutate");
    assert.deepEqual(result.otherCross.order, SAME_GROUP_ORDER);
    assert.deepEqual(result.otherCross.snapshotOrder, SAME_GROUP_ORDER);
    assert.equal(result.otherCross.toast, CROSS_TOAST);
  });

  test(`${scheme} 主题：键盘排序仍限制在本组，End 只到 jxf 组末位`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.keyboard.from, "jxf/dsv4.1-pro");
    assert.equal(result.keyboard.to, "jxf/dsv4.1-flash");
    assert.equal(result.keyboard.mutations, 2, "键盘排序新增一次 mutate");
    assert.equal(result.keyboard.lastOps.length, 1);
    assert.equal(result.keyboard.lastOps[0].op, "set");
    assert.deepEqual(result.keyboard.lastOps[0].path, ["providers", "preview-chat", "models"]);
    assert.deepEqual(result.keyboard.order, KEYBOARD_ORDER);
    assert.deepEqual(result.keyboard.snapshotOrder, KEYBOARD_ORDER);
    assert.deepEqual(result.keyboard.groupOrder, ["jxf/dsv4-pro-reason", "jxf/dsv4.1-flash", "jxf/dsv4.1-pro"]);
    assert.match(result.keyboard.toast, /已把 jxf\/dsv4\.1-pro 移到第 6 位/);
  });

  test(`${scheme} 主题：紧凑模式行 aria-label 含完整摘要（模型 xxx。窗口…·输出…）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    for (const row of result.compact.rows) {
      const prefix = `模型 ${row.id}。`;
      assert.equal(row.label.startsWith(prefix), true, `${row.id} 的可访问名以完整 id 开头`);
      assert.match(row.label.slice(prefix.length), /^窗口 .+ · 输出 .+ · .+ · .+$/, `${row.id} 的摘要四段齐全`);
    }
    const acme = result.compact.rows.find((row) => row.id === "acme/zeta");
    assert.equal(acme.label, `模型 acme/zeta。${SHARED_SUMMARY}`, "组内共享摘要也进入可访问名");
    for (const id of ["jxf/dsv4-pro-reason", "standalone"]) {
      const row = result.compact.rows.find((item) => item.id === id);
      assert.match(row.label, /窗口 (131K|200K) · 输出 (8K|66K)/);
    }
    assert.equal(result.compact.rows.some((row) => row.visibleSummary !== ""), false, "紧凑视觉上仍不显示摘要");
    assert.equal(result.compact.rows.every((row) => row.rowTitle === ""), true, "紧凑行容器仍不挂完整 id 的 title");
    for (const row of result.compact.rows) {
      assert.equal(row.nameTitle.split("\n")[0], row.id, "鼠标悬停仍能读到完整 id");
      assert.match(row.nameTitle.split("\n")[1] ?? "", /^窗口：模型声明 (131K|200K)$/, "悬停仍保留逐字段来源说明");
    }
  });

  test(`${scheme} 主题：紧凑模式 sr-only 摘要节点读屏可读、视觉隐藏且不是 display:none`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    for (const row of result.compact.rows) {
      assert.notEqual(row.sr, null, `${row.id} 有 sr-only 摘要节点`);
      const { sr } = row;
      assert.equal(sr.text, row.label.slice(`模型 ${row.id}。`.length), "sr-only 文本与 aria-label 摘要一致");
      assert.notEqual(sr.display, "none", "不能用 display:none（读屏会一起丢掉）");
      assert.notEqual(sr.visibility, "hidden", "不能用 visibility:hidden");
      assert.equal(sr.position, "absolute");
      assert.equal(sr.width, "1px");
      assert.equal(sr.height, "1px");
      assert.equal(sr.overflow, "hidden");
      assert.equal(sr.margin, "-1px");
      assert.equal(sr.whiteSpace, "nowrap");
      assert.match(sr.clip, /^rect\(0(px)?(, 0(px)?){3}\)$/, "使用标准 clip 视觉隐藏");
      assert.equal(sr.rectWidth <= 1, true);
      assert.equal(sr.rectHeight <= 1, true);
      assert.equal(row.rowHeight < 40, true, "1px 绝对定位不撑高紧凑行");
    }
    assert.equal(result.compact.rows.length, INITIAL_ORDER.length);
  });

  test(`${scheme} 主题：详细模式摘要可见、title 仍在，aria-label 与紧凑一致`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.detailed.labels, result.compact.labels, "两种密度的可访问信息一致");
    assert.equal(result.detailed.srCount, 0, "详细模式不重复堆 sr-only 节点");
    assert.match(result.detailed.mixedSummaryText, /窗口 200K/, "混合摘要的行内显示自己的摘要");
    assert.match(result.detailed.mixedSummaryTitle, /^窗口：模型声明 200K/, "详细模式摘要的 title 仍在");
    assert.equal(result.detailed.acmeRowSummary, "", "共享摘要不逐行重复");
    assert.equal(result.detailed.acmeGroupSummary, SHARED_SUMMARY, "共享摘要仍在组头");
    assert.equal(result.detailed.jxfGroupSummary, "", "混合摘要的组头仍留空");
    for (const row of result.compact.rows) {
      assert.equal(result.detailed.rowTitles[row.id], row.id, "详细模式行容器仍挂完整 id 的 title");
      assert.equal(result.detailed.nameTitles[row.id], "", "详细模式短 id 不重复挂 title");
      assert.equal(result.detailed.rowHeights[row.id] > row.rowHeight, true, "详细行高于紧凑行");
    }
    assert.equal(result.detailed.storage, "detailed");
    assert.equal(result.detailed.mutations, 2, "切换密度不写盘");
  });

  test(`${scheme} 主题：切换密度不改变 aria-label，sr-only 节点随紧凑恢复`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.compactAgain.labels, result.compactLabelsBeforeSwitch);
    assert.deepEqual(result.compactAgain.labels, result.detailed.labels);
    assert.equal(result.compactAgain.srCount, INITIAL_ORDER.length);
    assert.deepEqual(result.compactAgain.order, KEYBOARD_ORDER);
    assert.equal(result.compactAgain.storage, "compact");
    assert.equal(result.compactAgain.mutations, 2);
  });
}
