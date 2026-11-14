// 工单 #20 的浏览器夹具：路由设置卡片底部的「测试连接」。
//
// 和 route-edit-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，在 headless Chrome 里做真实点击、控制探活请求什么时候返回，
// 读回按钮状态、请求参数、结果文案与计算样式。断言在 connection-test.test.mjs。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

const ROUTE_SOURCE = String.raw`
  const previewChat = {
    id: "preview-chat",
    displayName: "Preview Chat",
    baseURL: "https://preview.invalid/v1",
    api: "openai-completions",
    apiKeyEnv: "PREVIEW_CHAT_API_KEY",
    defaultContextWindow: 1000000,
    defaultMaxTokens: 32768,
    models: [
      { id: "jxf/dsv4.1-flash", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
      { id: "jxf/dsv4.1-pro", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
      { id: "tx/deepseek-v4.1-flash", contextWindow: 128000, maxTokens: 8192, input: ["text"] },
    ],
  };
  const providers = { "preview-chat": previewChat };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
`;

const PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
${ROUTE_SOURCE}
  const mutations = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => { mutations.push(JSON.parse(JSON.stringify(ops))); return true; },
  };
  const configForms = {
    get: () => scope,
    whileServed: (namespaces, register) => register(new Set(namespaces)),
  };

  // 探活通道：默认立即返回；hold=true 时把 resolve 交给探针，先断言「测试中…」。
  const calls = [];
  let nextResponse = { ok: true, value: [] };
  let hold = false;
  let heldResolve = null;
  const discoverModels = (namespace, request) => {
    calls.push({ namespace, request: JSON.parse(JSON.stringify(request)) });
    if (hold) {
      return new Promise((resolve) => { heldResolve = resolve; });
    }
    return Promise.resolve().then(() => {
      if (typeof nextResponse === "function") return nextResponse();
      return nextResponse;
    });
  };

  let Workbench;
  let spec;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms,
    slots: {
      inject: (name, register) => register(),
      register: (registeredSpec, component) => {
        spec = registeredSpec;
        Workbench = component;
        return () => {};
      },
    },
    remote: {
      llm: { discoverModels },
      credentials: {
        describe: async (refs) => ({
          ok: true,
          value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }])),
        }),
        set: async () => ({ ok: true, value: undefined }),
        unset: async () => ({ ok: true, value: undefined }),
      },
    },
  };
  client.apply(ctx);
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, spec.inject());

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
  const buttons = () => [...document.querySelectorAll("button")];
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const setSelect = (select, value) => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const routeCard = () => document.querySelector('section[aria-label="路由设置"]');
  const routeSummary = () => document.querySelector('[aria-label="展开路由设置"], [aria-label="收起路由设置"]');
  const opsOf = () => {
    const label = [...document.querySelectorAll("summary")]
      .find((element) => element.textContent.includes("保存将写入的 settingsOps"));
    if (label === undefined) return null;
    return JSON.parse(label.parentElement.querySelector("pre").textContent);
  };
  const styleOf = (element) => getComputedStyle(element);
  const resultBox = () => byAria("连接测试结果");
  const resultState = () => {
    const box = resultBox();
    if (box === null) return null;
    return { text: box.textContent.trim(), color: styleOf(box).color };
  };
  const buttonState = () => {
    const button = byAria("测试连接");
    if (button === undefined) return null;
    return {
      text: button.textContent.trim(),
      disabled: button.disabled,
      title: button.getAttribute("title"),
    };
  };
  const footerOrder = () => [...byAria("删除路由").parentElement.querySelectorAll("button")]
    .map((button) => button.getAttribute("aria-label"));

  const result = { scheme: styleOf(document.documentElement).colorScheme };

  // ── 1. 默认折叠；展开后按钮在底部按钮行，和保存设置并列 ──
  result.initial = {
    collapsed: routeCard() !== null && routeSummary()?.getAttribute("aria-expanded") === "false",
    calls: calls.length,
  };
  routeSummary().click();
  await sleep(30);
  result.expanded = {
    button: buttonState(),
    order: footerOrder(),
    result: resultState(),
    calls: calls.length,
    ops: opsOf(),
  };

  // ── 2. baseURL 为空 / 不是 http(s):// → 禁用并给出对应 title ──
  const baseURLInput = () => byAria("路由接口地址");
  const apiSelect = () => byAria("路由协议");
  const keyInput = () => byAria("路由密钥引用");
  setValue(baseURLInput(), "");
  await sleep(10);
  result.emptyBase = buttonState();
  setValue(baseURLInput(), "preview.invalid/v1");
  await sleep(10);
  result.badBase = buttonState();
  setValue(baseURLInput(), "https://preview.invalid/v1");
  await sleep(10);

  // ── 3. apiKeyEnv 为空不禁用：无鉴权端点也应该能测 ──
  setValue(keyInput(), "");
  await sleep(20);
  result.emptyKey = buttonState();
  setValue(keyInput(), "PREVIEW_CHAT_API_KEY");
  await sleep(20);

  // ── 4. 点击后用表单快照请求；测试中按钮禁用；期间改表单不改变请求 ──
  setValue(baseURLInput(), "https://preview.invalid/v9");
  setSelect(apiSelect(), "");
  hold = true;
  const callsBeforePending = calls.length;
  byAria("测试连接").click();
  await sleep(30);
  result.pending = {
    button: buttonState(),
    calls: calls.length - callsBeforePending,
    request: calls[calls.length - 1].request,
    requestKeys: Object.keys(calls[calls.length - 1].request),
    result: resultState(),
  };
  setValue(byAria("路由显示名"), "Changed During Test");
  await sleep(10);
  result.editedWhilePending = {
    button: buttonState(),
    result: resultState(),
  };
  heldResolve({ ok: true, value: Array.from({ length: 37 }, (_, index) => ({ id: "model-" + index })) });
  hold = false;
  await sleep(60);
  result.afterHeld = {
    button: buttonState(),
    result: resultState(),
    request: calls[calls.length - 1].request,
    mutations: mutations.length,
  };
  setValue(byAria("路由显示名"), "Preview Chat");
  setValue(baseURLInput(), "https://preview.invalid/v1");
  setSelect(apiSelect(), "openai-completions");
  await sleep(20);

  // ── 5. ok + 非空：绿色结果，请求用表单值而不是已保存值 ──
  setValue(baseURLInput(), "https://preview.invalid/v2");
  await sleep(10);
  const successCalls = calls.length;
  const opsBeforeSuccess = opsOf();
  nextResponse = { ok: true, value: Array.from({ length: 37 }, (_, index) => ({ id: "model-" + index })) };
  byAria("测试连接").click();
  await sleep(60);
  result.success = {
    button: buttonState(),
    result: resultState(),
    request: calls[calls.length - 1].request,
    calls: calls.length - successCalls,
    mutations: mutations.length,
    opsBefore: opsBeforeSuccess,
    opsAfter: opsOf(),
    savedBaseURL: providers["preview-chat"].baseURL,
  };

  // ── 6. 结果出现后改任一字段 → 自动清除，避免「测过 A 却以为测的是 B」 ──
  setValue(byAria("路由显示名"), "Changed After Result");
  await sleep(10);
  result.cleared = { result: resultState(), button: buttonState() };
  setValue(byAria("路由显示名"), "Preview Chat");
  await sleep(10);

  // ── 7. ok + 空数组：黄色提示可能 key 不对 ──
  nextResponse = { ok: true, value: [] };
  byAria("测试连接").click();
  await sleep(60);
  result.emptyList = { result: resultState(), button: buttonState(), mutations: mutations.length };

  // ── 8. DISCOVERY_UNSUPPORTED：协议没有可读的模型列表 ──
  nextResponse = {
    ok: false,
    error: { code: "DISCOVERY_UNSUPPORTED", message: "pi-ai protocol has no model listing this build can read" },
  };
  byAria("测试连接").click();
  await sleep(60);
  result.unsupported = { result: resultState(), button: buttonState() };

  // ── 9. 其它错误：显示 error.message，长消息截断到 200 字符，红色 ──
  const longMessage = "E".repeat(250);
  nextResponse = { ok: false, error: { code: "DISCOVERY_FAILED", message: longMessage } };
  byAria("测试连接").click();
  await sleep(60);
  result.longFailure = {
    result: resultState(),
    textLength: (resultBox()?.textContent ?? "").length,
    expected: longMessage.slice(0, 200),
  };
  const shortMessage = "https://preview.invalid/v2 answered 401; check the API key";
  nextResponse = { ok: false, error: { code: "DISCOVERY_FAILED", message: shortMessage } };
  byAria("测试连接").click();
  await sleep(60);
  result.shortFailure = { result: resultState(), expected: shortMessage };

  // ── 10. 宿主抛异常同样如实显示；请求始终不带 provider / 密钥 ──
  nextResponse = () => { throw new Error("network down"); };
  byAria("测试连接").click();
  await sleep(60);
  result.thrown = { result: resultState(), button: buttonState() };
  result.requests = {
    total: calls.length,
    namespaces: [...new Set(calls.map((call) => call.namespace))],
    keys: [...new Set(calls.flatMap((call) => Object.keys(call.request)))],
    providerAbsent: calls.every((call) => !("provider" in call.request)),
    credentialAbsent: calls.every((call) => (
      !("apiKey" in call.request) && !("apiKeyEnv" in call.request) && !("signal" in call.request)
    )),
  };
  result.mutations = mutations.length;
  result.ops = opsOf();
  result.opsUnchanged = JSON.stringify(result.success.opsBefore) === JSON.stringify(result.success.opsAfter);

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装「测试连接」页。 */
export function buildConnectionTestHtml(bundleSource, scheme) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
