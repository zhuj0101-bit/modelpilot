// 工单 #35 的浏览器夹具：批量改字段的真实条数、上下文预算的可读性、
// 操作结果提示（live region / 自动消失 / 焦点暂停 / 卸载清 timer）。
//
// 与 model-edit-harness 同一套最小 React 渲染器：把打包后的 Workbench 渲染成
// 真实 DOM，派发真实的 input / change / click / focus 事件，读回真实文字与
// 计算样式。断言分别在 bulk-fields-count.test.mjs、budget-hint-clamp.test.mjs
// 与 toast-live-region.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/** 三份夹具共用的宿主接线与 DOM 工具。 */
const COMMON_SOURCE = String.raw`
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
  const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
  const click = (label) => {
    const element = byAria(label)
      ?? [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label)
      ?? null;
    if (element === null) throw new Error("找不到可点击元素：" + label);
    element.click();
  };
  const setText = (input, value) => {
    if (input === null) throw new Error("找不到输入框");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /**
   * 工单 #42：「存为新模板」是两步操作 —— 打开对话框、填名字、保存。
   * 名字必须唯一（库内不允许重名），调用方按场景给不同名字。
   */
  const saveTemplate = (name) => {
    click("存为新模板");
    setText(document.querySelector('[role="dialog"][aria-label="存为新模板"] [aria-label="模板名称"]'), name);
    click("保存模板");
  };
  const toastRegion = () => document.querySelector("[data-modelpilot-toast]");
  const toastText = () => toastRegion()?.textContent ?? "";
  const mountWorkbench = (route) => {
    const providers = route === null ? {} : { "preview-chat": route };
    const snapshot = {
      status: "ready",
      value: { providers },
      user: { providers },
      revision: 1,
      writable: true,
    };
    const mutations = [];
    const providersOf = () => providers;
    const setPath = (root, path, value) => {
      let node = root;
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
      node[path[path.length - 1]] = value;
    };
    const scope = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      mutate: async (ops) => {
        mutations.push(JSON.parse(JSON.stringify(ops)));
        for (const op of ops) {
          if (op.op === "set") setPath(snapshot.value, op.path, op.value);
        }
        return true;
      },
    };
    const configForms = { get: () => scope };
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
    window.__renderComponent(Workbench, spec.inject());
    return { providersOf, mutations };
  };
`;

