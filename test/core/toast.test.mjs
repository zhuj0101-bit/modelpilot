// 工单 #35：操作结果提示（toast）的纯规则测试。
//
// 真实 DOM 下的「6 秒后消失 / 报错不消失 / 焦点暂停 / 淡出 / 卸载清 timer」
// 见 test/client/toast-live-region.test.mjs；这里只钉规则表本身。

import test from "node:test";
import assert from "node:assert/strict";
import {
  TOAST_FADE_MS,
  TOAST_SUCCESS_DISMISS_MS,
  nextToastOnDismiss,
  restoreToastOnFocus,
  toastAria,
  toastDismissDelay,
} from "../../src/core/toast.js";

test("成功提示驻留 6 秒，淡出 300 毫秒", () => {
  assert.equal(TOAST_SUCCESS_DISMISS_MS, 6000);
  assert.equal(TOAST_FADE_MS, 300);
});

test("读屏语义：普通结果 status / polite，报错 alert / assertive", () => {
  assert.deepEqual(toastAria("good"), { role: "status", live: "polite" });
  assert.deepEqual(toastAria(undefined), { role: "status", live: "polite" });
  assert.deepEqual(toastAria("bad"), { role: "alert", live: "assertive" });
});

test("只有成功提示会自动消失，报错留在页面上", () => {
  const good = { tone: "good", text: "已保存" };
  const bad = { tone: "bad", text: "保存失败" };
  assert.equal(toastDismissDelay(good, false), 6000);
  assert.equal(toastDismissDelay(bad, false), null);
  assert.equal(toastDismissDelay(null, false), null);
});

test("焦点在提示区域内时暂停计时；淡出阶段按下时也不推进", () => {
  assert.equal(toastDismissDelay({ tone: "good" }, true), null);
  assert.equal(toastDismissDelay({ tone: "good", hiding: true }, true), null);
  assert.equal(toastDismissDelay({ tone: "good", hiding: true }, false), TOAST_FADE_MS);
});

test("定时器触发：先进入淡出，再移除；非成功提示原样返回", () => {
  const good = { tone: "good", text: "已保存" };
  const hiding = nextToastOnDismiss(good);
  assert.notEqual(hiding, good, "返回新对象，触发重渲染");
  assert.equal(hiding.hiding, true);
  assert.equal(hiding.text, "已保存", "淡出期间文字还在，读屏不会漏读");
  assert.equal(nextToastOnDismiss(hiding), null);

  const bad = { tone: "bad", text: "保存失败" };
  assert.equal(nextToastOnDismiss(bad), bad, "报错不动");
  assert.equal(nextToastOnDismiss(null), null);
});

test("焦点进入：取消淡出，恢复不透明", () => {
  const hiding = { tone: "good", text: "已保存", hiding: true };
  const restored = restoreToastOnFocus(hiding);
  assert.notEqual(restored, hiding);
  assert.equal(restored.hiding, false);
  const visible = { tone: "good", text: "已保存" };
  assert.equal(restoreToastOnFocus(visible), visible, "本来就是不透明就不重渲染");
  assert.equal(restoreToastOnFocus(null), null);
});
