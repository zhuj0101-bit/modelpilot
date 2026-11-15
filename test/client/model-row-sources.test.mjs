// 工单 #27：模型行摘要的来源标注、悬停解释与窄容器单行省略的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，读回摘要文案、
// title 属性与计算样式。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildModelRowSourcesHtml } from "./model-row-sources-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme, narrow) {
  const key = `${scheme}:${narrow ? "narrow" : "wide"}`;
  if (!probes.has(key)) {
    probes.set(key, runPageProbe(chrome, buildModelRowSourcesHtml(bundle, scheme, { narrow })));
  }
  return probes.get(key);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：模型行摘要标出每个值的来源`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, false);
    // 全部自己声明：没有任何标记。
    assert.equal(result.rows.declared.text, "窗口 131K · 输出 33K · text · 4 档");
    // 全部回落到路由默认值：窗口 / 输出 / 模态各一个 ↑，推理档位没有这一级。
    assert.equal(result.rows.routeDefaults.text, "窗口 1M↑ · 输出 128K↑ · text / image↑ · 无档");
    // input: [] 是明确选择：显示未设置，但不标 ↑。
    assert.equal(result.rows.emptyInput.text, "窗口 262K · 输出 8K · 未设置 · 非推理");
    assert.equal(result.rows.emptyInput.text.includes("↑"), false);
  });

  test(`${scheme} 主题：悬停 title 逐字段说明来源，声明字段不提路由默认值`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, false);
    assert.equal(
      result.rows.routeDefaults.title,
      [
        "窗口：模型未声明 → 使用路由默认值 1M",
        "输出：模型未声明 → 使用路由默认值 128K",
        "模态：模型未声明 → 使用路由默认值 text / image",
        "推理档位：模型未声明（没有路由级默认值）",
      ].join("\n"),
    );
    assert.equal(
      result.rows.declared.title,
      [
        "窗口：模型声明 131K",
        "输出：模型声明 33K",
        "模态：模型声明 text",
        "推理档位：模型声明 4 档",
      ].join("\n"),
    );
    assert.equal(result.rows.declared.title.includes("使用路由默认值"), false);
    assert.equal(result.rows.emptyInput.title.split("\n").length, 4);
    assert.match(result.rows.emptyInput.title, /模态：模型声明空数组（一个模态都不开）/);
  });

  test(`${scheme} 主题：窄容器下摘要单行省略，不撑破模型卡片`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, true);
    for (const key of ["declared", "routeDefaults", "emptyInput"]) {
      const row = result.rows[key];
      assert.equal(row.whiteSpace, "nowrap");
      assert.equal(row.textOverflow, "ellipsis");
      assert.equal(row.overflow, "hidden");
      // 行高 = 一行文字；换行会把这个高度撑成两倍以上。
      assert.ok(row.summaryHeight < row.lineHeight * 1.5, `${key} 摘要换行了：${row.summaryHeight}px`);
      assert.ok(row.rowRight <= row.panelRight + 0.5, `${key} 行超出卡片：${row.rowRight} > ${row.panelRight}`);
      assert.ok(row.panelWidth <= 320, `${key} 卡片被撑宽：${row.panelWidth}px`);
    }
    // 最长的摘要确实溢出并被省略（不是半截文字消失）。
    const longest = result.rows.routeDefaults;
    assert.ok(longest.scrollWidth > longest.clientWidth, "长摘要没有触发省略");
    assert.ok(result.documentWidth <= result.viewportWidth, "页面出现横向滚动");
  });
}