/** 批量改字段：三条模型里 b、a 已是目标值，只有 c 需要写盘。 */
export const BULK_FIELDS_FIXTURE_SOURCE = String.raw`
(async () => {
  try {
    ${COMMON_SOURCE}
    window.localStorage.setItem("modelpilot.model-list-density.v1", "detailed");
    const route = {
      id: "preview-chat",
      name: "preview-chat",
      baseURL: "https://preview.invalid/v1",
      models: [
        { id: "a/already", name: "a/already", maxTokens: 8192, input: ["text"] },
        { id: "b/already", name: "b/already", maxTokens: 8192, input: ["text"] },
        { id: "c/changed", name: "c/changed", maxTokens: 4096, input: ["text"] },
      ],
    };
    const mounted = mountWorkbench(route);
    const models = () => JSON.parse(JSON.stringify(mounted.providersOf()["preview-chat"].models));

    const selectAllRows = async () => {
      for (const model of models()) byAria("选择模型 " + model.id).click();
      await sleep(10);
    };
    const applyMaxTokens = async (value) => {
      click("批量改字段");
      await sleep(10);
      click("批量设置输出上限");
      await sleep(5);
      setText(byAria("批量输出上限"), value);
      await sleep(10);
      const before = models();
      click("应用批量修改");
      await sleep(80);
      const after = models();
      const changedIds = after
        .filter((row, index) => JSON.stringify(row) !== JSON.stringify(before[index]))
        .map((row) => row.id);
      return { toast: toastText(), before, after, changedIds };
    };

    const result = {};
    await selectAllRows();
    result.partial = await applyMaxTokens("8192");
    await selectAllRows();
    result.allChanged = await applyMaxTokens("16384");
    result.mutations = mounted.mutations;
    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 上下文预算：新增模型表单里把窗口与输出改成常见的小值。 */
export const BUDGET_HINT_FIXTURE_SOURCE = String.raw`
(async () => {
  try {
    ${COMMON_SOURCE}
    const route = {
      id: "preview-chat",
      name: "preview-chat",
      baseURL: "https://preview.invalid/v1",
      models: [{ id: "acme/declared", name: "acme/declared", contextWindow: 131072, maxTokens: 32768, input: ["text"] }],
    };
    mountWorkbench(route);

    const hintNode = () => [...document.querySelectorAll('[role="status"]')]
      .find((node) => node.textContent.includes("按默认压缩策略估算")) ?? null;
    const sample = () => {
      const node = hintNode();
      return node === null ? null : { text: node.textContent };
    };
    const body = () => document.body.innerText;

    const result = {};
    result.initial = sample();
    setText(byAria("上下文窗口"), "8192");
    setText(byAria("输出上限"), "2048");
    await sleep(30);
    result.exhausted8k = sample();
    setText(byAria("上下文窗口"), "32768");
    await sleep(30);
    result.exhausted32k = { ...sample(), body: body() };
    setText(byAria("上下文窗口"), "131072");
    setText(byAria("输出上限"), "32768");
    await sleep(30);
    result.loss131k = { ...sample(), body: body() };
    setText(byAria("上下文窗口"), "1000000");
    setText(byAria("输出上限"), "32768");
    await sleep(30);
    result.zeroLoss1m = sample();
    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 操作结果提示：常驻 live region、6 秒自动淡出、报错保留、焦点暂停、卸载清 timer。 */
export const TOAST_FIXTURE_SOURCE = String.raw`
(async () => {
  try {
    const consoleErrors = [];
    const originalError = console.error;
    console.error = (...args) => {
      consoleErrors.push(String(args[0]));
      originalError(...args);
    };
    const scheduled = [];
    const cleared = [];
    const realSetTimeout = window.setTimeout.bind(window);
    const realClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) => {
      const id = realSetTimeout(fn, delay, ...args);
      if (delay === 6000) scheduled.push(id);
      return id;
    };
    window.clearTimeout = (id) => {
      cleared.push(id);
      return realClearTimeout(id);
    };

    ${COMMON_SOURCE}
    const route = {
      id: "preview-chat",
      name: "preview-chat",
      baseURL: "https://preview.invalid/v1",
      models: [{ id: "acme/declared", name: "acme/declared", maxTokens: 8192, input: ["text"] }],
    };
    mountWorkbench(route);
    const region = () => toastRegion();
    const snapshot = () => {
      const node = region();
      if (node === null) return null;
      const style = getComputedStyle(node);
      return {
        text: node.textContent,
        role: node.getAttribute("role"),
        live: node.getAttribute("aria-live"),
        atomic: node.getAttribute("aria-atomic"),
        tone: node.getAttribute("data-modelpilot-toast"),
        tabIndex: node.tabIndex,
        inlineOpacity: node.style.opacity,
        transition: node.style.transition,
        display: style.display,
        computedOpacity: style.opacity,
        inDom: true,
      };
    };
    // 工单 #41：选中态 chip 文字前多了一个固定宽度的 ✓ 槽；比较标签时剥掉。
    const plainText = (element) => element.textContent.replace(/[\s\u00a0✓]/g, "");
    const modality = (name) => [...document.querySelectorAll("label")]
      .find((label) => plainText(label) === name)
      ?.querySelector('input[type="checkbox"]') ?? null;

    const result = {};
    result.initial = snapshot();

    // ── 1. 成功提示：6 秒后淡出（opacity transition，不是 display:none），再移除 ──
    saveTemplate("我的模板 1");
    await sleep(80);
    result.good = snapshot();
    await sleep(6000);
    result.fading = snapshot();
    await sleep(500);
    result.gone = snapshot();

    // ── 2. 连续两次操作：第一条已被自动清掉，第二次只出现自己的文案 ──
    saveTemplate("我的模板 2");
    await sleep(80);
    result.secondOperation = snapshot();

    // ── 3. 焦点在提示区域内：计时暂停 ──
    // 夹具的渲染器会整体替换子树，原生 focus 会在替换时丢失；直接派发
    // focus / blur 事件，走的仍是组件真实的 onFocus / onBlur 处理器。
    region().dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    await sleep(6500);
    result.focused = snapshot();
    region().dispatchEvent(new FocusEvent("blur", { bubbles: false, relatedTarget: null }));
    await sleep(6200);
    result.afterBlur = snapshot();
    await sleep(500);
    result.afterBlurGone = snapshot();

    // ── 4. 报错提示：role=alert、不自动消失 ──
    // 两个输入模态都没勾时保存：对话框里就地报错，页面提示是 role=alert 的报错。
    modality("text").click();
    saveTemplate("我的模板 3");
    await sleep(80);
    result.bad = snapshot();
    await sleep(7000);
    result.badPersisted = snapshot();
    click("取消保存模板");

    // ── 5. 卸载：清掉成功提示的 timer，不出现卸载后 setState ──
    modality("text").click();
    saveTemplate("我的模板 3");
    await sleep(80);
    const pending = scheduled[scheduled.length - 1];
    window.__unmountComponent();
    const clearedOnUnmount = pending !== undefined && cleared.includes(pending);
    await sleep(7000);
    result.unmount = {
      pendingTimer: pending ?? null,
      clearedOnUnmount,
      consoleErrors: consoleErrors.slice(),
      rootChildren: document.getElementById("root").children.length,
      toastGone: toastRegion() === null || toastRegion().textContent === "",
    };
    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

function buildPage(bundleSource, scheme, fixtureSource) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    "<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }",
    "#root { max-width: 1100px; margin: 0 auto; }",
    THEME_TOKEN_FIXTURE,
    "</style></head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${fixtureSource}</script>`,
    "</body></html>",
  ].join("\n");
}

export function buildBulkFieldsCountHtml(bundleSource, scheme) {
  return buildPage(bundleSource, scheme, BULK_FIELDS_FIXTURE_SOURCE);
}

export function buildBudgetHintHtml(bundleSource, scheme) {
  return buildPage(bundleSource, scheme, BUDGET_HINT_FIXTURE_SOURCE);
}

export function buildToastLiveRegionHtml(bundleSource, scheme) {
  return buildPage(bundleSource, scheme, TOAST_FIXTURE_SOURCE);
}
