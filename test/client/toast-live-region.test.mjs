// 工单 #35：操作结果提示的读屏可达性与自动消失（真实 DOM / headless Chrome）。
//
// 基线没有 role / aria-live（读屏收不到任何反馈），也没有 setTimeout（提示
// 永久留在页面上）。这里用 60 秒虚拟时间预算把 6 秒驻留 + 300 毫秒淡出跑完，
// 逐条读回真实属性、内联样式与文字。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildToastLiveRegionHtml } from "./bulk-count-and-hints-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();
const BUDGET_MS = 60000;

function probe(scheme) {
  if (!probes.has(scheme)) {
    probes.set(scheme, runPageProbe(chrome, buildToastLiveRegionHtml(bundle, scheme), BUDGET_MS));
  }
  return probes.get(scheme);
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
const GOOD_TEXT = "已保存为默认模板";
const BAD_TEXT = "保存失败：模板至少需要一个输入模态（text 或 image）";

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：提示容器常驻且带 status / polite 语义`, async (t) => {
    if (chrome === null) return skip(t);
    const { initial } = await probe(scheme);
    assert.ok(initial !== null && initial.inDom, "空闲时容器仍在 DOM 里，读屏才能感知后续变化");
    assert.equal(initial.role, "status");
    assert.equal(initial.live, "polite");
    assert.equal(initial.atomic, "true");
    assert.equal(initial.text, "");
    assert.equal(initial.tabIndex, -1, "空闲时不可 Tab 聚焦");
  });

  test(`${scheme} 主题：成功提示 6 秒后淡出并移除，不是 display:none 直接抽掉`, async (t) => {
    if (chrome === null) return skip(t);
    const { good, fading, gone } = await probe(scheme);
    assert.equal(good.text, GOOD_TEXT);
    assert.equal(good.tone, "good");
    assert.equal(good.role, "status");
    assert.equal(good.live, "polite");
    assert.equal(good.display === "none", false, "出现时可见");
    assert.match(good.transition, /opacity/, "淡出用 CSS transition");
    assert.equal(good.inlineOpacity, "1");

    assert.equal(fading.text, GOOD_TEXT, "淡出期间文字还在，读屏不会漏读");
    assert.equal(fading.display === "none", false, "淡出不是 display:none");
    assert.match(fading.transition, /opacity/);
    assert.equal(fading.inlineOpacity, "0");

    assert.equal(gone.text, "", "淡出结束后才清空文字");
    assert.equal(gone.tone, "");
    assert.equal(gone.tabIndex, -1);
    assert.ok(gone.inDom, "容器常驻，不随提示一起移除");
  });

  test(`${scheme} 主题：连续两次操作时第一条提示已被自动清掉`, async (t) => {
    if (chrome === null) return skip(t);
    const { gone, secondOperation } = await probe(scheme);
    assert.equal(gone.text, "", "第二次操作前，第一条提示已经不在页面上");
    assert.equal(secondOperation.text, GOOD_TEXT, "第二次只显示自己的文案，不叠加旧提示");
    assert.equal(secondOperation.tone, "good");
  });

  test(`${scheme} 主题：焦点在提示区域内时暂停计时，离开后继续消失`, async (t) => {
    if (chrome === null) return skip(t);
    const { focused, afterBlur, afterBlurGone } = await probe(scheme);
    assert.equal(focused.text, GOOD_TEXT, "焦点在内时超过 6 秒仍然可读");
    assert.equal(focused.inlineOpacity, "1");
    assert.equal(afterBlur.text, GOOD_TEXT, "失焦后重新计时；淡出阶段文字还在");
    assert.equal(afterBlur.inlineOpacity, "0");
    assert.equal(afterBlurGone.text, "", "失焦 6 秒 + 淡出后移除");
    assert.equal(afterBlurGone.tone, "");
  });

  test(`${scheme} 主题：报错提示用 alert / assertive，且不自动消失`, async (t) => {
    if (chrome === null) return skip(t);
    const { bad, badPersisted } = await probe(scheme);
    assert.equal(bad.text, BAD_TEXT);
    assert.equal(bad.tone, "bad");
    assert.equal(bad.role, "alert");
    assert.equal(bad.live, "assertive");
    assert.equal(badPersisted.text, BAD_TEXT, "7 秒后报错仍在页面上");
    assert.equal(badPersisted.role, "alert");
  });

  test(`${scheme} 主题：卸载时清掉定时器，没有卸载后 setState 警告`, async (t) => {
    if (chrome === null) return skip(t);
    const { unmount } = await probe(scheme);
    assert.notEqual(unmount.pendingTimer, null, "成功提示确实注册了 6 秒定时器");
    assert.equal(unmount.clearedOnUnmount, true, "卸载时清掉该定时器");
    assert.deepEqual(unmount.consoleErrors, [], "没有 console.error / 卸载后 setState 警告");
    assert.equal(unmount.rootChildren, 0);
    assert.equal(unmount.toastGone, true);
  });
}
