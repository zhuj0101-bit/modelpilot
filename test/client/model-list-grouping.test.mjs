// 工单 #31：长模型列表的分组折叠 + 摘要去重 + 密度切换的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，派发真实
// click / input / DragEvent，读回组顺序、折叠状态、短名 / 完整 id 的悬停、
// 摘要去重、localStorage 偏好与 mutate 参数。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import {
  DENSITY_KEY,
  buildModelListGroupingHtml,
} from "./model-list-grouping-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme, options = {}) {
  const key = `${scheme}:${options.storedDensity ?? "none"}`;
  if (!probes.has(key)) {
    probes.set(key, runPageProbe(chrome, buildModelListGroupingHtml(bundle, scheme, options)));
  }
  return probes.get(key);
}

const SHARED_SUMMARY = "窗口 131K · 输出 8K · text · 4 档";
const ORDER = [
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
const SHORT_NAMES = [
  "zeta",
  "alpha",
  "flash",
  "dsv4.1-flash",
  "dsv4.1-pro",
  "dsv4-pro-reason",
  "deepseek-v4.1-flash",
  "deepseek-v4.1-pro",
  "standalone",
];

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：默认紧凑；组按字母序、「其他」最后，组内保持数组顺序并显示短名`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const initial = result.initial;

    assert.equal(result.scheme, scheme);
    assert.equal(result.initialStorage, null, "默认 compact 不写 storage");
    assert.deepEqual(initial.groups, ["acme", "jxf", "tx", "其他"]);
    assert.deepEqual(initial.counts, ["(3)", "(3)", "(2)", "(1)"]);
    assert.deepEqual(initial.expanded, ["true", "true", "true", "true"], "初始全展开，折叠状态不写配置");
    assert.deepEqual(initial.order, ORDER, "组内保持 models 数组顺序，组间按前缀字母序");
    assert.deepEqual(initial.names.map((name) => name.text), SHORT_NAMES, "组内显示去掉前缀的短 id");
    for (const row of result.initial.rows) {
      assert.equal(row.rowTitle, "", "紧凑模式行容器不挂完整 id 的 title");
      assert.match(row.nameTitle, /^.+[\s\S]*窗口/, "短 id 的 title 同时给出完整 id 与摘要");
      assert.equal(row.nameTitle.split("\n")[0], row.id, "title 第一行是完整 id");
      assert.equal(row.hasSummaryText, false, "紧凑模式行内不显示摘要");
    }
    assert.deepEqual(initial.rowSummaries, new Array(ORDER.length).fill(""));
    initial.rowText.forEach((text, index) => {
      assert.equal(text.includes(SHORT_NAMES[index]), true, "紧凑行显示短 id");
      assert.equal(text.includes("窗口"), false, "紧凑行内没有摘要");
    });
    assert.equal(initial.density.compact, "true");
    assert.equal(initial.density.detailed, "false");
    assert.equal(initial.density.stored, null);
    assert.equal(initial.mutations, 0, "渲染分组 / 密度不写盘");
  });

  test(`${scheme} 主题：组内摘要全文相同 → 提到组头；混合摘要 → 组头留空、行内各自显示`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const detailed = result.detailed;

    assert.equal(detailed.density.detailed, "true");
    assert.equal(detailed.density.compact, "false");
    assert.equal(detailed.density.stored, "detailed");
    assert.deepEqual(detailed.headerSummaries, [SHARED_SUMMARY, "", SHARED_SUMMARY, ""]);
    assert.equal(detailed.jxfHeaderSummary, "", "混合摘要时组头不猜统一值");
    assert.deepEqual(detailed.rowSummaries.slice(0, 3), ["", "", ""], "组头已有的摘要不在行内重复");
    assert.deepEqual(detailed.rowSummaries.slice(6, 8), ["", ""], "tx 组同样提到组头");
    assert.match(detailed.rowSummaries[3], /窗口 131K/);
    assert.match(detailed.rowSummaries[5], /窗口 200K/, "与组头不同的行显示自己的摘要");
    assert.match(detailed.rowSummaries[8], /窗口 131K/);
    assert.match(detailed.rowText[3], /窗口 131K/, "详细模式行内显示完整摘要");
    assert.equal(detailed.rowText[1].includes("窗口"), false, "acme 行内不再重复组头摘要");

    assert.equal(result.initial.groupSummary.tag, "SPAN");
    assert.equal(result.initial.groupSummary.inButton, false);
    assert.equal(result.initial.groupSummary.cursor, "default", "组头摘要只是说明文字，不可点击");
    assert.equal(result.initial.groupSummary.text, SHARED_SUMMARY);
  });

  test(`${scheme} 主题：紧凑模式把摘要移入 title hover，行高明显低于详细模式`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.compact.density.compact, "true");
    assert.equal(result.compact.density.stored, "compact");
    assert.deepEqual(result.compact.rowSummaries, new Array(ORDER.length).fill(""));
    for (const name of result.compact.names) {
      assert.match(name.title, /窗口/, "紧凑模式摘要保留在短 id 的 title 里");
    }
    assert.deepEqual(
      result.compact.names.map((name) => name.title.split("\n")[0]),
      ORDER,
      "hover 仍能读到完整 id",
    );
    assert.equal(result.compact.rowHeights[0] < result.detailed.rowHeights[0], true, "紧凑行高应低于详细行高");
    assert.equal(result.compact.rowHeights[0] < 40, true);
    assert.equal(result.detailed.rowHeights[0] >= 50, true);
  });

  test(`${scheme} 主题：折叠 / 展开只改视图；全选只作用于当前可见（展开且命中筛选）的行`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.collapsed.expanded, ["false", "true", "true", "true"]);
    assert.deepEqual(result.collapsed.counts, ["(3)", "(3)", "(2)", "(1)"], "折叠不改变组计数");
    assert.deepEqual(result.collapsed.order, ORDER.slice(3));
    assert.equal(result.collapsed.mutations, 0, "折叠状态不写配置");
    assert.equal(result.collapsedSelectAll.selected, 6, "全选只勾 6 条可见行，不勾 acme 的 3 条");
    assert.equal(result.collapsedSelectAll.mutations, 0);
    assert.deepEqual(result.expandedAgain.order, ORDER, "重新展开恢复组内顺序，没有写盘");
  });

  test(`${scheme} 主题：搜索命中的组自动展开、未命中的组收起；手动折叠后清空搜索恢复全展开`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.search.expanded, ["true", "true", "true", "false"]);
    assert.deepEqual(result.search.order, [
      "acme/flash",
      "jxf/dsv4.1-flash",
      "tx/deepseek-v4.1-flash",
    ]);
    assert.equal(result.search.footer, "显示 3 / 9 条");
    assert.equal(result.search.mutations, 0, "搜索只影响视图");

    assert.deepEqual(result.searchManualCollapse.expanded, ["true", "false", "true", "false"]);
    assert.deepEqual(result.searchManualCollapse.order, [
      "acme/flash",
      "tx/deepseek-v4.1-flash",
    ], "搜索中仍可手动折叠命中的组");
    assert.equal(result.searchManualCollapse.footer, "显示 2 / 9 条");
    assert.equal(result.searchSelectAll.selected, 2, "全选只勾展开且命中的行");

    assert.deepEqual(result.cleared.expanded, ["true", "true", "true", "true"], "清空搜索恢复全展开");
    assert.deepEqual(result.cleared.order, ORDER);
    assert.equal(result.cleared.footer, "");
    assert.equal(result.cleared.mutations, 0);
  });

  test(`${scheme} 主题：拖动按 models 数组绝对下标写盘，分组顺序不被拖动改写`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.drag.mutations, 1, "一次拖动只写一次");
    assert.equal(result.drag.lastOps.length, 1);
    const [op] = result.drag.lastOps;
    assert.equal(op.op, "set");
    assert.deepEqual(op.path, ["providers", "preview-chat", "models"]);
    assert.deepEqual(result.drag.snapshotOrder, [
      "acme/alpha",
      "acme/flash",
      "acme/zeta",
      "jxf/dsv4.1-flash",
      "jxf/dsv4.1-pro",
      "jxf/dsv4-pro-reason",
      "tx/deepseek-v4.1-flash",
      "tx/deepseek-v4.1-pro",
      "standalone",
    ], "拖到第三行之后 → 绝对下标 2");
    assert.deepEqual(result.drag.order, [
      "acme/alpha",
      "acme/flash",
      "acme/zeta",
      "jxf/dsv4.1-flash",
      "jxf/dsv4.1-pro",
      "jxf/dsv4-pro-reason",
      "tx/deepseek-v4.1-flash",
      "tx/deepseek-v4.1-pro",
      "standalone",
    ]);
  });

  test(`${scheme} 主题：折叠组没有拖动手柄；搜索时手柄禁用并说明原因`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.collapsedNoHandles.handles.length, 6, "折叠的 acme 组 3 行不渲染手柄");
    assert.equal(result.collapsedNoHandles.hiddenHandle, null);
    assert.deepEqual(result.collapsedNoHandles.rows, ORDER.slice(3));

    assert.equal(result.searchHandles.handles.length, 3);
    assert.equal(result.searchHandles.handles.every((row) => row.disabled && !row.draggable), true);
    assert.equal(result.searchHandles.handles.every((row) => row.title.includes("筛选状态下不可排序")), true);
    assert.equal(result.searchHandles.footer, "显示 3 / 9 条");
  });

  test(`${scheme} 主题：行内删除打开同一个二次确认弹窗，取消不写盘`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.equal(result.rowDelete.dialog, true);
    assert.equal(result.rowDelete.target, true, "确认弹窗写明要删除的模型 id");
    assert.equal(result.rowDelete.mutations, 0, "打开 / 取消确认不写配置");
    assert.equal(result.rowDelete.cancelled, true, "取消后弹窗关闭");
  });

  test(`${scheme} 主题：密度偏好从 localStorage 读取；非法值回落 compact`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    if (scheme !== "light") return t.skip("light 主题已覆盖存储读取");
    const invalid = await probe(scheme, { storedDensity: "verbose" });
    assert.equal(invalid.initial.density.compact, "true");
    assert.equal(invalid.initial.density.detailed, "false");
    assert.equal(invalid.initial.density.stored, "verbose", "读取非法值不覆盖存储，回落 compact");
    assert.equal(invalid.initial.rowSummaries.every((text) => text === ""), true);

    const detailed = await probe(scheme, { storedDensity: "detailed" });
    assert.equal(detailed.initial.density.compact, "false");
    assert.equal(detailed.initial.density.detailed, "true");
    assert.equal(detailed.initial.density.stored, "detailed");
    assert.match(detailed.initial.rowSummaries[8], /窗口 131K/, "详细模式直接读回并显示摘要");
  });
}

test("密度偏好 key 是全局单一 key，与路由无关", () => {
  assert.equal(DENSITY_KEY, "modelpilot.model-list-density.v1");
});
