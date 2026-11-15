// 工单 #33：批量操作可见性的真实 DOM 测试。
//
// 覆盖问题一（折叠 / 搜索隐藏的选中必须可见且可处理）与问题三（全选半选）。
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，派发真实
// click / input 事件，读回复选框状态、界面文案与 mutate 次数。Chrome 不可用时
// skip（与既有浏览器测试一致）。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildBulkVisibilityHtml } from "./bulk-visibility-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildBulkVisibilityHtml(bundle, scheme)));
  return probes.get(scheme);
}

const ORDER = [
  "acme/one",
  "acme/two",
  "acme/three",
  "jxf/one",
  "jxf/two",
  "jxf/three",
  "tx/one",
  "tx/two",
];

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：8 条里选 3 条 → 全选复选框一致，半选 / 勾满 / 清空三态`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.scheme, scheme);

    assert.deepEqual(result.initial.order, ORDER, "初始全部展开，组内保持数组顺序");
    assert.equal(result.initial.selectedCount, 0);
    assert.equal(result.initial.selectAllChecked, false);
    assert.equal(result.initial.selectAllIndeterminate, false);
    assert.equal(result.initial.selectAllLabel, "全选", "未选时 aria-label 是「全选」");
    assert.equal(result.initial.hiddenText, "");
    assert.equal(result.initial.mutations, 0, "渲染与分组不写配置");

    assert.deepEqual(result.partial.selected, ["acme/one", "acme/two", "acme/three"]);
    assert.equal(result.partial.selectedCount, 3);
    assert.match(result.partial.bulkText, /已选 3 条/);
    assert.equal(result.partial.selectAllChecked, false, "3/8 不应显示成已全选");
    assert.equal(result.partial.selectAllIndeterminate, true, "3/8 必须是半选");
    assert.equal(result.partial.selectAllLabel, "已选 3 / 8 条");
    assert.equal(result.partial.hiddenText, "");
    assert.equal(result.partial.mutations, 0);

    assert.equal(result.selectedAll.selectedCount, 8, "点半选复选框 → 勾满，不是清空");
    assert.equal(result.selectedAll.selectAllChecked, true);
    assert.equal(result.selectedAll.selectAllIndeterminate, false);
    assert.equal(result.selectedAll.selectAllLabel, "已全选 8 条");
    assert.equal(result.selectedAll.mutations, 0);

    assert.equal(result.deselectedAll.selectedCount, 0);
    assert.equal(result.deselectedAll.selectAllChecked, false);
    assert.equal(result.deselectedAll.selectAllIndeterminate, false);
    assert.equal(result.deselectedAll.selectAllLabel, "全选");
    assert.equal(result.deselectedAll.mutations, 0);
  });

  test(`${scheme} 主题：折叠已选分组后明确提示「未显示」，可取消且全程不写配置`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.collapsed.selected, [], "折叠后界面上没有任何已勾选行");
    assert.equal(result.collapsed.selectedCount, 3, "但选择集合仍保留 3 条");
    assert.match(result.collapsed.hiddenText, /3 条未显示/, "批量栏必须点名 3 条未显示");
    assert.match(result.collapsed.bulkText, /已选 3 条/);
    assert.equal(result.collapsed.selectAllChecked, false);
    assert.equal(result.collapsed.selectAllIndeterminate, false, "可见行一条也没选，半选应为 false");
    assert.equal(result.collapsed.selectAllLabel, "全选");
    assert.equal(result.collapsed.order.includes("acme/one"), false);
    assert.equal(result.collapsed.mutations, 0, "折叠是纯视图状态");
    assert.equal(result.collapsed.mutationsAfter, 0);

    assert.equal(result.hiddenCleared.selectedCount, 0);
    assert.deepEqual(result.hiddenCleared.selected, []);
    assert.equal(result.hiddenCleared.hiddenText, "", "取消后不再提示未显示");
    assert.match(result.hiddenCleared.bulkText, /已选 0 条/);
    assert.equal(result.hiddenCleared.mutations, 0, "取消隐藏选择不写配置");
  });

  test(`${scheme} 主题：搜索过滤掉已选行时同样提示未显示，可一键取消`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);

    assert.deepEqual(result.searchHidden.selected, [], "命中的 jxf 行没被勾选");
    assert.equal(result.searchHidden.selectedCount, 1);
    assert.match(result.searchHidden.hiddenText, /1 条未显示/);
    assert.equal(result.searchHidden.selectAllIndeterminate, false);
    // 问题四：搜索时组头显示命中数/总数，0 命中的组不能继续显示总数。
    assert.deepEqual(result.searchGroupCounts, ["(0/3)", "(1/3)", "(0/2)"]);
    assert.equal(result.searchHidden.mutations, 0);

    assert.equal(result.searchHiddenCleared.selectedCount, 0);
    assert.equal(result.searchHiddenCleared.hiddenText, "");
    assert.equal(result.searchHiddenCleared.mutations, 0);

    assert.deepEqual(result.cleared.order, ORDER, "清空搜索恢复全部行与顺序");
    assert.equal(result.cleared.selectedCount, 0);
    assert.equal(result.cleared.hiddenText, "");
    assert.equal(result.cleared.mutations, 0, "搜索 / 选择 / 半选全程不写配置");
  });
}
