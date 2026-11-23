// 工单 #43 缺陷 3 的浏览器夹具：两个模态弹窗的焦点管理。
//
// 与 template-picker-harness 同一套「真实 DOM + 最小 React 渲染器」：渲染打包后的
// Workbench，点「存为新模板」/「管理」打开弹窗，读回 document.activeElement、
// Tab 圈定的结果与 maxlength 属性。断言在 template-dialog-focus.test.mjs。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";
import { SEEDED_LIBRARY } from "./template-picker-harness.mjs";

export const TEMPLATE_FOCUS_SEED = Object.freeze({
  library: SEEDED_LIBRARY,
  selection: "tpl-seed-128k",
});

export const TEMPLATE_FOCUS_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  const seed = window.__FOCUS_SEED__ || {};
  const store = new Map();
  if (seed.library) store.set("modelpilot.templates.v1", JSON.stringify(seed.library));
  if (seed.selection) store.set("modelpilot.templates.selected.v1", seed.selection);
  store.set("modelpilot.model-list-density.v1", "detailed");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(key); },
    },
  });

  const route = {
    id: "preview-chat",
    name: "preview-chat",
    baseURL: "https://preview.invalid/v1",
    api: "openai-completions",
    models: [
      { id: "jxf/dsv4.1-flash", name: "jxf/dsv4.1-flash", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
    ],
  };
  const providers = { "preview-chat": route };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async () => true,
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
      llm: { discoverModels: async () => ({ ok: true, value: [] }) },
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

  const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
  const createPicker = () => byAria("新增模型模板");
  const saveButton = () => createPicker() === null ? null : createPicker().querySelector('[aria-label="存为新模板"]');
  const manageButton = () => createPicker() === null ? null : createPicker().querySelector('[aria-label="管理模板"]');
  const dialog = () => document.querySelector('[role="dialog"][aria-label="存为新模板"]');
  const manage = () => document.querySelector('[role="dialog"][aria-label="模板管理"]');
  const click = (element) => {
    if (element === null || element === undefined) throw new Error("click target missing");
    element.click();
  };
  const activeLabel = () => {
    const element = document.activeElement;
    if (element === null || element === undefined) return null;
    if (element === document.body) return "BODY";
    return element.getAttribute("aria-label") ?? element.tagName;
  };
  const inside = (root) => root !== null && root.contains(document.activeElement);
  const focusables = (root) => root === null
    ? []
    : [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  const pressTab = (root, shiftKey) => {
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: shiftKey === true,
      bubbles: true,
      cancelable: true,
    });
    // dispatchEvent 返回 false 表示 handler 调用了 preventDefault（焦点被圈回）。
    const prevented = !root.dispatchEvent(event);
    return { prevented, active: activeLabel(), inside: inside(root) };
  };

  const result = {};

  // ── 1. 存为新模板：打开即聚焦名称输入；Tab 圈定；关闭还焦点 ──
  click(saveButton());
  const nameDialog = dialog();
  result.saveDialog = {
    open: nameDialog !== null,
    active: activeLabel(),
    maxLength: nameDialog?.querySelector('[aria-label="模板名称"]')?.getAttribute("maxlength") ?? null,
    focusables: focusables(nameDialog).map((element) => element.getAttribute("aria-label") ?? element.tagName),
  };

  const list = focusables(nameDialog);
  list[list.length - 1].focus();
  result.saveDialog.tabFromLast = pressTab(nameDialog, false);
  list[0].focus();
  result.saveDialog.shiftTabFromFirst = pressTab(nameDialog, true);

  // 在对话框里连续 Tab 一圈：焦点始终在对话框内，不跑到背后的表单输入框。
  const walk = { visited: [], escaped: null };
  let index = 0;
  for (let step = 0; step < list.length * 2 + 4; step++) {
    const current = focusables(nameDialog);
    if (index >= current.length) index = 0;
    current[index].focus();
    walk.visited.push(activeLabel());
    const outcome = pressTab(nameDialog, false);
    if (!outcome.inside) {
      walk.escaped = outcome.active;
      break;
    }
    const next = focusables(nameDialog);
    index = outcome.prevented ? Math.max(next.indexOf(document.activeElement), 0) : next.indexOf(document.activeElement) + 1;
    if (index < 0) index = 0;
  }
  result.saveDialog.tabWalk = walk;

  // 焦点意外落在背后表单上时，下一次 Tab 必须被拉回对话框。
  // 聚焦背后输入会触发重渲染（field 自己有无障碍提示），节点会被替换 ——
  // 重新取一次对话框节点再派发，测的是行为而不是某个旧引用的身份。
  byAria("上下文窗口").focus();
  result.saveDialog.tabFromOutside = pressTab(dialog(), false);

  click(dialog().querySelector('[aria-label="取消保存模板"]'));
  result.saveDialog.afterCancel = { open: dialog() !== null, active: activeLabel() };

  // ── 2. 模板管理：打开即聚焦第一行的「改名」；行内改名输入接住焦点；关闭还焦点 ──
  click(manageButton());
  result.manage = {
    open: manage() !== null,
    active: activeLabel(),
    focusables: focusables(manage()).map((element) => element.getAttribute("aria-label") ?? element.tagName),
  };
  click(manage().querySelector('[aria-label="改名 我的 128K"]'));
  result.manage.rename = {
    active: activeLabel(),
    maxLength: manage()?.querySelector('[aria-label="重命名模板输入"]')?.getAttribute("maxlength") ?? null,
  };
  click(manage().querySelector('[aria-label="取消改名"]'));
  click(manage().querySelector('[aria-label="关闭模板管理"]'));
  result.manage.afterClose = { open: manage() !== null, active: activeLabel() };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 组装焦点管理页面。 */
export function buildTemplateFocusHtml(bundleSource, seed) {
  const payload = JSON.stringify(seed ?? null);
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
    `<script>window.__FOCUS_SEED__ = ${payload};</script>`,
    `<script>${TEMPLATE_FOCUS_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
