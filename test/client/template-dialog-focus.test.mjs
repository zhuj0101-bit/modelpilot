// 工单 #43 缺陷 3：两个新弹窗声明了 aria-modal="true"，就必须真的管理焦点。
//
// 与既有浏览器测试同一路径：headless Chrome 渲染打包后的 lib/client.js，做真实
// 点击与 keydown，读回 document.activeElement 与 maxlength 属性。Chrome 不可用
// 时 skip。
//
// 覆盖：打开聚焦第一个可聚焦元素、Tab / Shift+Tab 圈定、关闭把焦点还给触发按钮、
// 行内改名输入接住焦点，以及两个名称输入框的 maxLength。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { TEMPLATE_FOCUS_SEED, buildTemplateFocusHtml } from "./template-dialog-focus-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
let cached = null;

function probe() {
  if (cached === null) cached = runPageProbe(chrome, buildTemplateFocusHtml(bundle, TEMPLATE_FOCUS_SEED));
  return cached;
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

test("存为新模板：打开后焦点在名称输入框，且输入框有 maxLength=20", async (t) => {
  if (chrome === null) return skip(t);
  const { saveDialog } = await probe();
  assert.equal(saveDialog.open, true);
  assert.equal(saveDialog.active, "模板名称");
  assert.equal(saveDialog.maxLength, "20");
  assert.deepEqual(saveDialog.focusables, ["模板名称", "取消保存模板", "保存模板"]);
});

test("存为新模板：Tab / Shift+Tab 圈定在对话框内，不跑到背后的表单", async (t) => {
  if (chrome === null) return skip(t);
  const { saveDialog } = await probe();
  // 最后一个 → Tab → 回到第一个（并且阻止了默认 Tab 行为）。
  assert.equal(saveDialog.tabFromLast.prevented, true);
  assert.equal(saveDialog.tabFromLast.active, "模板名称");
  assert.equal(saveDialog.tabFromLast.inside, true);
  // 第一个 → Shift+Tab → 最后一个。
  assert.equal(saveDialog.shiftTabFromFirst.prevented, true);
  assert.equal(saveDialog.shiftTabFromFirst.active, "保存模板");
  assert.equal(saveDialog.shiftTabFromFirst.inside, true);
  // 连按一圈：焦点始终在对话框内，从未落到背后表单。
  assert.equal(saveDialog.tabWalk.escaped, null, "Tab 不能把焦点带到对话框外");
  const expected = ["模板名称", "取消保存模板", "保存模板"];
  for (const label of saveDialog.tabWalk.visited) {
    assert.ok(expected.includes(label), `焦点落在对话框内：${label}`);
  }
  assert.ok(saveDialog.tabWalk.visited.length >= 6, "至少转了两圈");
  // 焦点意外在背后表单上时，下一次 Tab 被拉回对话框。
  assert.equal(saveDialog.tabFromOutside.prevented, true);
  assert.equal(saveDialog.tabFromOutside.inside, true);
});

test("存为新模板：关闭后焦点回到「存为新模板」按钮", async (t) => {
  if (chrome === null) return skip(t);
  const { saveDialog } = await probe();
  assert.equal(saveDialog.afterCancel.open, false);
  assert.equal(saveDialog.afterCancel.active, "存为新模板");
});

test("模板管理：打开后焦点在第一行的「改名」按钮，行内改名输入接住焦点且有 maxLength=20", async (t) => {
  if (chrome === null) return skip(t);
  const { manage } = await probe();
  assert.equal(manage.open, true);
  assert.equal(manage.active, "改名 我的 128K");
  assert.equal(manage.rename.active, "重命名模板输入");
  assert.equal(manage.rename.maxLength, "20");
});

test("模板管理：关闭后焦点回到「管理」按钮", async (t) => {
  if (chrome === null) return skip(t);
  const { manage } = await probe();
  assert.equal(manage.afterClose.open, false);
  assert.equal(manage.afterClose.active, "管理模板");
});
