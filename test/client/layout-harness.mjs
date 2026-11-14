// 浏览器布局测试夹具：
//
// 用最小的 React 兼容渲染器把 *打包产物* 的 Workbench 组件树渲染成真实 DOM，
// 交给 headless Chrome 做真实排版，再用 getBoundingClientRect() 读回坐标。
// 这里刻意不引入 React / jsdom：仓库的依赖面只有宿主提供的包，而 jsdom 不做
// 布局；真实浏览器才是能验证「提示行不引起浮动」的地方。
//
// 渲染器只实现工作台用到的钩子与事件（useState/useRef/useMemo/useEffect），
// 状态更新是同步重渲染 —— 测试在页面 load 前就能拿到矩形结果，因此
// `--dump-dom` 无需等待异步任务。

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

export const SHIM_SOURCE = String.raw`
(() => {
  const hookStores = new Map();
  let hookCtx = null;
  let dirty = false;
  let rendering = false;
  let pendingEffects = [];
  let rootComponent = null;
  let rootProps = null;

  function getStore(path) {
    let store = hookStores.get(path);
    if (!store) {
      store = { slots: [], initialized: new Set(), effects: [], index: 0 };
      hookStores.set(path, store);
    }
    store.index = 0;
    return store;
  }
  function nextSlot() {
    return hookCtx.index++;
  }
  function readSlot(i, init) {
    const store = hookCtx;
    if (!store.initialized.has(i)) {
      store.slots[i] = typeof init === "function" ? init() : init;
      store.initialized.add(i);
    }
    return store.slots[i];
  }

  const React = {
    Fragment: Symbol("Fragment"),
    createElement(type, props, ...children) {
      const merged = { ...(props || {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged };
    },
    useState(init) {
      const i = nextSlot();
      const store = hookCtx;
      readSlot(i, init);
      const set = (next) => {
        const value = typeof next === "function" ? next(store.slots[i]) : next;
        if (Object.is(value, store.slots[i])) return;
        store.slots[i] = value;
        schedule();
      };
      return [store.slots[i], set];
    },
    useRef(init) {
      const i = nextSlot();
      return readSlot(i, () => ({ current: init }));
    },
    useMemo(fn) {
      nextSlot();
      return fn();
    },
    useCallback(fn) {
      nextSlot();
      return fn;
    },
    useEffect(fn, deps) {
      const i = nextSlot();
      const store = hookCtx;
      let effect = store.effects[i];
      if (!effect) {
        effect = store.effects[i] = { deps: undefined, cleanup: undefined };
      }
      const changed =
        !effect.deps ||
        !deps ||
        deps.length !== effect.deps.length ||
        deps.some((dep, index) => !Object.is(dep, effect.deps[index]));
      if (changed) pendingEffects.push({ effect, fn, deps });
    },
  };

  const jsxRuntime = {
    jsx: (type, props) => ({ type, props: props || {} }),
    jsxs: (type, props) => ({ type, props: props || {} }),
    Fragment: React.Fragment,
  };

  const EVENT_PROPS = {
    onClick: "click",
    onMouseDown: "mousedown",
    onMouseUp: "mouseup",
    onFocus: "focus",
    onBlur: "blur",
    onKeyDown: "keydown",
    onKeyUp: "keyup",
    onInput: "input",
    onMouseEnter: "mouseenter",
    onMouseLeave: "mouseleave",
  };

  const UNITLESS_STYLES = new Set([
    "flex", "flexGrow", "flexShrink", "fontWeight", "lineHeight",
    "opacity", "order", "zIndex", "zoom",
  ]);

  function applyProp(element, key, value, props) {
    if (key === "children" || key === "key") return;
    if (key === "ref") {
      if (typeof value === "function") value(element);
      else if (value !== null && typeof value === "object") value.current = element;
      return;
    }
    if (key === "style") {
      for (const [name, raw] of Object.entries(value || {})) {
        element.style[name] =
          typeof raw === "number" && raw !== 0 && !UNITLESS_STYLES.has(name) ? raw + "px" : raw;
      }
      return;
    }
    if (key === "value" || key === "checked") return;
    if (key === "onChange") {
      const event = element.tagName === "SELECT" || props.type === "checkbox" || props.type === "radio" ? "change" : "input";
      element.addEventListener(event, (native) => value(native));
      return;
    }
    if (EVENT_PROPS[key]) {
      element.addEventListener(EVENT_PROPS[key], (native) => value(native));
      return;
    }
    if (key === "tabIndex") {
      element.tabIndex = value;
      return;
    }
    if (key === "inputMode") {
      element.setAttribute("inputmode", value);
      return;
    }
    if (
      key === "role" ||
      key.startsWith("aria-") ||
      key === "type" ||
      key === "id" ||
      key === "placeholder" ||
      key === "title" ||
      key === "list" ||
      key === "name"
    ) {
      element.setAttribute(key, value === false ? "false" : String(value));
      return;
    }
    if (key === "disabled" || key === "readOnly") {
      element[key] = Boolean(value);
      return;
    }
    if (key === "className") {
      element.className = value;
      return;
    }
    element[key] = value;
  }

  function flatten(children, out) {
    if (children === null || children === undefined || typeof children === "boolean") return out;
    if (Array.isArray(children)) {
      for (const child of children) flatten(child, out);
      return out;
    }
    out.push(children);
    return out;
  }

  function renderVNode(vnode, path) {
    if (vnode === null || vnode === undefined || typeof vnode === "boolean") return document.createTextNode("");
    if (typeof vnode === "string" || typeof vnode === "number") return document.createTextNode(String(vnode));
    if (Array.isArray(vnode)) {
      const fragment = document.createDocumentFragment();
      vnode.forEach((child, index) => fragment.appendChild(renderVNode(child, path + "/" + index)));
      return fragment;
    }
    if (typeof vnode.type === "function") {
      const previous = hookCtx;
      hookCtx = getStore(path);
      let output;
      try {
        output = vnode.type(vnode.props || {});
      } finally {
        hookCtx = previous;
      }
      return renderVNode(output, path + "/@");
    }
    if (typeof vnode.type === "symbol") return renderVNode(vnode.props?.children, path + "/f");
    const element = document.createElement(vnode.type);
    const props = vnode.props || {};
    for (const [key, value] of Object.entries(props)) applyProp(element, key, value, props);
    const children = flatten(props.children, []);
    children.forEach((child, index) => element.appendChild(renderVNode(child, path + "/" + index)));
    if ("value" in props) element.value = props.value === null || props.value === undefined ? "" : String(props.value);
    if ("checked" in props) element.checked = Boolean(props.checked);
    return element;
  }

  function flushEffects() {
    const queued = pendingEffects;
    pendingEffects = [];
    for (const item of queued) {
      if (typeof item.effect.cleanup === "function") {
        try {
          item.effect.cleanup();
        } catch (error) {
          console.error(error);
        }
      }
      item.effect.deps = item.deps;
      let cleanup;
      try {
        cleanup = item.fn();
      } catch (error) {
        console.error(error);
      }
      item.effect.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
  }

  function mount(component, props) {
    rootComponent = component;
    rootProps = props;
    if (rendering) {
      dirty = true;
      return;
    }
    rendering = true;
    try {
      for (let pass = 0; pass < 25; pass++) {
        dirty = false;
        const root = document.getElementById("root");
        root.replaceChildren(renderVNode({ type: component, props }, "root"));
        flushEffects();
        if (!dirty) break;
      }
    } finally {
      rendering = false;
    }
  }

  function schedule() {
    dirty = true;
    if (!rendering && rootComponent !== null) mount(rootComponent, rootProps);
  }

  window.__renderComponent = mount;
  window.__ModuleLoader__ = {
    load: ({ factory }) => {
      const require = (spec) => {
        if (spec === "react") return React;
        if (spec === "react/jsx-runtime") return jsxRuntime;
        throw new Error("unexpected host require: " + spec);
      };
      window.__CLIENT__ = factory(require);
    },
  };
})();
`;

