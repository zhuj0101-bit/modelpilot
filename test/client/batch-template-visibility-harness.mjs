// 工单 #43 缺陷 1 的浏览器夹具：批量写入用的模板必须对用户可见。
//
// 与既有 client 夹具同一套最小 React 渲染器：把打包后的 Workbench 渲染成真实
// DOM，点「拉取」拿到 3 个远端模型（自动打开选择器），读回勾选区上方的模板
// 摘要；勾 2 个 → 确定 → 点「写入」，核对真正写进去的 contextWindow 与摘要里的
// 数字一致。断言在 batch-template-visibility.test.mjs。
//
// 三个页面：
// - empty：库为空 —— 选择是隐式回落的内置「基础对话」；
// - builtinLong：在新增表单选中内置「长文档」后打开选择器；
// - userTemplate：库里有一份用户模板「我的 128K」并选中它。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/** 拉取结果的固定 3 条模型。 */
export const BATCH_REMOTE_MODELS = Object.freeze([
  "jxf/dsv4.1-flash",
  "jxf/dsv4.1-pro",
  "tx/deepseek-v4.1-flash",
]);

/** userTemplate 场景的库：一份与「基础对话」同值的用户模板。 */
export const BATCH_USER_LIBRARY = Object.freeze({
  version: 1,
  templates: [
    {
      id: "tpl-user-128k",
      name: "我的 128K",
      values: {
        version: 1,
        contextWindow: "128000",
        maxTokens: "8192",
        inputText: true,
        inputImage: false,
        reasoningLevels: ["off", "low", "medium", "high"],
      },
    },
  ],
});

export const BATCH_TEMPLATE_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  const seed = window.__BATCH_SEED__ || {};
  const store = new Map();
  if (seed.library) store.set("modelpilot.templates.v1", JSON.stringify(seed.library));
  if (seed.selection) store.set("modelpilot.templates.selected.v1", seed.selection);
  // 列表密度与本次断言无关，固定详细模式。
  store.set("modelpilot.model-list-density.v1", "detailed");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(key); },
    },
  });

  // 路由已有 models 数组（空），批量写入不会触发目录替换确认。
  const route = {
    id: "preview-chat",
    name: "preview-chat",
    baseURL: "https://preview.invalid/v1",
    api: "openai-completions",
    models: [],
  };
  const providers = { "preview-chat": route };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const mutations = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => {
      mutations.push(JSON.parse(JSON.stringify(ops)));
      return true;
    },
  };
  let Workbench;
  let spec;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms: { get: () => scope, whileServed: (namespaces, register) => register(new Set(namespaces)) },
    slots: {
      inject: (name, register) => register(),
      register: (registeredSpec, component) => {
        spec = registeredSpec;
        Workbench = component;
        return () => {};
      },
    },
    remote: {
      llm: {
        discoverModels: async () => ({
          ok: true,
          value: ${JSON.stringify(BATCH_REMOTE_MODELS)}.map((id) => ({ id })),
        }),
      },
      credentials: {
        describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }])) }),
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
  const buttonByText = (text) => buttons().find((element) => element.textContent.trim() === text);
  const createPicker = () => byAria("新增模型模板");
  const picker = () => document.querySelector('[role="dialog"][aria-label="选择模型"]');
  const hint = () => document.querySelector("[data-modelpilot-batch-template]");
  const hintText = () => hint() === null ? "" : hint().textContent.trim();
  const setSelect = (select, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const rowCheckbox = (id) => picker() === null ? null : picker().querySelector('input[type="checkbox"][aria-label="' + id + '"]');
  const click = (element) => {
    if (element === null || element === undefined) throw new Error("click target missing");
    element.click();
  };
  const result = {};

  // 先在新增表单里换一份模板（只改选择，不点「填入」）。
  if (seed.builtin) setSelect(createPicker().querySelector("select"), "builtin:" + seed.builtin);
  if (seed.userTemplate) setSelect(createPicker().querySelector("select"), "user:" + seed.userTemplate);

  // 拉取 → 自动打开选择器。discoverModels 是异步的，等它落地。
  click(buttonByText("拉取"));
  for (let attempt = 0; attempt < 50 && picker() === null; attempt++) await sleep(0);
  if (picker() === null) throw new Error("picker did not open");

  // 摘要必须在勾选区上方（全选那一行之前）。
  const selectAllLabel = [...picker().querySelectorAll("label")].find(
    (label) => label.textContent.includes("全选"),
  ) ?? null;
  result.hint = {
    text: hintText(),
    beforeSelectAll: hint() !== null && selectAllLabel !== null
      && (hint().compareDocumentPosition(selectAllLabel) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  };
  result.hintNumber = (() => {
    const match = hintText().match(/上下文 (\d+)（/);
    return match === null ? null : Number(match[1]);
  })();

  // 勾 2 个新模型 → 确定 → 待写入区块 → 写入。
  click(rowCheckbox("jxf/dsv4.1-flash"));
  click(rowCheckbox("jxf/dsv4.1-pro"));
  click(buttonByText("确定（2）"));
  await sleep(0);
  result.pending = {
    hasWriteButton: buttonByText("写入") !== null,
    previewText: [...document.querySelectorAll("div")]
      .find((node) => node.textContent.startsWith("待写入"))?.textContent ?? "",
  };
  click(buttonByText("写入"));
  for (let attempt = 0; attempt < 50 && mutations.length === 0; attempt++) await sleep(0);
  // 等 mutate 的 resolve 落地：toast 在 await 之后才写进 live region。
  for (let attempt = 0; attempt < 5; attempt++) await sleep(0);
  result.mutations = mutations;
  result.written = mutations.flat()
    .filter((op) => op.op === "set" && op.value && typeof op.value.id === "string")
    .map((op) => ({
      id: op.value.id,
      contextWindow: op.value.contextWindow ?? null,
      maxTokens: op.value.maxTokens ?? null,
    }));
  result.toast = document.querySelector("[data-modelpilot-toast]")?.textContent.trim() ?? "";
  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定种子组装批量选择器页面（seed 为 null 表示空库）。 */
export function buildBatchTemplateHtml(bundleSource, seed) {
  const payload = seed === null ? "null" : JSON.stringify(seed);
  return [
    "<!doctype html>",
    '<html lang="en" data-scheme="light" style="color-scheme: light">',
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>window.__BATCH_SEED__ = ${payload};</script>`,
    `<script>${BATCH_TEMPLATE_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
