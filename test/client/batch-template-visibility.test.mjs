// 工单 #43 缺陷 1：批量写入用的模板必须对用户可见（真实 DOM / headless Chrome）。
//
// 与既有浏览器测试同一路径：渲染打包后的 lib/client.js，点「拉取」→ 选择器
// 自动打开，读回勾选区上方的模板摘要；勾 2 个 → 确定 → 写入，核对真正写进去的
// contextWindow 与摘要里的数字一致。Chrome 不可用时 skip。
//
// 三个页面：空库（隐式回落内置「基础对话」）、选中内置「长文档」、选中用户模板。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { BATCH_USER_LIBRARY, buildBatchTemplateHtml } from "./batch-template-visibility-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

const SEEDS = {
  empty: null,
  builtinLong: { builtin: "long" },
  userTemplate: { library: BATCH_USER_LIBRARY, selection: "user:tpl-user-128k", userTemplate: "tpl-user-128k" },
};

function probe(scenario) {
  if (!probes.has(scenario)) {
    probes.set(scenario, runPageProbe(chrome, buildBatchTemplateHtml(bundle, SEEDS[scenario])));
  }
  return probes.get(scenario);
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

test("空库：勾选区上方写明按内置「基础对话」的参数写入，不再说「内置默认值」", async (t) => {
  if (chrome === null) return skip(t);
  const { hint, hintNumber } = await probe("empty");
  assert.equal(
    hint.text,
    "将以内置「基础对话」的参数写入：上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high（内置预设）",
  );
  assert.ok(!hint.text.includes("内置默认值"), "旧文案「将使用内置默认值」必须消失");
  assert.match(hint.text, /内置预设/);
  assert.equal(hint.beforeSelectAll, true, "摘要要在勾选区上方（全选那一行之前）");
  assert.equal(hintNumber, 128000);
});

test("选中内置「长文档」：摘要写明 1M 上下文，并标注「内置预设」", async (t) => {
  if (chrome === null) return skip(t);
  const { hint, hintNumber } = await probe("builtinLong");
  assert.equal(
    hint.text,
    "将以「长文档」的参数写入：上下文 1000000（1M） · 输出 8192（8K） · text · off,low,medium,high（内置预设）",
  );
  assert.ok(!hint.text.includes("内置默认值"));
  assert.equal(hintNumber, 1000000);
});

test("选中用户模板：摘要用模板名，不标注「内置预设」", async (t) => {
  if (chrome === null) return skip(t);
  const { hint, hintNumber } = await probe("userTemplate");
  assert.equal(
    hint.text,
    "将以「我的 128K」的参数写入：上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high",
  );
  assert.ok(!hint.text.includes("内置预设"));
  assert.equal(hintNumber, 128000);
});

test("写完的模型行与提示一致：内置「长文档」→ 两条都写 1000000 / 8192", async (t) => {
  if (chrome === null) return skip(t);
  const { hintNumber, pending, written, toast } = await probe("builtinLong");
  assert.equal(pending.hasWriteButton, true);
  assert.match(pending.previewText, /窗口 1000000/, "待写入区块展示模板里的实际值");
  assert.deepEqual(written.map((row) => row.id), ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro"]);
  for (const row of written) {
    assert.equal(row.contextWindow, hintNumber, "写入的上下文与摘要里的数字一致");
    assert.equal(row.maxTokens, 8192);
  }
  assert.equal(toast, "已写入 preview-chat / 2 个模型");
});

test("空库批量写入：模型行与摘要一致（128000 / 8192），不再是不写 token 字段", async (t) => {
  if (chrome === null) return skip(t);
  const { hintNumber, written } = await probe("empty");
  assert.equal(hintNumber, 128000);
  for (const row of written) {
    assert.equal(row.contextWindow, 128000);
    assert.equal(row.maxTokens, 8192);
  }
});
