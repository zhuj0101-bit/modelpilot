// 工单 #32 第一批：路由设置卡片 / 九字段编辑 / 删除整条路由的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下用 headless Chrome 渲染打包后的 lib/client.js，
// 做真实点击并读回表单值、mutate 参数、计算样式。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { FALLBACK_API_PROTOCOLS } from "../../src/core/route-edit.js";
import { buildRouteEditHtml } from "./route-edit-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme, variant = "multi:schema") {
  const key = `${scheme}:${variant}`;
  if (!probes.has(key)) {
    const [routeMode, schemaMode] = variant.split(":");
    probes.set(key, runPageProbe(chrome, buildRouteEditHtml(bundle, scheme, { routeMode, schemaMode })));
  }
  return probes.get(key);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

function token(scheme, name) {
  return rgbOf(THEME_TOKENS[scheme][name]);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：路由设置卡片默认折叠，摘要显示输出上限 / 上下文 / 模型数`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.initial.collapsed, true, "卡片默认折叠");
    assert.equal(result.initial.summary, "▶ 路由设置 · 输出上限 33K · 上下文 1M · 3 个模型");
    assert.equal(result.initial.route, "preview-chat");
  });

  test(`${scheme} 主题：展开后九个字段预填，未改动时保存禁用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.expanded.open, true);
    assert.deepEqual(
      {
        displayName: result.expanded.displayName,
        baseURL: result.expanded.baseURL,
        api: result.expanded.api,
        apiKeyEnv: result.expanded.apiKeyEnv,
        defaultContextWindow: result.expanded.defaultContextWindow,
        defaultMaxTokens: result.expanded.defaultMaxTokens,
        cacheRetention: result.expanded.cacheRetention,
        transport: result.expanded.transport,
        timeoutMs: result.expanded.timeoutMs,
      },
      {
        displayName: "Preview Chat",
        baseURL: "https://preview.invalid/v1",
        api: "openai-completions",
        apiKeyEnv: "PREVIEW_CHAT_API_KEY",
        defaultContextWindow: "1000000",
        defaultMaxTokens: "32768",
        cacheRetention: "short",
        transport: "auto",
        timeoutMs: "60000",
      },
    );
    assert.equal(result.expanded.saveDisabled, true);
    assert.equal(result.expanded.deleteDisabled, false);
    assert.equal(result.expanded.changed, true);
    assert.deepEqual(result.expanded.ops, []);
    assert.equal(result.expanded.defaultsHint, true);
    assert.deepEqual(result.expanded.cacheOptions, ["", "none", "short", "long"]);
    assert.deepEqual(result.expanded.transportOptions, ["", "sse", "websocket", "websocket-cached", "auto"]);
  });

  test(`${scheme} 主题：api 下拉的选项来自宿主 schema`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.expanded.apiOptions, [
      "",
      "openai-completions",
      "openai-responses",
      "azure-openai-responses",
      "openai-codex-responses",
      "anthropic-messages",
      "mistral-conversations",
      "bedrock-converse-stream",
      "preview-experimental",
    ]);
    assert.equal(result.expanded.schemaHint, true);
    assert.equal(result.expanded.fallbackNotice, false);
  });

  test(`${scheme} 主题：改 baseURL + defaultMaxTokens → 2 条 set 叶子路径，保存后摘要同步`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.edit.saveDisabled, false);
    assert.equal(result.edit.changed, true);
    assert.deepEqual(result.edit.ops, [
      { op: "set", path: ["providers", "preview-chat", "baseURL"], value: "https://preview.invalid/v2" },
      { op: "set", path: ["providers", "preview-chat", "defaultMaxTokens"], value: 16384 },
    ]);
    assert.match(result.edit.opsSummary, /保存将写入的 settingsOps（2 条）/);

    assert.equal(result.save.mutations, 1);
    assert.deepEqual(result.save.lastOps, result.edit.ops);
    assert.match(result.save.summaryAfter, /输出上限 16K/);
    assert.equal(result.save.formAfter.baseURL, "https://preview.invalid/v2");
    assert.equal(result.save.formAfter.defaultMaxTokens, "16384");
    // 路由上的其它字段（models / compat / 宿主未来字段）原样保留。
    assert.equal(result.save.provider.models.length, 3);
    assert.deepEqual(result.save.provider.compat, { supportsReasoningEffort: true });
    assert.deepEqual(result.save.provider.futureHostField, { keep: true });
    assert.equal(result.save.provider.displayName, "Preview Chat");
  });

  test(`${scheme} 主题：清空 displayName → 1 条 unset 叶子路径，不是 set null`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.clear.saveDisabled, false);
    assert.equal(result.clear.changed, true);
    assert.deepEqual(result.clear.ops, [
      { op: "unset", path: ["providers", "preview-chat", "displayName"] },
    ]);
    assert.equal(result.clearSaved.mutations, 2);
    assert.deepEqual(result.clearSaved.lastOps, result.clear.ops);
    assert.equal(result.clearSaved.displayName, undefined);
  });

  test(`${scheme} 主题：删除确认写明模型条数与不可撤销，取消不写入`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.deleteDialog.open, true);
    assert.match(result.deleteDialog.text, /删除路由 preview-chat/);
    assert.match(result.deleteDialog.text, /该路由下有 3 个模型/);
    assert.match(result.deleteDialog.text, /这一步不能撤销/);
    assert.ok(result.deleteDialog.danger.ratio >= 4.5, `删除按钮对比度 ${result.deleteDialog.danger.ratio}`);
    assert.equal(result.deleteDialog.cancelled, true);
    assert.equal(result.deleteDialog.mutationsAfterCancel, 2);
  });

  test(`${scheme} 主题：确认删除 → 1 条 unset 整条路由，选择器切到下一条路由`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.remove.mutations, 3);
    assert.deepEqual(result.remove.lastOps, [{ op: "unset", path: ["providers", "preview-chat"] }]);
    assert.deepEqual(result.remove.routes, ["backup-route", "spare-route"]);
    assert.equal(result.remove.routeAfter, "backup-route");
    assert.match(result.remove.summaryAfter, /路由设置 · 输出上限 未设置 · 上下文 未设置 · 1 个模型/);
    assert.match(result.remove.listAfter, /该路由的模型（1 条）/);
  });

  test(`${scheme} 主题：删除期间路由被别处删掉 → stale-route，拒绝写入`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.staleDelete.mutations, result.remove.mutations, "stale-route 不应产生新的 mutate");
    assert.equal(result.staleDelete.message, true);
    assert.equal(result.staleDelete.routeStillMissing, true);
  });

  test(`${scheme} 主题：只剩一个路由时删除禁用并提示「至少要保留一个路由」，协议退回内置清单`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "one:fallback");
    assert.equal(result.deleteDisabled, true);
    assert.equal(result.lastRouteHint, true);
    assert.equal(result.fallbackNotice, true);
    assert.deepEqual(result.apiOptions, ["", ...FALLBACK_API_PROTOCOLS]);
    assert.equal(result.saveDisabled, true);
    assert.equal(result.mutations, 0);
  });

  test(`${scheme} 主题：卡片 / 下拉 / 删除弹窗跟随 token，primary 与 danger 对比度 ≥ 4.5`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.theme.card.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.theme.select.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.theme.select.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(result.theme.save.ratio >= 4.5, `保存按钮对比度 ${result.theme.save.ratio}`);
    assert.ok(result.theme.danger.ratio >= 4.5, `删除路由按钮对比度 ${result.theme.danger.ratio}`);
    assert.equal(result.deleteDialog.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.deleteDialog.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(result.deleteDialog.danger.ratio >= 4.5, `确认删除按钮对比度 ${result.deleteDialog.danger.ratio}`);
  });
}
