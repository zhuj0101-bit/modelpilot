// 工单 #41：选中态对比度工具的单测。
//
// 这些数字来自工单里的实测：暗色主题下 #232324（未选中底）与 #43454a
//（旧的选中底）只有 1.64，远低于 WCAG 非文本门槛 3.0。先用基准值把公式
// 钉住，浏览器侧的 computed style 断言才有同一个参照。

import test from "node:test";
import assert from "node:assert/strict";
import {
  TOGGLE_MIN_CONTRAST,
  composite,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from "../../src/core/toggle-style.js";

const closeTo = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} 与 ${expected} 相差超过 ${epsilon}`);

test("TOGGLE_MIN_CONTRAST 是 WCAG 非文本门槛 3.0", () => {
  assert.equal(TOGGLE_MIN_CONTRAST, 3.0);
});

test("contrastRatio：黑白基准值恰好是 21，且与参数顺序无关", () => {
  closeTo(contrastRatio("#000000", "#ffffff"), 21);
  closeTo(contrastRatio("#ffffff", "#000000"), 21);
  closeTo(contrastRatio("#ffffff", "#ffffff"), 1);
});

test("contrastRatio：复现本工单的缺陷数据 1.64", () => {
  const ratio = contrastRatio("#232324", "#43454a");
  assert.ok(ratio >= 1.6 && ratio <= 1.7, `暗色主题旧选中底对比度 ${ratio}`);
});

test("relativeLuminance：黑 0 / 白 1 / 中间值单调", () => {
  closeTo(relativeLuminance("#000000"), 0);
  closeTo(relativeLuminance("#ffffff"), 1);
  const dark = relativeLuminance("#232324");
  const mid = relativeLuminance("#81858c");
  const light = relativeLuminance("#f9fafb");
  assert.ok(dark < mid && mid < light, `亮度应单调：${dark} < ${mid} < ${light}`);
});

test("parseColor：兼容 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba()", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#232324"), { r: 35, g: 35, b: 36, a: 1 });
  const shortAlpha = parseColor("#ffffff1f");
  assert.equal(shortAlpha.r, 255);
  assert.equal(shortAlpha.g, 255);
  assert.equal(shortAlpha.b, 255);
  closeTo(shortAlpha.a, 31 / 255);
  assert.deepEqual(parseColor("rgb(90, 140, 230)"), { r: 90, g: 140, b: 230, a: 1 });
  assert.deepEqual(parseColor("rgba(90,140,230,0.22)"), { r: 90, g: 140, b: 230, a: 0.22 });
  assert.deepEqual(parseColor("rgb(90 140 230 / 22%)"), { r: 90, g: 140, b: 230, a: 0.22 });
  assert.deepEqual(parseColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
});

test("parseColor：非法值返回 null，不静默算成黑色", () => {
  for (const value of ["", "not-a-color", "#12", "#12345", "rgb(1,2)", "rgb(a,b,c)", null, undefined, 42, {}]) {
    assert.equal(parseColor(value), null, `应无法解析：${String(value)}`);
  }
});

test("composite：半透明前景叠到不透明底上得到不透明结果", () => {
  const mixed = composite("rgba(90, 140, 230, 0.22)", "#151517");
  assert.equal(mixed.a, 1);
  closeTo(mixed.r, 0.22 * 90 + 0.78 * 21, 1e-6);
  closeTo(mixed.g, 0.22 * 140 + 0.78 * 21, 1e-6);
  closeTo(mixed.b, 0.22 * 230 + 0.78 * 23, 1e-6);
  // 不透明前景完全覆盖背景。
  assert.deepEqual(composite("#4176e6", "#ffffff"), { r: 65, g: 118, b: 230, a: 1 });
  // 透明前景不改变背景。
  assert.deepEqual(composite("transparent", "#232324"), { r: 35, g: 35, b: 36, a: 1 });
});

test("composite 结果可直接参与对比度计算", () => {
  const selected = composite("rgba(90, 140, 230, 0.75)", "#151517");
  assert.ok(contrastRatio(selected, "#232324") > 1, "叠色后的对比度应是有限数值");
  assert.equal(composite("bogus", "#ffffff"), null);
});
