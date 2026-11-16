// 工单 #40 的浏览器夹具：新增模型表单顶部的三个内置预设 chip。
//
// 与 template-fill-harness 相同的思路：打包后的 Workbench 由最小 React 兼容
// 渲染器渲染成真实 DOM，在 headless Chrome 里真实点击 chip 并读回表单值、
// aria-pressed 与 mutate 次数。存储为空 —— 首次打开就应命中内置「基础对话」。
//
// 断言在 preset-chips.test.mjs。

import { THEME_TOKEN_FIXTURE, SHIM_SOURCE } from "./layout-harness.mjs";
import { MODEL_EDIT_ROUTE_SOURCE } from "./model-edit-harness.mjs";

export const PRESET_CHIPS_PROBE_SOURCE = String.raw`
(async () => {
  try {
    const client = window.__CLIENT__;
    if (!client) throw new Error("client bundle did not register");

    // 空存储：readDefaultTemplate 回落到内置「基础对话」预设。
    const store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: (key) => { store.delete(key); },
      },
    });

${MODEL_EDIT_ROUTE_SOURCE}
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
        llm: { discoverModels: async () => ({ ok: true, value: [] }), listConfigurableProviders: async () => ({ ok: true, value: [] }) },
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
    const chips = () => [...document.querySelectorAll('[aria-label^="预设 "]')];
    const chipState = () => chips().map((element) => ({
      label: element.textContent.trim(),
      pressed: element.getAttribute("aria-pressed"),
      title: element.getAttribute("title") ?? "",
    }));
    const createCheckbox = (text) =>
      [...document.querySelectorAll("label")].find(
        (element) => element.textContent.trim() === text && element.querySelector("input[aria-label]") === null,
      )?.querySelector("input");
    const levels = () =>
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].filter((level) => createCheckbox(level)?.checked);
    const formState = () => ({
      contextWindow: byAria("上下文窗口")?.value ?? null,
      maxTokens: byAria("输出上限")?.value ?? null,
      text: createCheckbox("text")?.checked ?? null,
      image: createCheckbox("image")?.checked ?? null,
      levels: levels(),
    });
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const clickChip = async (label) => {
      byAria("预设 " + label).click();
      await sleep(20);
    };

    // 首次挂载 effect 会填入内置默认模板，等它跑完再读初始状态。
    await sleep(30);

    const result = { scheme: getComputedStyle(document.documentElement).colorScheme };
    result.initial = { chips: chipState(), form: formState(), mutations: mutations.length };

    await clickChip("代码");
    result.coding = { chips: chipState(), form: formState(), mutations: mutations.length };

    await clickChip("长文档");
    result.long = { chips: chipState(), form: formState(), mutations: mutations.length };

    await clickChip("基础对话");
    result.basicAgain = { chips: chipState(), form: formState(), mutations: mutations.length };

    // 手动改一个字段：不再命中任何预设，三个 chip 都必须取消高亮。
    setValue(byAria("上下文窗口"), "999");
    await sleep(20);
    result.edited = { chips: chipState(), form: formState(), mutations: mutations.length };

    // 再点一次预设，表单恢复、chip 恢复高亮；全程仍然不写配置。
    await clickChip("代码");
    result.recovered = { chips: chipState(), form: formState(), mutations: mutations.length };

    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装「预设 chip」页面。 */
export function buildPresetChipsHtml(bundleSource, scheme) {
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
    `<script>${PRESET_CHIPS_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
