// 工单 #34 问题二：collapsedGroups 必须随分组消失清理，否则同名分组重建时
// 会默认折叠，用户看不到刚新增的模型；清理只能剔除已不存在的 key，不能把
// 其它现存分组的折叠状态一起清掉。
//
// 折叠中的分组不渲染行，界面无法删除它，因此用 scope.subscribe 模拟宿主
// 另一处更新删掉 acme 的全部模型，再用真实的「新增模型」表单加回 acme/new。
// 渲染的是打包后的 lib/client.js；Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildGroupedViewCleanupHtml } from "./grouped-view-cleanup-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildGroupedViewCleanupHtml(bundle, scheme)));
  return probes.get(scheme);
}

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
const AFTER_DELETE_ORDER = INITIAL_ORDER.filter((id) => !id.startsWith("acme/"));
const AFTER_ADD_ORDER = [...AFTER_DELETE_ORDER, "acme/new"];

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：折叠 acme 后删除全组，再加回 acme/new 时该组默认展开`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.__error, undefined, result.__error ?? "");

    assert.deepEqual(result.initial.expanded, {
      acme: "true",
      jxf: "true",
      tx: "true",
      其他: "true",
    });
    assert.deepEqual(result.initial.rows, INITIAL_ORDER);
    assert.equal(result.initial.mutations, 0, "渲染不写盘");

    assert.deepEqual(result.collapsed.expanded, {
      acme: "false",
      jxf: "false",
      tx: "true",
      其他: "true",
    });
    assert.deepEqual(result.collapsed.rows, ["tx/deepseek-v4.1-flash", "tx/deepseek-v4.1-pro", "standalone"]);
    assert.equal(result.collapsed.mutations, 0, "折叠状态不写配置");

    // acme 消失后，只清理它的折叠 key；jxf 仍然折叠。
    assert.deepEqual(result.afterDelete.groups, ["jxf", "tx", "其他"]);
    assert.equal(result.afterDelete.expanded.acme, undefined, "acme 组已消失");
    assert.equal(result.afterDelete.expanded.jxf, "false", "现存分组的折叠状态保留");
    assert.deepEqual(result.afterDelete.rows, ["tx/deepseek-v4.1-flash", "tx/deepseek-v4.1-pro", "standalone"]);
    assert.deepEqual(result.afterDelete.models, AFTER_DELETE_ORDER);
    assert.equal(result.afterDelete.mutations, 1, "删除本身写一次配置");

    // 新增 acme/new 后同名组必须默认展开；无关分组仍保持折叠。
    assert.equal(result.addButtonDisabled, false, "新增表单可提交");
    assert.deepEqual(result.afterAdd.groups, ["acme", "jxf", "tx", "其他"]);
    assert.equal(result.afterAdd.expanded.acme, "true", "重建的 acme 组默认展开");
    assert.equal(result.afterAdd.expanded.jxf, "false", "无关分组的折叠状态不变");
    assert.deepEqual(result.afterAdd.rows, ["acme/new", "tx/deepseek-v4.1-flash", "tx/deepseek-v4.1-pro", "standalone"]);
    assert.deepEqual(result.afterAdd.models, AFTER_ADD_ORDER);

    // 全程 mutations 只来自删除与新增本身：各一条 set，models 数组路径；
    // 折叠 / 展开不产生任何写盘。
    assert.equal(result.afterAdd.mutations, 2, "删除 + 新增各写一次");
    assert.equal(result.mutations.length, 2);
    for (const ops of result.mutations) {
      assert.equal(ops.length, 1);
      assert.equal(ops[0].op, "set");
      assert.deepEqual(ops[0].path.slice(0, 3), ["providers", "preview-chat", "models"]);
    }
    assert.deepEqual(result.mutations[0][0].value.map((model) => model.id), AFTER_DELETE_ORDER);
    assert.deepEqual(result.mutations[1][0].path.slice(0, 3), ["providers", "preview-chat", "models"]);
  });
}
