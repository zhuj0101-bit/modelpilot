// 工单 #40：新增模型表单顶部的三个内置预设 chip。
//
// 与 template-fill.test.mjs 相同：headless Chrome 渲染打包后的 lib/client.js，
// 做真实点击并读回表单值、aria-pressed 与 mutate 次数；Chrome 不可用时 skip。
// 存储为空，验证「首次打开就命中基础对话」以及改字段后高亮必须消失。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildPresetChipsHtml } from "./preset-chips-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildPresetChipsHtml(bundle, scheme)));
  return probes.get(scheme);
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

const BASIC_FORM = {
  contextWindow: "128000",
  maxTokens: "8192",
  text: true,
  image: false,
  levels: ["off", "low", "medium", "high"],
};

const CHIP_LABELS = ["基础对话", "代码", "长文档"];

/** 把 chip 状态压成 label → aria-pressed，断言时更直观。 */
function pressedOf(chips) {
  return Object.fromEntries(chips.map((chip) => [chip.label, chip.pressed]));
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：首次打开三个 chip 都在，基础对话高亮且表单已是 128000/8192`, async (t) => {
    if (chrome === null) return skip(t);
    const result = await probe(scheme);
    assert.equal(result.__error, undefined, result.__error);

    assert.deepEqual(result.initial.chips.map((chip) => chip.label), CHIP_LABELS);
    assert.deepEqual(pressedOf(result.initial.chips), {
      基础对话: "true",
      代码: "false",
      长文档: "false",
    });
    assert.deepEqual(result.initial.form, BASIC_FORM);
    assert.equal(result.initial.mutations, 0);
  });

  test(`${scheme} 主题：点「代码」→ 200000 / 16384，只有代码高亮`, async (t) => {
    if (chrome === null) return skip(t);
    const result = await probe(scheme);
    assert.deepEqual(result.coding.form, {
      contextWindow: "200000",
      maxTokens: "16384",
      text: true,
      image: false,
      levels: ["off", "low", "medium", "high"],
    });
    assert.deepEqual(pressedOf(result.coding.chips), {
      基础对话: "false",
      代码: "true",
      长文档: "false",
    });
    assert.equal(result.coding.mutations, 0);
  });

  test(`${scheme} 主题：点「长文档」→ 1000000，只有长文档高亮`, async (t) => {
    if (chrome === null) return skip(t);
    const result = await probe(scheme);
    assert.deepEqual(result.long.form, {
      contextWindow: "1000000",
      maxTokens: "8192",
      text: true,
      image: false,
      levels: ["off", "low", "medium", "high"],
    });
    assert.deepEqual(pressedOf(result.long.chips), {
      基础对话: "false",
      代码: "false",
      长文档: "true",
    });
    assert.equal(result.long.mutations, 0);
  });

  test(`${scheme} 主题：手改上下文为 999 后三个 chip 全部取消高亮`, async (t) => {
    if (chrome === null) return skip(t);
    const result = await probe(scheme);
    assert.equal(result.basicAgain.form.contextWindow, "128000");
    assert.equal(result.edited.form.contextWindow, "999");
    assert.deepEqual(pressedOf(result.edited.chips), {
      基础对话: "false",
      代码: "false",
      长文档: "false",
    });
    assert.equal(result.edited.mutations, 0);
  });

  test(`${scheme} 主题：再点「代码」恢复高亮；预设全程不写配置`, async (t) => {
    if (chrome === null) return skip(t);
    const result = await probe(scheme);
    assert.deepEqual(result.recovered.form, {
      contextWindow: "200000",
      maxTokens: "16384",
      text: true,
      image: false,
      levels: ["off", "low", "medium", "high"],
    });
    assert.deepEqual(pressedOf(result.recovered.chips), {
      基础对话: "false",
      代码: "true",
      长文档: "false",
    });
    assert.equal(result.recovered.mutations, 0);
    assert.equal(result.initial.mutations + result.coding.mutations + result.long.mutations, 0);
  });

  test(`${scheme} 主题：chip 的 title 写清具体数值`, async (t) => {
    if (chrome === null) return skip(t);
    const result = await probe(scheme);
    const [basic, coding, long] = result.initial.chips;
    assert.ok(basic.title.includes("上下文 128000"), basic.title);
    assert.ok(basic.title.includes("输出 8192"), basic.title);
    assert.ok(coding.title.includes("上下文 200000"), coding.title);
    assert.ok(coding.title.includes("输出 16384"), coding.title);
    assert.ok(long.title.includes("上下文 1000000"), long.title);
    assert.ok(long.title.includes("输出 8192"), long.title);
  });
}
