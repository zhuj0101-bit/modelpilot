// 工单 #29：连接测试请求的纯逻辑。
//
// 覆盖 declared 分流（目录说得出 / 说不出 / 读不到）、请求字段顺序、凭据
// 字段绝不出现，以及 401 / 403 / 404 / 5xx 的失败文案分类与 200 字符截断。
// 真实点击与界面颜色在 test/client/connection-test.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const {
  PROBE_TEXT_LIMIT,
  buildProbeRequest,
  catalogEntriesOf,
  loadCatalogEntries,
  probeFailureText,
  probeHttpStatus,
  probeProviderChoice,
} = await import(pathToFileURL(join(root, "src", "core", "connection-probe.js")).href);

const catalog = [
  { provider: "relay-route", displayName: "Relay", settingsNs: "llm-pi-ai", declared: true },
  { provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai", declared: false },
  { provider: "legacy", displayName: "Legacy", settingsNs: "llm-pi-ai" },
];

test("catalogEntriesOf：接受裸数组与 {ok:true,value}，失败形态返回 undefined", () => {
  const entries = [{ provider: "relay-route", declared: true }];
  assert.equal(catalogEntriesOf(entries), entries, "裸数组原样返回");
  assert.equal(catalogEntriesOf({ ok: true, value: entries }), entries, "解包 remote 响应");
  assert.equal(catalogEntriesOf({ ok: false, error: { message: "down" } }), undefined);
  assert.equal(catalogEntriesOf({ ok: true, value: undefined }), undefined);
  assert.equal(catalogEntriesOf(undefined), undefined);
  assert.equal(catalogEntriesOf(null), undefined);
  assert.equal(catalogEntriesOf("nope"), undefined);
});

test("loadCatalogEntries：loader 缺失 / 同步抛错 / reject 都不挡住探活", async () => {
  assert.equal(await loadCatalogEntries(undefined), undefined);
  assert.equal(await loadCatalogEntries(async () => { throw new Error("down"); }), undefined);
  assert.equal(await loadCatalogEntries(() => { throw new Error("down"); }), undefined);
  assert.equal(await loadCatalogEntries(async () => ({ ok: false, error: { message: "down" } })), undefined);
});

test("loadCatalogEntries：loader 返回裸数组或 remote 响应都会归一成条目数组", async () => {
  const entries = [{ provider: "relay-route", declared: true }];
  assert.equal(await loadCatalogEntries(async () => entries), entries);
  assert.equal(await loadCatalogEntries(() => ({ ok: true, value: entries })), entries);
});

test("probeProviderChoice：declared 路由带 provider，目录路由不带", () => {
  assert.deepEqual(
    probeProviderChoice(catalog, "relay-route"),
    { declared: true, includeProvider: true, provider: "relay-route" },
  );
  assert.deepEqual(
    probeProviderChoice(catalog, "openai"),
    { declared: false, includeProvider: false, provider: "openai" },
  );
});

test("probeProviderChoice：缺少 declared 的旧宿主条目按目录可描述处理", () => {
  assert.deepEqual(
    probeProviderChoice(catalog, "legacy"),
    { declared: false, includeProvider: false, provider: "legacy" },
  );
});

test("probeProviderChoice：目录没有这条 / 目录为空 / 目录读不到都保守带 provider", () => {
  const expected = { declared: true, includeProvider: true, provider: "missing-route" };
  assert.deepEqual(probeProviderChoice(catalog, "missing-route"), expected);
  assert.deepEqual(probeProviderChoice([], "missing-route"), expected);
  assert.deepEqual(probeProviderChoice(undefined, "missing-route"), expected);
  assert.deepEqual(probeProviderChoice(null, "missing-route"), expected);
});

test("probeProviderChoice：routeId 去首尾空白，空 id 不发 provider", () => {
  const entries = [{ provider: "relay-route", declared: true }];
  assert.equal(probeProviderChoice(entries, "  relay-route  ").provider, "relay-route");
  assert.deepEqual(probeProviderChoice(entries, ""), { declared: true, includeProvider: false, provider: "" });
  assert.deepEqual(probeProviderChoice(entries, undefined), { declared: true, includeProvider: false, provider: "" });
});

test("buildProbeRequest：declared 路由的字段顺序固定为 provider / baseURL / api", () => {
  const result = buildProbeRequest({
    entries: catalog,
    routeId: "relay-route",
    baseURL: "https://relay.invalid/v1",
    api: "openai-completions",
  });
  assert.deepEqual(result.request, {
    provider: "relay-route",
    baseURL: "https://relay.invalid/v1",
    api: "openai-completions",
  });
  assert.deepEqual(Object.keys(result.request), ["provider", "baseURL", "api"]);
  assert.equal(result.declared, true);
  assert.equal(result.includeProvider, true);
});

test("buildProbeRequest：目录路由不带 provider，api 为空时整个字段省略", () => {
  const result = buildProbeRequest({
    entries: catalog,
    routeId: "openai",
    baseURL: "https://openai.invalid/v1",
    api: undefined,
  });
  assert.deepEqual(result.request, { baseURL: "https://openai.invalid/v1" });
  assert.deepEqual(Object.keys(result.request), ["baseURL"]);
  assert.equal(result.includeProvider, false);
  assert.deepEqual(
    buildProbeRequest({ entries: catalog, routeId: "openai", baseURL: "https://x/v1", api: "" }).request,
    { baseURL: "https://x/v1" },
  );
});

test("buildProbeRequest：目录读不到时仍带 provider，且从不带任何密钥字段", () => {
  const result = buildProbeRequest({
    entries: undefined,
    routeId: "openai",
    baseURL: "https://openai.invalid/v1",
    api: "openai-completions",
  });
  assert.deepEqual(result.request, {
    provider: "openai",
    baseURL: "https://openai.invalid/v1",
    api: "openai-completions",
  });
  for (const key of ["apiKey", "apiKeyEnv", "signal"]) assert.equal(key in result.request, false);
});

test("probeHttpStatus：从宿主消息或 status 字段读状态，不误认端口号", () => {
  assert.equal(probeHttpStatus({ message: "https://x.invalid/v1/models answered 401; check the API key" }), 401);
  assert.equal(probeHttpStatus({ message: "upstream HTTP 503" }), 503);
  assert.equal(probeHttpStatus({ status: 403, message: "forbidden" }), 403);
  assert.equal(probeHttpStatus({ message: "http://host:401/v1 could not be reached" }), undefined);
  assert.equal(probeHttpStatus({ message: "network down" }), undefined);
  assert.equal(probeHttpStatus(undefined), undefined);
});

test("probeFailureText：401 / 403 明确标注是密钥问题，并保留宿主原文", () => {
  const unauthorized = "https://relay.invalid/v1/models answered 401; check the API key";
  assert.equal(
    probeFailureText({ code: "DISCOVERY_FAILED", message: unauthorized }),
    `密钥未通过认证（HTTP 401）：${unauthorized}`,
  );
  assert.equal(
    probeFailureText({ message: "https://relay.invalid/v1/models answered 403" }),
    "密钥未通过认证（HTTP 403）：https://relay.invalid/v1/models answered 403",
  );
});

test("probeFailureText：404 标注地址可能写错", () => {
  const missing = "https://relay.invalid/v1/models answered 404";
  assert.equal(probeFailureText({ message: missing }), `接口地址可能写错（HTTP 404）：${missing}`);
});

test("probeFailureText：5xx 标注服务端错误", () => {
  assert.equal(
    probeFailureText({ message: "https://relay.invalid/v1/models answered 500" }),
    "服务端错误（HTTP 500）：https://relay.invalid/v1/models answered 500",
  );
  assert.equal(
    probeFailureText({ message: "https://relay.invalid/v1/models answered 503" }),
    "服务端错误（HTTP 503）：https://relay.invalid/v1/models answered 503",
  );
});

test("probeFailureText：其它错误保留原文，空消息给兜底（401 空消息仍点明密钥）", () => {
  assert.equal(probeFailureText({ message: "network down" }), "network down");
  assert.equal(probeFailureText("network down"), "network down");
  assert.equal(probeFailureText({ code: "DISCOVERY_FAILED" }), "连接测试失败（宿主未返回原因）");
  assert.equal(probeFailureText({ code: "DISCOVERY_FAILED", message: "   " }), "连接测试失败（宿主未返回原因）");
  assert.equal(probeFailureText({ status: 401 }), "密钥未通过认证（HTTP 401）");
});

test("probeFailureText：429 等其它状态不改写宿主原文", () => {
  const limited = "https://relay.invalid/v1/models answered 429; slow down";
  assert.equal(probeFailureText({ message: limited }), limited);
});

test("probeFailureText：超长消息截断到 200 字符，前缀不会被截掉", () => {
  const prefix = "密钥未通过认证（HTTP 401）：";
  const text = probeFailureText({ message: `answered 401 ${"E".repeat(400)}` });
  assert.equal(PROBE_TEXT_LIMIT, 200);
  assert.equal(text.length, PROBE_TEXT_LIMIT);
  assert.equal(text.startsWith(prefix), true);
});
