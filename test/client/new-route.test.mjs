// 工单 #21：从目录新增路由的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下用 headless Chrome 渲染打包后的 lib/client.js，
// 做真实点击、等待 listConfigurableProviders 返回、读回 mutate 参数、路由选择、
// 路由卡片字段与密钥状态。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildNewRouteHtml } from "./new-route-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scenario, options = {}) {
  const key = `${scenario}:${options.scheme ?? "light"}:${options.emptyProviders === true}:${options.holdCatalog === true}`;
  if (!probes.has(key)) {
    probes.set(key, runPageProbe(chrome, buildNewRouteHtml(bundle, { scenario, ...options })));
  }
  return probes.get(key);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

test("路由选择器旁出现「+ 新建路由」；打开弹窗先显示目录读取中", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("catalog", { holdCatalog: true });
  assert.equal(result.__error, undefined, result.__error);
  assert.equal(result.initial.createButton, "+ 新建路由");
  assert.equal(result.initial.route, "preview-chat");
  assert.equal(result.loading.text, true);
  assert.ok(result.dialog.open, "弹窗已打开");
  assert.ok(result.loading.dialogText.includes("正在读取宿主目录…"), result.loading.dialogText);
});

test("目录列表：只列 llm-pi-ai 的可声明提供商，已配置项禁用并标注「已配置」", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("catalog", { holdCatalog: true });
  assert.deepEqual(result.rows.map((row) => row.provider), ["anthropic", "minimax-cn", "openai", "preview-chat"]);
  const configured = result.rows.find((row) => row.provider === "preview-chat");
  assert.equal(configured.disabled, true);
  assert.ok(configured.text.includes("已配置"), configured.text);
  const available = result.rows.find((row) => row.provider === "anthropic");
  assert.equal(available.disabled, false);
  assert.ok(available.text.includes("未配置"), available.text);
  assert.ok(!result.rows.some((row) => row.provider === "deepseek"), "别的命名空间不列出");
});

test("目录搜索框按 provider id 过滤，清空后恢复全部", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("catalog", { holdCatalog: true });
  assert.deepEqual(result.filtered, ["minimax-cn"]);
  assert.deepEqual(result.unfiltered, ["anthropic", "minimax-cn", "openai", "preview-chat"]);
});

test("从目录选择（目录里有）：产出恰好 1 条 set、value 不含 models，创建后切到新路由", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("catalog", { holdCatalog: true });
  assert.equal(result.selected.createDisabled, false);
  assert.equal(result.selected.checked, true);
  assert.equal(result.after.mutations, 1);
  assert.deepEqual(result.after.op, [
    { op: "set", path: ["providers", "minimax-cn"], value: {} },
  ]);
  assert.equal(result.after.dialogOpen, false);
  assert.equal(result.after.route, "minimax-cn");
  assert.deepEqual(result.after.routes, ["preview-chat", "minimax-cn"]);
  assert.equal(result.after.cardOpen, true, "创建后路由卡片自动展开");
  assert.deepEqual(result.after.provider, {});
  assert.equal(result.after.credentialCalls, 0);
  assert.equal(result.after.toast, true);
});

test("创建完成后再打开：刚建的路由变为已配置且不可选；取消关闭弹窗", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("catalog", { holdCatalog: true });
  const minimax = result.reopened.find((row) => row.provider === "minimax-cn");
  assert.equal(minimax.disabled, true);
  assert.ok(minimax.text.includes("已配置"), minimax.text);
  assert.equal(result.closedByCancel, true);
});

test("一条路由都没有时仍可新建：按钮可用，创建后警告消失并选中新路由", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("first-route", { emptyProviders: true });
  assert.equal(result.initial.emptyWarning, true);
  assert.deepEqual(result.initial.routes, []);
  assert.equal(result.pick.createDisabled, false);
  assert.equal(result.after.mutations, 1);
  assert.deepEqual(result.after.op, [
    { op: "set", path: ["providers", "anthropic"], value: {} },
  ]);
  assert.equal(result.after.route, "anthropic");
  assert.deepEqual(result.after.routes, ["anthropic"]);
  assert.equal(result.after.emptyWarning, false);
  assert.equal(result.after.cardOpen, true);
  assert.equal(result.after.dialogOpen, false);
});

test("自定义：四个输入 + 模型输入，默认协议来自内置清单", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.equal(result.fields.provider, "");
  assert.equal(result.fields.baseURL, "");
  assert.equal(result.fields.keyRef, "");
  assert.equal(result.fields.modelsVisible, true);
  assert.equal(result.fields.protocol, "openai-completions");
  assert.ok(result.fields.protocolOptions.includes("openai-completions"));
  assert.ok(result.fields.protocolOptions.includes("anthropic-messages"));
});

test("自定义：接口地址留空时就地报错、创建禁用且不产出 op", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.ok(result.emptyBaseURL.error.includes("http:// 或 https:// 开头"), result.emptyBaseURL.error);
  assert.equal(result.emptyBaseURL.createDisabled, true);
  assert.equal(result.emptyBaseURL.mutations, 0);
});

test("自定义：provider id 不符合 [a-z0-9][a-z0-9-]* 时就地报错、创建禁用且不产出 op", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.ok(result.invalidId.error.includes("只允许 a-z、0-9、连字符"), result.invalidId.error);
  assert.equal(result.invalidId.createDisabled, true);
  assert.equal(result.invalidId.mutations, 0);
});

