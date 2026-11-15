// 工单 #20：路由设置卡片里的「测试连接」（真实 DOM / headless Chrome）。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，逐条验收：
// 按钮位置与禁用条件、表单快照请求、declared 路由带 provider（#29）、
// 四种结果与颜色 / 401 / 403 / 404 / 5xx 文案、结果随字段改动清除，
// 以及测试全程不产生任何 settingsOps。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildConnectionTestHtml } from "./connection-test-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) {
    probes.set(scheme, runPageProbe(chrome, buildConnectionTestHtml(bundle, scheme)));
  }
  return probes.get(scheme);
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
  test(`${scheme} 主题：底部按钮行出现「测试连接」，与保存设置并列，默认不自动测试`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.initial.collapsed, true, "卡片默认折叠");
    assert.equal(result.initial.calls, 0, "折叠状态不自动发请求");
    assert.deepEqual(result.expanded.order, ["删除路由", "测试连接", "保存路由设置"]);
    assert.deepEqual(result.expanded.button, { text: "测试连接", disabled: false, title: "" });
    assert.equal(result.expanded.result, null);
    assert.equal(result.expanded.calls, 0, "只有用户点击才发请求");
    assert.deepEqual(result.expanded.ops, []);
  });

  test(`${scheme} 主题：baseURL 为空 / 非 http(s):// 时禁用并给出对应 title`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.emptyBase, { text: "测试连接", disabled: true, title: "先填接口地址" });
    assert.deepEqual(result.badBase, { text: "测试连接", disabled: true, title: "接口地址格式不对" });
  });

  test(`${scheme} 主题：apiKeyEnv 为空不禁用（本地无鉴权端点也能测）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.emptyKey, { text: "测试连接", disabled: false, title: "" });
  });

  test(`${scheme} 主题：点击后「测试中…」并禁用；请求用表单快照且不带 provider / api`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.pending.button.text, "测试中…");
    assert.equal(result.pending.button.disabled, true);
    assert.equal(result.pending.calls, 1);
    assert.deepEqual(result.pending.request, { baseURL: "https://preview.invalid/v9" });
    assert.deepEqual(result.pending.requestKeys, ["baseURL"], "api 留空时请求里不出现 api 字段");
    assert.equal(result.pending.result, null);
  });

  test(`${scheme} 主题：测试期间改表单不改变请求；迟到结果不再显示，按钮恢复`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.editedWhilePending.result, null, "改字段立即清掉结果");
    assert.deepEqual(result.afterHeld.request, { baseURL: "https://preview.invalid/v9" }, "请求仍用发起时快照");
    assert.deepEqual(result.afterHeld.button, { text: "测试连接", disabled: false, title: "" });
    assert.equal(result.afterHeld.result, null, "表单已变，旧请求的结果不落地");
    assert.equal(result.afterHeld.mutations, 0);
  });

  test(`${scheme} 主题：ok + 非空 → 绿色「连接正常 · 端点返回 N 个模型」，用表单值而不是已保存值`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.success.result.text, "连接正常 · 端点返回 37 个模型");
    assert.equal(result.success.result.color, token(scheme, "--dsw-alias-state-success-primary"));
    assert.deepEqual(result.success.button, { text: "测试连接", disabled: false, title: "" });
    assert.deepEqual(result.success.request, {
      baseURL: "https://preview.invalid/v2",
      api: "openai-completions",
    });
    assert.equal(result.success.calls, 1);
    assert.equal(result.success.savedBaseURL, "https://preview.invalid/v1", "测试不保存表单");
    assert.equal(result.success.mutations, 0);
    assert.deepEqual(result.success.opsBefore, [
      { op: "set", path: ["providers", "preview-chat", "baseURL"], value: "https://preview.invalid/v2" },
    ], "改表单只影响预览，不产生 op");
    assert.deepEqual(result.success.opsAfter, result.success.opsBefore, "测试不增删任何 settingsOp");
  });

  test(`${scheme} 主题：ok + 空数组 → 黄色「连接正常，但端点没有返回任何模型」`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.emptyList.result.text, "连接正常，但端点没有返回任何模型");
    assert.equal(result.emptyList.result.color, token(scheme, "--dsw-alias-state-warn-primary"));
    assert.equal(result.emptyList.button.text, "测试连接");
    assert.equal(result.emptyList.mutations, 0);
  });

  test(`${scheme} 主题：DISCOVERY_UNSUPPORTED → 说明协议没有可读的模型列表`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.unsupported.result.text, "该协议没有可读的模型列表，换个协议或手动填写模型");
    assert.equal(result.unsupported.result.color, token(scheme, "--dsw-alias-state-error-primary"));
    assert.equal(result.unsupported.button.text, "测试连接");
  });

  test(`${scheme} 主题：其它错误显示 error.message 原文，超过 200 字符截断，红色`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.longFailure.textLength, 200, "长消息截断到 200 字符");
    assert.equal(result.longFailure.result.text, result.longFailure.expected);
    assert.equal(result.longFailure.result.color, token(scheme, "--dsw-alias-state-error-primary"));
    assert.equal(result.shortFailure.result.text, result.shortFailure.expected);
    assert.equal(result.shortFailure.expected, "密钥未通过认证（HTTP 401）：https://preview.invalid/v2 answered 401; check the API key");
    assert.equal(result.thrown.result.text, "network down");
    assert.deepEqual(result.thrown.button, { text: "测试连接", disabled: false, title: "" });
  });

  test(`${scheme} 主题：declared 路由请求带 provider，401 明确标注密钥问题`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.declaredUnauthorized.request, {
      provider: "relay-route",
      baseURL: "https://relay.invalid/v1",
      api: "openai-completions",
    }, "declared 路由必须带 provider，宿主才解析得到已保存凭据");
    assert.deepEqual(result.declaredUnauthorized.requestKeys, ["provider", "baseURL", "api"]);
    assert.equal(result.declaredUnauthorized.calls, 1, "每次点击只发一次探活请求");
    assert.ok(result.declaredUnauthorized.catalogCalls >= 1, "测试时读取宿主目录判定 declared");
    assert.equal(result.declaredUnauthorized.result.text, result.declaredUnauthorized.expected);
    assert.equal(result.declaredUnauthorized.result.color, token(scheme, "--dsw-alias-state-error-primary"));
    assert.deepEqual(result.declaredUnauthorized.button, { text: "测试连接", disabled: false, title: "" });
  });

  test(`${scheme} 主题：403 同样明确标注密钥问题`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(
      result.declaredForbidden.result.text,
      "密钥未通过认证（HTTP 403）：https://relay.invalid/v1/models answered 403",
    );
    assert.equal(result.declaredForbidden.request.provider, "relay-route");
  });

  test(`${scheme} 主题：404 标注「地址可能写错」，5xx 标注「服务端错误」`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(
      result.declaredNotFound.result.text,
      "接口地址可能写错（HTTP 404）：https://relay.invalid/v1/models answered 404",
    );
    assert.equal(
      result.declaredServerError.result.text,
      "服务端错误（HTTP 500）：https://relay.invalid/v1/models answered 500",
    );
    assert.equal(result.declaredNotFound.request.provider, "relay-route");
    assert.equal(result.declaredServerError.request.provider, "relay-route");
  });

  test(`${scheme} 主题：目录读不到时保守带 provider；目录恢复后目录路由不带 provider`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(
      result.declaredCatalogFailure.request.provider,
      "relay-route",
      "目录读不到时 declared 路由仍带 provider",
    );
    assert.equal(
      result.declaredCatalogFailure.result.text,
      `密钥未通过认证（HTTP 401）：https://relay.invalid/v1/models answered 401; check the API key`,
      "目录读不到也如实显示密钥错误",
    );
    assert.deepEqual(
      result.catalogRouteCatalogFailure.request,
      { provider: "preview-chat", baseURL: "https://preview.invalid/v3", api: "openai-completions" },
      "目录读不到时目录路由也保守带 provider",
    );
    assert.deepEqual(
      result.catalogRouteCatalogRestored.request,
      { baseURL: "https://preview.invalid/v3", api: "openai-completions" },
      "目录恢复后目录路由不带 provider，避免读目录冒充探活",
    );
    assert.deepEqual(result.catalogRouteCatalogRestored.requestKeys, ["baseURL", "api"]);
  });

  test(`${scheme} 主题：结果随字段改动清除；探活全程不带密钥字段，也不产生 settingsOps`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.cleared.result, null, "改显示名后结果自动清除");
    assert.deepEqual(result.cleared.button, { text: "测试连接", disabled: false, title: "" });
    assert.equal(result.requests.total, 14);
    assert.deepEqual(result.requests.namespaces, ["llm-pi-ai"]);
    assert.deepEqual(result.requests.keys.sort(), ["api", "baseURL", "provider"]);
    assert.equal(result.requests.credentialAbsent, true, "所有请求都不带 apiKey / apiKeyEnv / signal");
    assert.deepEqual(
      result.requests.providerByRoute.preview,
      [false, false, false, false, false, false, false, true, false],
      "目录路由默认不带 provider；仅目录读不到时保守带一次",
    );
    assert.deepEqual(
      result.requests.providerByRoute.relay,
      [true, true, true, true, true],
      "declared 路由每次都带 provider（含目录读不到时）",
    );
    assert.ok(result.requests.catalogCalls >= 9, "每次测试都重新读一次目录事实");
    assert.equal(result.mutations, 0, "连接测试是只读探活");
    assert.equal(result.opsUnchanged, true, "所有测试前后 settingsOps 预览完全一致");
  });
}