export const FIXTURE_SOURCE = String.raw`
(() => {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  const route = {
    id: "preview-model-existing",
    name: "preview-model-existing",
    contextWindow: 131072,
    maxTokens: 8192,
    input: ["text"],
    reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
  };
  const providers = { "preview-chat": route };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true };
  const configForms = { get: () => scope };
  let Workbench;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms: { get: () => scope, whileServed: (namespaces, register) => register(new Set(namespaces)) },
    slots: {
      inject: (name, register) => register(),
      register: (spec, component) => {
        Workbench = component;
        return () => {};
      },
    },
  };
  client.apply(ctx);
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, { configForms });

  const byPlaceholder = (placeholder) => [...document.querySelectorAll("input")].find((el) => el.placeholder === placeholder);
  const cwInput = () => byPlaceholder("如 131072");
  const mtInput = () => byPlaceholder("如 8192");
  const modelInput = () => byPlaceholder("如 tflow/alpha-32b");
  const displayInput = () => byPlaceholder("留空则不写");
  const routeSelect = () => document.querySelector("select");
  const fieldOf = (input) => input.closest("label");
  const toggleOf = (input) => fieldOf(input).querySelector('button[aria-label="展开候选"]');
  const optionsOf = (input) => [...fieldOf(input).querySelectorAll('[role="option"]')];
  const optionNumber = (option) => option.innerText.trim().split(/\s+/)[0];
  const activeOption = (input) => optionsOf(input).find((option) => option.getAttribute("aria-selected") === "true");
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return {
      top: Number(box.top.toFixed(2)),
      bottom: Number(box.bottom.toFixed(2)),
      left: Number(box.left.toFixed(2)),
      width: Number(box.width.toFixed(2)),
      height: Number(box.height.toFixed(2)),
    };
  };
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const result = {};
  result.emptyTop = rect(cwInput()).top;
  result.emptyHint = fieldOf(cwInput()).innerText.includes("K");

  setValue(cwInput(), "131072");
  setValue(mtInput(), "8192");
  result.filledTop = rect(cwInput()).top;
  result.hints = {
    contextWindow: fieldOf(cwInput()).innerText.includes("131K"),
    maxTokens: fieldOf(mtInput()).innerText.includes("8K"),
  };
  result.row1Tops = {
    route: rect(routeSelect()).top,
    model: rect(modelInput()).top,
    display: rect(displayInput()).top,
  };

  toggleOf(cwInput()).click();
  result.contextCandidates = optionsOf(cwInput()).map(optionNumber);
  result.contextActive = activeOption(cwInput()) ? optionNumber(activeOption(cwInput())) : null;
  result.contextPanelOpen = optionsOf(cwInput()).length;

  const clicked = optionsOf(cwInput()).find((option) => optionNumber(option) === "200000");
  clicked.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  result.afterPick = { value: cwInput().value, panelOpen: optionsOf(cwInput()).length };

  toggleOf(mtInput()).click();
  result.maxCandidates = optionsOf(mtInput()).map(optionNumber);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  result.escapeClosed = optionsOf(mtInput()).length === 0;

  toggleOf(cwInput()).click();
  result.outsideBefore = optionsOf(cwInput()).length;
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  result.outsideClosed = optionsOf(cwInput()).length === 0;

  result.beforeErrorTop = rect(cwInput()).top;
  result.invalid = [];
  for (const bad of ["abc", "-1", "0"]) {
    setValue(cwInput(), bad);
    result.invalid.push({
      input: bad,
      value: cwInput().value,
      top: rect(cwInput()).top,
      message: fieldOf(cwInput()).innerText.includes("请输入正整数"),
    });
  }

  setValue(cwInput(), "");
  result.cleared = {
    top: rect(cwInput()).top,
    hintGone: !fieldOf(cwInput()).innerText.includes("200K"),
  };

  result.datalists = document.querySelectorAll("datalist").length;
  result.inputMode = cwInput().getAttribute("inputmode");
  result.finalRow1Tops = {
    route: rect(routeSelect()).top,
    model: rect(modelInput()).top,
    display: rect(displayInput()).top,
  };
  document.getElementById("result").textContent = JSON.stringify(result);
})();
`;