test("自定义：与已有路由重名时禁用创建并提示「该路由已存在」", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.ok(result.duplicate.error.includes("该路由已存在"), result.duplicate.error);
  assert.equal(result.duplicate.createDisabled, true);
  assert.equal(result.duplicate.modelsVisible, false, "目录里有该提供商时收起模型输入");
  assert.equal(result.duplicate.mutations, 0);
});

test("自定义：接口地址为空 / 非 http(s):// 时就地报错、创建禁用", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.ok(result.badBaseURL.error.includes("http:// 或 https:// 开头"), result.badBaseURL.error);
  assert.equal(result.badBaseURL.createDisabled, true);
  assert.equal(result.badBaseURL.mutations, 0);
});

test("自定义（目录外）没有模型：创建禁用并提示「自定义路由至少需要一条模型」", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.ok(result.missingModels.error.includes("自定义路由至少需要一条模型"), result.missingModels.error);
  assert.equal(result.missingModels.createDisabled, true);
  assert.equal(result.missingModels.mutations, 0);
});

test("自定义（目录外）：补模型后产出 1 条 set，value 含 models ≥ 1 且只有 apiKeyEnv 引用", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.equal(result.ready.createDisabled, false);
  assert.equal(result.ready.modelsVisible, true);
  assert.equal(result.ready.hint, true);
  assert.equal(result.after.mutations, 1);
  assert.deepEqual(result.after.op, [
    {
      op: "set",
      path: ["providers", "my-relay"],
      value: {
        api: "openai-completions",
        baseURL: "https://relay.invalid/v1",
        apiKeyEnv: "MY_RELAY_API_KEY",
        models: [{ id: "relay/alpha" }, { id: "relay/beta" }],
      },
    },
  ]);
  assert.equal(JSON.stringify(result.after.op).includes("sk-"), false);
  assert.equal(result.after.provider.models.length, 2, "重复模型 id 已合并");
  assert.equal(result.after.provider.models[0].id, "relay/alpha");
});

test("自定义创建成功后：切换新路由、展开卡片、立即查询密钥状态", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom");
  assert.equal(result.after.dialogOpen, false);
  assert.equal(result.after.route, "my-relay");
  assert.equal(result.after.cardOpen, true);
  assert.deepEqual(result.after.fields, {
    baseURL: "https://relay.invalid/v1",
    api: "openai-completions",
    apiKeyEnv: "MY_RELAY_API_KEY",
  });
  assert.deepEqual(result.after.credentialCalls, [["MY_RELAY_API_KEY"]]);
  assert.ok(result.after.credentialStatus.includes("已配置"), result.after.credentialStatus);
  assert.equal(result.after.toast, true);
});

test("自定义 + 目录里有：不写 models，只写 baseURL / api / apiKeyEnv", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("custom-known");
  assert.equal(result.known.modelsVisible, false);
  assert.equal(result.known.hint, true);
  assert.ok(result.known.providerHint.includes("目录已描述"), result.known.providerHint);
  assert.equal(result.known.createDisabled, false);
  assert.equal(result.after.mutations, 1);
  assert.deepEqual(result.after.op, [
    {
      op: "set",
      path: ["providers", "anthropic"],
      value: { api: "openai-completions", baseURL: "https://proxy.invalid/anthropic" },
    },
  ]);
  assert.equal(result.after.route, "anthropic");
  assert.equal(result.after.cardOpen, true);
  assert.deepEqual(result.after.fields, {
    baseURL: "https://proxy.invalid/anthropic",
    api: "openai-completions",
    apiKeyEnv: "",
  });
});

test("创建失败时保留弹窗内容并显示错误；重试成功后才切换路由", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("failure");
  assert.equal(result.failed.mutations, 1);
  assert.equal(result.failed.dialogOpen, true);
  assert.equal(result.failed.error, true);
  assert.equal(result.failed.provider, "my-relay");
  assert.equal(result.failed.baseURL, "https://relay.invalid/v1");
  assert.equal(result.failed.models, "relay/one");
  assert.equal(result.failed.routeStillAbsent, true);
  assert.equal(result.recovered.mutations, 2);
  assert.equal(result.recovered.dialogOpen, false);
  assert.equal(result.recovered.route, "my-relay");
  assert.equal(result.recovered.cardOpen, true);
  assert.equal(result.recovered.provider.models.length, 1);
});

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：弹窗与目录行跟随宿主 token，已配置项灰显可区分`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("theme", { scheme });
    const tokens = THEME_TOKENS[scheme];
    assert.equal(result.theme.dialog.background, rgbOf(tokens["--dsw-alias-bg-layer-1"]));
    assert.equal(result.theme.dialog.color, rgbOf(tokens["--dsw-alias-label-primary"]));
    assert.equal(result.theme.dialog.colorScheme, scheme);
    assert.equal(result.theme.overlay.position, "fixed");
    assert.equal(result.theme.search.background, rgbOf(tokens["--dsw-alias-bg-layer-1"]));
    assert.equal(result.theme.search.color, rgbOf(tokens["--dsw-alias-label-primary"]));
    assert.equal(result.theme.normalRow.opacity, "1");
    assert.equal(result.theme.disabledRow.opacity, "0.45");
    assert.ok(result.theme.statuses.includes("已配置"));
    assert.ok(result.theme.statuses.includes("未配置"));
    assert.equal(result.theme.custom.input.background, rgbOf(tokens["--dsw-alias-bg-layer-1"]));
    assert.equal(result.theme.custom.select.background, rgbOf(tokens["--dsw-alias-bg-layer-1"]));
  });
}
