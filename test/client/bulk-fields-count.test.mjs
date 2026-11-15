// 工单 #35：批量改字段的成功提示必须写真实改动条数（真实 DOM / headless Chrome）。
//
// 三条模型里两条本来就是目标值：基线会把它们也算进「已批量更新 3 条」。
// 这里同时从 mutate 的 set 前后快照算出真实变化条数，再与 toast 里的数字比对。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildBulkFieldsCountHtml } from "./bulk-count-and-hints-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildBulkFieldsCountHtml(bundle, scheme)));
  return probes.get(scheme);
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
const toastCount = (text) => Number(text.match(/^已批量更新 (\d+) 条/)?.[1] ?? Number.NaN);

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：部分行已是目标值时 toast 写真实改动条数`, async (t) => {
    if (chrome === null) return skip(t);
    const { partial } = await probe(scheme);
    assert.deepEqual(partial.changedIds, ["c/changed"], "只有 c 真正变化");
    assert.equal(partial.toast, "已批量更新 1 条模型（3 条中 2 条已是目标值）");
    assert.equal(toastCount(partial.toast), partial.changedIds.length, "toast 里的数字等于真实变化条数");
    assert.match(partial.toast, /3 条中 2 条已是目标值/);
  });

  test(`${scheme} 主题：全部行都变化时 toast 写全量条数`, async (t) => {
    if (chrome === null) return skip(t);
    const { allChanged } = await probe(scheme);
    assert.deepEqual(allChanged.changedIds, ["a/already", "b/already", "c/changed"]);
    assert.equal(allChanged.toast, "已批量更新 3 条模型");
    assert.equal(toastCount(allChanged.toast), allChanged.changedIds.length);
    assert.doesNotMatch(allChanged.toast, /已是目标值/);
  });

  test(`${scheme} 主题：每次批量改字段仍只有一条 set 整数组`, async (t) => {
    if (chrome === null) return skip(t);
    const { mutations, partial, allChanged } = await probe(scheme);
    assert.equal(mutations.length, 2, "两次批量改字段各写一次");
    for (const [index, ops] of mutations.entries()) {
      assert.equal(ops.length, 1, "一次 mutate 只有一条 op");
      assert.equal(ops[0].op, "set");
      assert.deepEqual(ops[0].path, ["providers", "preview-chat", "models"]);
      const expected = index === 0 ? 8192 : 16384;
      assert.deepEqual(ops[0].value.map((row) => row.maxTokens), [expected, expected, expected]);
    }
    assert.deepEqual(partial.after.map((row) => row.maxTokens), [8192, 8192, 8192]);
    assert.deepEqual(allChanged.after.map((row) => row.maxTokens), [16384, 16384, 16384]);
  });
}