/** 组装一个完全自包含的 file:// 测试页：React 桩 → 打包产物 → 交互与测量。 */
export function buildLayoutHtml(bundleSource) {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" />',
    "<style>body { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }</style>",
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${FIXTURE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}

// ── 工单 #20：深色主题回归夹具 ────────────────────────────────────────────
//
// 宿主在 <body> 上写入这些 --dsw-* token，并把 documentElement 的
// color-scheme 设成当前主题。夹具里复刻这两件事，才能测到真实 token 解析，
// 而不是所有 var() 都走 fallback。

export const THEME_TOKENS = Object.freeze({
  light: Object.freeze({
    "--dsw-alias-bg-base": "#ffffff",
    "--dsw-alias-bg-layer-1": "#f7f8fa",
    "--dsw-alias-border-l2": "#0000001a",
    "--dsw-alias-border-l4": "#00000026",
    "--dsw-alias-label-primary": "#1a1a1a",
    "--dsw-alias-label-primary-foreground": "#ffffff",
    "--dsw-alias-label-tertiary": "#8a8a8a",
    "--dsw-alias-state-error-primary": "#d93026",
    "--dsw-alias-state-error-secondary": "#d9302620",
    "--dsw-alias-state-warn-secondary": "#b7791f57",
    "--dsw-alias-state-warn-tertiary": "#b7791f1f",
    "--dsw-alias-state-success-primary": "#2f855a",
    "--dsw-alias-state-success-secondary": "#2f855a1f",
    "--dsw-alias-markdown-code-block": "#f2f3f5",
    "--dsw-alias-interactive-bg-hover": "#0000000d",
    "--dsw-alias-button-primary-fill": "#0f1115",
    "--dsw-alias-state-business-primary": "#3b6fd4",
  }),
  dark: Object.freeze({
    "--dsw-alias-bg-base": "#1b1c1f",
    "--dsw-alias-bg-layer-1": "#232529",
    "--dsw-alias-border-l2": "#ffffff1f",
    "--dsw-alias-border-l4": "#ffffff29",
    "--dsw-alias-label-primary": "#ececf0",
    "--dsw-alias-label-primary-foreground": "#0f1115",
    "--dsw-alias-label-tertiary": "#9a9ba0",
    "--dsw-alias-state-error-primary": "#f0736a",
    "--dsw-alias-state-error-secondary": "#f0736a26",
    "--dsw-alias-state-warn-secondary": "#e0b2525c",
    "--dsw-alias-state-warn-tertiary": "#e0b25224",
    "--dsw-alias-state-success-primary": "#6cc48d",
    "--dsw-alias-state-success-secondary": "#6cc48d24",
    "--dsw-alias-markdown-code-block": "#1f2125",
    "--dsw-alias-interactive-bg-hover": "#ffffff12",
    "--dsw-alias-button-primary-fill": "#f9fafb",
    "--dsw-alias-state-business-primary": "#7aa4ee",
  }),
});

function themeRule(scheme) {
  const declarations = Object.entries(THEME_TOKENS[scheme])
    .map(([name, value]) => `    ${name}: ${value};`)
    .join("\n");
  return `  :root[data-scheme="${scheme}"] {\n    color-scheme: ${scheme};\n${declarations}\n  }`;
}

/** 最小 token 集：light / dark 各自定义，并让 body 使用底色与主文字。 */
export const THEME_TOKEN_FIXTURE = [
  themeRule("light"),
  themeRule("dark"),
  "  html, body { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }",
].join("\n");

/** 深色场景：填模型 ID、触发非法 token 输入、展开候选面板，然后读回计算样式。 */
export const THEME_PROBE_SOURCE = String.raw`
(async () => {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  const route = {
    id: "preview-model-existing",
    name: "preview-model-existing",
    baseURL: "https://preview.invalid/v1",
    models: [],
    contextWindow: 131072,
    maxTokens: 8192,
    input: ["text"],
    reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
  };
  const providers = { "preview-chat": route };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true };
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
      llm: {
        discoverModels: async () => ({
          ok: true,
          value: [{ id: "alpha/one" }, { id: "beta/two" }, { id: "gamma/three" }],
        }),
      },
      // 工单 #18：密钥区块的宿主管道；布局 / 主题夹具只关心它不抛错。
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

  const byPlaceholder = (placeholder) => [...document.querySelectorAll("input")].find((el) => el.placeholder === placeholder);
  const cwInput = () => byPlaceholder("如 131072");
  const mtInput = () => byPlaceholder("如 8192");
  const modelInput = () => byPlaceholder("如 tflow/alpha-32b");
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const fieldOf = (input) => input.closest("label");

  setValue(modelInput(), "tflow/alpha-32b");
  setValue(cwInput(), "131072");
  setValue(mtInput(), "8192");
  // 非法值：不写入状态，显示红色「请输入正整数」，用于测量错误色对比度。
  setValue(cwInput(), "abc");
  fieldOf(cwInput()).querySelector('button[aria-label="展开候选"]').click();

  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return {
      top: Number(box.top.toFixed(2)),
      height: Number(box.height.toFixed(2)),
    };
  };
  const parseColor = (text) => {
    const match = String(text).match(/rgba?\(([^)]+)\)/);
    if (!match) return { r: 0, g: 0, b: 0, a: 0 };
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (foreground, background) => {
    const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };
  // 把元素的半透明背景逐层合成到第一个不透明祖先上（按钮底色是半透明 token）。
  const effectiveBackground = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color.a > 0) layers.push(color);
      if (color.a === 1) break;
    }
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (let index = layers.length - 1; index >= 0; index--) background = over(layers[index], background);
    return background;
  };

  const style = (element) => getComputedStyle(element);

  // 所有使用 s.btnPrimary 的按钮都带 --dsw-alias-button-primary-fill 内联样式；
  // 逐个算真实前景/背景对比度，未来新增的 primary 按钮自动纳入。
  const primaryButtons = () =>
    [...document.querySelectorAll("button")].filter((element) =>
      (element.getAttribute("style") ?? "").includes("--dsw-alias-button-primary-fill"));
  const primaryInfo = (element) => {
    const color = style(element).color;
    return {
      text: (element.textContent || "").trim(),
      color,
      background: style(element).backgroundColor,
      ratio: Number(contrast(parseColor(color), effectiveBackground(element)).toFixed(2)),
    };
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const buttonByText = (text) =>
    [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === text);

  const primary = {};
  primary.main = primaryButtons().map(primaryInfo);

  // 打开选择器（拉取 3 个候选），勾 2 个后读取「确定（2）」按钮的对比度。
  buttonByText("拉取").click();
  await sleep(30);
  document.querySelector('input[aria-label="alpha/one"]').click();
  document.querySelector('input[aria-label="beta/two"]').click();
  primary.picker = primaryButtons().map(primaryInfo);

  // 确认只生成待写入区块；读取区块里的「写入」按钮与主按钮的对比度。
  const confirm = [...document.querySelectorAll("button")].find((element) => element.textContent.trim().startsWith("确定（"));
  confirm.click();
  primary.pending = primaryButtons().map(primaryInfo);

  // 异步操作（拉取 / 勾选 / 确认）会让最小渲染器重建 DOM，元素必须在最终
  // 状态之后再取，否则拿到的是已脱离文档的旧节点。勾选时的点击会冒泡到
  // document，关闭 token 候选面板 —— 重新打开后再量它的 token 底色。
  fieldOf(cwInput()).querySelector('button[aria-label="展开候选"]').click();
  const select = document.querySelector("select");
  const input = cwInput();
  const checkbox = document.querySelector('input[type="checkbox"]');
  const chip = checkbox.closest("label");
  const panel = document.querySelector('[role="listbox"]');
  const pre = document.querySelector("pre");
  const error = [...document.querySelectorAll("span")].find((node) => node.textContent.trim() === "请输入正整数");

  let worst = { ratio: Infinity, where: "" };
  for (const element of document.querySelectorAll("span, label, button, p, option")) {
    const text = (element.textContent || "").trim();
    if (text === "") continue;
    if (element.closest("button[disabled]")) continue;
    const ratio = contrast(parseColor(style(element).color), effectiveBackground(element));
    if (ratio < worst.ratio) worst = { ratio: Number(ratio.toFixed(2)), where: element.tagName + ":" + text.slice(0, 24) };
  }

  const result = {
    scheme: style(document.documentElement).colorScheme,
    select: {
      background: style(select).backgroundColor,
      color: style(select).color,
      colorScheme: style(select).colorScheme,
    },
    input: {
      background: style(input).backgroundColor,
      color: style(input).color,
      colorScheme: style(input).colorScheme,
    },
    checkbox: { colorScheme: style(checkbox).colorScheme },
    chip: { background: style(chip).backgroundColor },
    panel: {
      background: style(panel).backgroundColor,
      color: style(panel).color,
    },
    pre: { background: style(pre).backgroundColor },
    error: { color: style(error).color },
    primary,
    contrast: worst,
    rects: {
      selectH: rect(select).height,
      selectTop: rect(select).top,
      modelTop: rect(modelInput()).top,
      displayTop: rect(byPlaceholder("留空则不写")).top,
      contextTop: rect(cwInput()).top,
      maxTop: rect(mtInput()).top,
      panelTop: rect(panel).top,
      pageHeight: Number(document.getElementById("root").getBoundingClientRect().height.toFixed(2)),
    },
  };
  document.getElementById("result").textContent = JSON.stringify(result);
})();
`;

/** 以指定主题组装工作台页面（token 由 THEME_TOKEN_FIXTURE 提供）。 */
export function buildThemeHtml(bundleSource, scheme) {
  if (!Object.hasOwn(THEME_TOKENS, scheme)) throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${THEME_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}

/**
 * 以指定主题渲染工作台，返回可交给 headless Chrome 查询的页面描述。
 * 默认读取构建后的 lib/client.js，测试也可注入自己的 bundle 源码。
 */
export async function openWorkbenchInTheme(scheme, options = {}) {
  if (!Object.hasOwn(THEME_TOKENS, scheme)) throw new TypeError(`未知主题：${scheme}`);
  const bundleSource = options.bundleSource ?? readFileSync(join(root, "lib", "client.js"), "utf8");
  return { scheme, tokens: THEME_TOKENS[scheme], html: buildThemeHtml(bundleSource, scheme) };
}

/** 找可用的 Chrome/Chromium；找不到返回 null。 */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 10_000 });
    if (probe.status === 0) return candidate;
  }
  return null;
}

/** 在 headless Chrome 里加载页面，读回 <pre id="result"> 里的 JSON。 */
export function runPageProbe(chrome, html) {
  const dir = mkdtempSync(join(tmpdir(), "modelpilot-page-"));
  const page = join(dir, "index.html");
  writeFileSync(page, html);
  try {
    const run = spawnSync(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--allow-file-access-from-files",
        "--window-size=1440,1000",
        "--virtual-time-budget=10000",
        "--dump-dom",
        pathToFileURL(page).href,
      ],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024 },
    );
    if (run.error) throw new Error(`chrome failed to start: ${run.error.message}`);
    const match = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    if (!match) throw new Error(`probe result missing. stderr: ${run.stderr?.slice(-2000)}`);
    return JSON.parse(decodeText(match[1]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 解析 --dump-dom 的文本节点转义，仅处理测量结果里可能出现的字符。 */
export function decodeText(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
