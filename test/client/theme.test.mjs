// 工单 #20：深色主题回归。
//
// 在真实 Chrome 里用 light / dark 两套宿主 token 渲染打包后的 Workbench，
// 断言原生控件不再退回平台浅色：select 有实际 token 底色；文本对比度
// ≥ 4.5:1；comboPanel / pre / chip / 错误提示都引用 --dsw-*；换主题不改变布局。
//
// 与 layout.test.mjs 一样，Chrome 不可用时 skip，常规单测保持无浏览器依赖。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, openWorkbenchInTheme, runPageProbe } from "./layout-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const source = readFileSync(join(root, "src", "client", "index.jsx"), "utf8");
const chrome = findChrome();
const probes = new Map();

/** 每个主题只启动一次 Chrome；同一页面的四条断言复用结果。 */
async function probe(scheme) {
  if (!probes.has(scheme)) {
    const page = await openWorkbenchInTheme(scheme, { bundleSource: bundle });
    probes.set(scheme, runPageProbe(chrome, page.html));
  }
  return probes.get(scheme);
}

/** #rrggbb / #rrggbbaa → Chrome 计算值的 rgb() 形式（alpha 由合成负责）。 */
function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

function token(scheme, name) {
  return rgbOf(THEME_TOKENS[scheme][name]);
}

function assertSourceHasNoHardcodedColors() {
  assert.doesNotMatch(source, /background:\s*"Canvas"/, "comboPanel 不应使用 Canvas 系统色");
  assert.doesNotMatch(source, /color:\s*"#[0-9a-fA-F]{3,8}"/, "不应有硬编码文字颜色");
  const references = source.match(/var\(--dsw-[a-z0-9-]+/g) ?? [];
  const withFallback = source.match(/var\(--dsw-[a-z0-9-]+,\s*/g) ?? [];
  assert.ok(references.length >= 15, `应大量引用 DSH token，实际 ${references.length} 处`);
  assert.equal(withFallback.length, references.length, "每个 var(--dsw-*) 都必须带 fallback");
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：select / input / checkbox 跟随主题`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实主题测量");
    const result = await probe(scheme);

    assert.equal(result.scheme, scheme);
    assert.equal(result.select.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.notEqual(result.select.background, "rgba(0, 0, 0, 0)", "select 背景不能透明");
    assert.equal(result.input.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.notEqual(result.input.background, "rgba(0, 0, 0, 0)", "输入框背景不能透明");
    assert.equal(result.select.color, token(scheme, "--dsw-alias-label-primary"));
    assert.equal(result.input.color, token(scheme, "--dsw-alias-label-primary"));
    // color-scheme 从 documentElement 继承，原生 option / 复选框 / 滚动条才会跟随。
    assert.equal(result.select.colorScheme, scheme);
    assert.equal(result.checkbox.colorScheme, scheme);
  });

  test(`${scheme} 主题：文本对比度 ≥ 4.5`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实主题测量");
    const result = await probe(scheme);

    assert.ok(
      result.contrast.ratio >= 4.5,
      `对比度 ${result.contrast.ratio.toFixed(2)} 不达标：${result.contrast.where}`,
    );
    assert.equal(result.error.color, token(scheme, "--dsw-alias-state-error-primary"));
  });

  test(`${scheme} 主题：所有 primary 按钮文字对比度 ≥ 4.5`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实主题测量");
    const result = await probe(scheme);
    const expected = token(scheme, "--dsw-alias-label-primary-foreground");

    assert.equal(result.primary.main.length, 1, "主工作台「写入 DSH 设置」应使用 btnPrimary");
    assert.equal(result.primary.picker.length, 2, "选择器「确定（N）」与主按钮应同时使用 btnPrimary");
    assert.equal(result.primary.pending.length, 2, "待写入区块「写入」与主按钮应同时使用 btnPrimary");

    for (const stage of ["main", "picker", "pending"]) {
      for (const button of result.primary[stage]) {
        assert.equal(button.color, expected, `${stage} 的「${button.text}」应使用 label-primary-foreground`);
        assert.ok(
          button.ratio >= 4.5,
          `${stage} 的「${button.text}」对比度 ${button.ratio} 不达标（color ${button.color} / background ${button.background}）`,
        );
      }
    }
  });

  test(`${scheme} 主题：comboPanel / pre / chip 使用主题 token`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实主题测量");
    const result = await probe(scheme);

    assert.equal(result.panel.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.notEqual(result.panel.background, "rgb(255, 255, 255)", "深色下候选面板不应是白底");
    assert.equal(result.panel.color, token(scheme, "--dsw-alias-label-primary"));
    assert.equal(result.pre.background, token(scheme, "--dsw-alias-markdown-code-block"));
    assert.equal(result.chip.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assertSourceHasNoHardcodedColors();
  });

  test(`${scheme} 主题：布局尺寸与另一主题一致`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实主题测量");
    const result = await probe(scheme);

    assert.equal(result.rects.selectH, 29, "select 盒高应保持 29px");
    assert.equal(result.rects.selectTop, result.rects.modelTop, "路由与模型 ID 顶边应对齐");
    assert.equal(result.rects.selectTop, result.rects.displayTop, "路由与显示名顶边应对齐");
    if (scheme === "dark") {
      const light = await probe("light");
      assert.deepEqual(result.rects, light.rects, "换主题不应改变任何布局尺寸");
    }
  });
}
