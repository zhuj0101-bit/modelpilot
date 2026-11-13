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
