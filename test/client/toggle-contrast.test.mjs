// 工单 #41：选中态「多重冗余编码」的真实 DOM 回归测试。
//
// 用户在暗色主题下看不出批量条 / 推理档位 / 模态 / 视图开关是否勾选。根因是
// 选中与未选中只差一层很浅的填充。这里在 light / dark 两套宿主 token 下渲染
// 打包后的工作台，对 10 处控件同时断言四个通道：
//   1. 填充对比度 ≥ 3.0（WCAG 非文本门槛）；
//   2. 选中态边框比未选中更粗；
//   3. 选中态字重 ≥ 600、未选中 ≤ 400，且选中态文字前有 ✓；
//   4. 连续切换不改变 offsetWidth / offsetHeight。
// 另加一条三态断言：停用态必须区别于未选中与选中。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOGGLE_MIN_CONTRAST, contrastRatio } from "../../src/core/toggle-style.js";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildToggleContrastHtml } from "./toggle-contrast-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) {
    probes.set(scheme, runPageProbe(chrome, buildToggleContrastHtml(bundle, scheme)));
  }
  return probes.get(scheme);
}

const SCENES = Object.freeze([
  "bulk-modality",
  "bulk-levels",
  "preset-chips",
  "create-modality",
  "edit-modality",
  "route-default-input",
  "edit-levels",
  "create-levels",
  "view-toggle",
  "density-toggle",
]);

for (const scheme of ["light", "dark"]) {
  for (const where of SCENES) {
    test(`${scheme} 主题：${where} 的选中态填充对比度 ≥ 3.0`, async (t) => {
      if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
      const result = await probe(scheme);
      assert.equal(result.__error, undefined, result.__error);
      const scene = result.scenes[where];
      assert.ok(scene, `${where} 场景未采集`);
      const ratio = contrastRatio(scene.selected.fill, scene.unselected.fill);
      assert.notEqual(ratio, null, "填充色必须可解析");
      assert.ok(
        ratio >= TOGGLE_MIN_CONTRAST,
        `${where} 选中/未选中填充对比度 ${ratio?.toFixed(2)}（选中 ${JSON.stringify(scene.selected.fill)}，未选中 ${JSON.stringify(scene.unselected.fill)}）低于 ${TOGGLE_MIN_CONTRAST}`,
      );
    });
  }

  test(`${scheme} 主题：10 处选中态的边框更粗、字重更高且带勾选标记`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.__error, undefined, result.__error);
    for (const where of SCENES) {
      const { selected, unselected } = result.scenes[where];
      assert.ok(
        selected.borderWidth > unselected.borderWidth,
        `${where} 选中边框 ${selected.borderWidth}px 必须大于未选中 ${unselected.borderWidth}px`,
      );
      assert.ok(selected.fontWeight >= 600, `${where} 选中字重 ${selected.fontWeight} 应 ≥ 600`);
      assert.ok(unselected.fontWeight <= 400, `${where} 未选中字重 ${unselected.fontWeight} 应 ≤ 400`);
      assert.equal(selected.mark, true, `${where} 选中态文字前应有 ✓`);
      assert.equal(unselected.mark, false, `${where} 未选中态不应出现 ✓`);
    }
  });

  test(`${scheme} 主题：连续切换同一 chip / 分段按钮，宽高不变`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.__error, undefined, result.__error);
    for (const key of ["before", "selected", "after"]) {
      assert.deepEqual(
        { width: result.routeChipJitter[key].width, height: result.routeChipJitter[key].height },
        { width: result.routeChipJitter.before.width, height: result.routeChipJitter.before.height },
        `路由 chip 在 ${key} 状态发生布局抖动`,
      );
    }
    for (const key of ["off", "on", "offAgain"]) {
      assert.deepEqual(
        { width: result.segmentedJitter[key].width, height: result.segmentedJitter[key].height },
        { width: result.segmentedJitter.off.width, height: result.segmentedJitter.off.height },
        `分段按钮在 ${key} 状态发生布局抖动`,
      );
    }
  });

  test(`${scheme} 主题：停用态与未选中 / 选中态可区分（虚线边框 + 半透明）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.__error, undefined, result.__error);
    const { unselected, selected } = result.scenes["bulk-modality"];
    for (const [name, disabled] of Object.entries(result.bulkDisabled)) {
      assert.equal(disabled.borderStyle, "dashed", `${name} 停用态应使用虚线边框`);
      assert.equal(disabled.opacity, 0.5, `${name} 停用态透明度应为 0.5`);
      assert.equal(disabled.cursor, "not-allowed", `${name} 停用态应显示不可用光标`);
      assert.ok(
        disabled.borderStyle !== unselected.borderStyle || disabled.opacity !== unselected.opacity,
        `${name} 停用态必须与未选中态可区分`,
      );
      assert.ok(
        disabled.borderStyle !== selected.borderStyle || disabled.opacity !== selected.opacity,
        `${name} 停用态必须与选中态可区分`,
      );
    }
  });
}
