// 工单 #40：新建路由「自定义」模式下的接口地址格式 chip。
//
// 复用 new-route-harness 的真实 DOM 夹具：打开弹窗、切到自定义、点 chip，
// 读回 baseURL / 协议 / 提示与 mutate 次数。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildNewRouteHtml } from "./new-route-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
let cached = null;
let emptyCached = null;

function probe() {
  if (cached === null) {
    cached = runPageProbe(chrome, buildNewRouteHtml(bundle, { scenario: "custom-presets", scheme: "light" }));
  }
  return cached;
}

function emptyProbe() {
  if (emptyCached === null) {
    emptyCached = runPageProbe(
      chrome,
      buildNewRouteHtml(bundle, { scenario: "first-route", scheme: "light", emptyProviders: true }),
    );
  }
  return emptyCached;
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

test("自定义模式出现三个接口地址格式 chip，初始为空", async (t) => {
  if (chrome === null) return skip(t);
  const result = await probe();
  assert.equal(result.__error, undefined, result.__error);
  assert.equal(result.initial.hasInput, true);
  assert.deepEqual(result.initial.chips, ["OpenAI 兼容 …/v1", "Anthropic …/v1", "留空自己填"]);
  assert.equal(result.initial.baseURL, "");
  assert.equal(result.initial.protocol, "openai-completions");
  assert.equal(result.initial.note, false);
  assert.equal(result.initial.mutations, 0);
});

test("点 OpenAI 兼容 chip：填入以 /v1 结尾的形状，协议切成 openai-completions", async (t) => {
  if (chrome === null) return skip(t);
  const { openai } = await probe();
  assert.equal(openai.endsWithV1, true);
  // 只填形状，不编造具体域名：主机名是占位文案，用户自己替换。
  assert.equal(openai.baseURL, "https://你的中转站域名/v1");
  assert.equal(openai.protocol, "openai-completions");
  assert.equal(openai.note, false);
  assert.equal(openai.mutations, 0);
});

test("点 Anthropic chip：协议切成 anthropic-messages，地址仍是 /v1 形状", async (t) => {
  if (chrome === null) return skip(t);
  const { anthropic } = await probe();
  assert.equal(anthropic.endsWithV1, true);
  assert.equal(anthropic.protocol, "anthropic-messages");
  assert.equal(anthropic.mutations, 0);
});

test("手输过 baseURL 后再点 chip：保留用户输入并提示，不静默覆盖", async (t) => {
  if (chrome === null) return skip(t);
  const { manual, afterManual } = await probe();
  assert.equal(manual.baseURL, "https://my-relay.invalid/v1");
  assert.equal(manual.note, false);

  assert.equal(afterManual.preserved, true);
  assert.equal(afterManual.baseURL, "https://my-relay.invalid/v1");
  assert.equal(afterManual.note, true);
  // 没有静默改协议：手输后点 chip 什么都不写。
  assert.equal(afterManual.protocol, "anthropic-messages");
  assert.equal(afterManual.mutations, 0);
});

test("点「留空自己填」：清空地址与提示，不写配置", async (t) => {
  if (chrome === null) return skip(t);
  const { cleared } = await probe();
  assert.equal(cleared.baseURL, "");
  assert.equal(cleared.note, false);
  assert.equal(cleared.mutations, 0);
});

test("一条路由都没有时空状态给出可走通的路，并提到「基础对话」预设", async (t) => {
  if (chrome === null) return skip(t);
  const result = await emptyProbe();
  assert.equal(result.__error, undefined, result.__error);
  assert.equal(result.initial.emptyWarning, true);
  assert.equal(result.initial.emptyGuidance, true);
});
