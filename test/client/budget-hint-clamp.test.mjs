// 工单 #35：上下文预算提示在常见窗口下不显示负数、也不出现超过 100% 的损失。
//
// 基线在 8192 / 32768 窗口下会显示「可用上下文 -61,440（比最优少 1037.6%）」，
// 并且除 1M 以外的窗口都没有任何建议。这里在真实 DOM（headless Chrome）里
// 读回实际渲染文字。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildBudgetHintHtml } from "./bulk-count-and-hints-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildBudgetHintHtml(bundle, scheme)));
  return probes.get(scheme);
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

/** 文本里所有百分数；超过 100 说明「比最优少」的口径错了。 */
function percents(text) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
}

function assertReadable(text, label) {
  assert.doesNotMatch(text, /-\d/, `${label}：不应出现负号数字`);
  for (const percent of percents(text)) {
    assert.ok(percent <= 100, `${label}：损失不应超过 100%，实际 ${percent}%`);
  }
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：8192 窗口不显示负数，改用「缓冲装不下」的说明`, async (t) => {
    if (chrome === null) return skip(t);
    const { exhausted8k } = await probe(scheme);
    assert.ok(exhausted8k !== null, "预算提示应当渲染");
    assert.match(exhausted8k.text, /这个上下文窗口小于 64K 缓冲，任何输出都会立刻触发压缩。建议提高 contextWindow。/);
    assert.doesNotMatch(exhausted8k.text, /可用上下文/, "耗尽时不再显示「可用上下文」数字");
    assert.doesNotMatch(exhausted8k.text, /-61,440|1037\.6/);
    assertReadable(exhausted8k.text, "8192 窗口");
  });

  test(`${scheme} 主题：32768 窗口同样不出现负数与超过 100% 的损失`, async (t) => {
    if (chrome === null) return skip(t);
    const { exhausted32k } = await probe(scheme);
    assert.match(exhausted32k.text, /这个上下文窗口小于 64K 缓冲/);
    assert.doesNotMatch(exhausted32k.text, /-40,960|256\.3/);
    assertReadable(exhausted32k.text, "32768 窗口");
    assert.doesNotMatch(exhausted32k.body, /-(?:61,440|40,960)|\b1037\.6%|\b256\.3%/);
  });

  test(`${scheme} 主题：131K 窗口显示真实损失，并说明做不到零损失`, async (t) => {
    if (chrome === null) return skip(t);
    const { loss131k } = await probe(scheme);
    assert.match(loss131k.text, /可用上下文 32,768（比最优少 68\.7%）/);
    assert.match(loss131k.text, /即使不设输出上限也无法做到零损失；建议提高 contextWindow/);
    assert.doesNotMatch(loss131k.text, /建议 ≤/, "freeBoundary 为负时不能给出做不到的建议");
    assertReadable(loss131k.text, "131K 窗口");
  });

  test(`${scheme} 主题：1M / 32K 的零损失口径保持不变`, async (t) => {
    if (chrome === null) return skip(t);
    const { zeroLoss1m } = await probe(scheme);
    assert.match(zeroLoss1m.text, /可用上下文 800,000（零损失 ✓）/);
  });
}
