// 工单 #19 的浏览器夹具：模型拖动排序 + 键盘排序。
//
// 与 model-edit-harness 同一套最小 React 渲染器：把打包后的 Workbench 渲染
// 成真实 DOM，在 headless Chrome 里派发真实 DragEvent / KeyboardEvent，读回
// 列表顺序、mutate 参数、插入线计算样式与手柄状态。断言在
// model-reorder.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/** 浅色 / 深色各自的品牌色 token：插入线必须消费它，而不是写死颜色。 */
export const BRAND_TOKENS = Object.freeze({
  light: "#3b6fd4",
  dark: "#7aa4ee",
});

function brandRule(scheme) {
  return `  :root[data-scheme="${scheme}"] { --dsw-alias-brand-primary: ${BRAND_TOKENS[scheme]}; }`;
}

export const MODEL_REORDER_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  const route = {
    id: "preview-chat",
    name: "preview-chat",
    baseURL: "https://preview.invalid/v1",
    models: [
      {
        id: "jxf/dsv4.1-flash",
        name: "jxf/dsv4.1-flash",
        contextWindow: 1000000,
        maxTokens: 32768,
        input: ["text"],
        compat: { supportsReasoningEffort: true, nested: { keep: true } },
        futureHostField: { keep: ["exactly", "these"] },
      },
      { id: "jxf/dsv4.1-pro", name: "jxf/dsv4.1-pro", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
      { id: "tx/deepseek-v4.1-flash", name: "tx/deepseek-v4.1-flash", contextWindow: 128000, maxTokens: 8192, input: ["text"] },
      { id: "qwen/complete", name: "qwen/complete", contextWindow: 262144, maxTokens: 8192, input: ["text"] },
    ],
  };
  const singleRoute = {
    id: "single-route",
    baseURL: "https://single.invalid/v1",
    models: [{ id: "only/one", input: ["text"] }],
  };
  const providers = { "preview-chat": route, "single-route": singleRoute };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const mutations = [];
  let failNext = false;
  const setPath = (root, path, value) => {
    let node = root;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    node[path[path.length - 1]] = value;
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => {
      const copy = JSON.parse(JSON.stringify(ops));
      mutations.push(copy);
      if (failNext) {
        failNext = false;
        return false;
      }
      for (const op of copy) {
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
    remote: { llm: { discoverModels: async () => ({ ok: true, value: [] }) } },
  };
  client.apply(ctx);
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, spec.inject());

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rows = () => [...document.querySelectorAll('[aria-label^="模型 "]')];
  const listOrder = () => rows().map((row) => row.getAttribute("aria-label").slice(3));
  const rowByModel = (id) => rows().find((row) => row.getAttribute("aria-label") === "模型 " + id);
  const handleByIndex = (index) => document.getElementById("modelpilot-model-handle-" + index);
  const ordinals = () => rows().map((row) => (row.querySelector("span")?.textContent ?? "").trim());
  const positions = () => rows().map((row) => ({
    id: row.getAttribute("aria-label").slice(3),
    ordinal: (row.querySelector("span")?.textContent ?? "").trim(),
  }));
  const panelText = () => document.querySelector('[aria-label="该路由的模型列表"]')?.innerText ?? "";
  const dragStart = (handle) => {
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    return dataTransfer;
  };
  const dragOver = (row, dataTransfer, fraction) => {
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * fraction,
    }));
  };
  const dropOn = (row, dataTransfer, fraction) => {
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * fraction,
    }));
  };
  const press = (element, key) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };

  // ── 1. 初始：每行都有手柄 + 只读序号；拖到第三条下半区显示插入线 ──
  result.initial = {
    order: listOrder(),
    ordinals: ordinals(),
    positions: positions(),
    handles: [...document.querySelectorAll('[aria-label^="拖动排序 第 "]')].map((button) => button.getAttribute("aria-label")),
    handleIds: [0, 1, 2, 3].map((index) => handleByIndex(index)?.id ?? ""),
    handleDraggable: [0, 1, 2, 3].map((index) => handleByIndex(index)?.draggable === true),
    handleText: handleByIndex(0)?.textContent.trim() ?? "",
    mutations: mutations.length,
  };

  const firstDrag = dragStart(handleByIndex(0));
  result.dragStart = {
    opacity: getComputedStyle(rowByModel("jxf/dsv4.1-flash")).opacity,
    insertLine: document.querySelector('[title="插入位置"]') !== null,
    mutations: mutations.length,
  };
  dragOver(rowByModel("tx/deepseek-v4.1-flash"), firstDrag, 0.75);
  const line = document.querySelector('[title="插入位置"]');
  result.dragOver = {
    insertLine: line !== null,
    background: line === null ? "" : getComputedStyle(line).backgroundColor,
    height: line === null ? "" : getComputedStyle(line).height,
    position: line === null ? "" : getComputedStyle(line).position,
    mutations: mutations.length,
  };

  // ── 2. 拖动中按 Esc：不写盘，顺序保持 ──
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  dropOn(rowByModel("tx/deepseek-v4.1-flash"), firstDrag, 0.75);
  result.escape = {
    mutations: mutations.length,
    order: listOrder(),
    insertLine: document.querySelector('[title="插入位置"]') !== null,
  };

  // ── 3. 拖动第一条到第三条之后：松手立即一次 mutate，整数组重写 ──
  const secondDrag = dragStart(handleByIndex(0));
  dragOver(rowByModel("tx/deepseek-v4.1-flash"), secondDrag, 0.75);
  dropOn(rowByModel("tx/deepseek-v4.1-flash"), secondDrag, 0.75);
  await sleep(30);
  result.drop = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    order: listOrder(),
    ordinals: ordinals(),
    positions: positions(),
    panelText: panelText(),
    snapshotOrder: providers["preview-chat"].models.map((model) => model.id),
    compat: JSON.parse(JSON.stringify(providers["preview-chat"].models.find((model) => model.id === "jxf/dsv4.1-flash")?.compat ?? null)),
    futureHostField: JSON.parse(JSON.stringify(providers["preview-chat"].models.find((model) => model.id === "jxf/dsv4.1-flash")?.futureHostField ?? null)),
    draggingOpacityGone: getComputedStyle(rowByModel("jxf/dsv4.1-flash")).opacity,
    insertLineGone: document.querySelector('[title="插入位置"]') === null,
  };

  // ── 4. 键盘 ↑ / ↓：每次立即写盘，焦点留在移动后的手柄上 ──
  handleByIndex(1).focus();
  press(handleByIndex(1), "ArrowDown");
  await sleep(30);
  result.arrowDown = {
    mutations: mutations.length,
    order: listOrder(),
    toast: document.body.innerText.includes("已把"),
  };
  press(handleByIndex(2), "ArrowUp");
  await sleep(30);
  result.arrowUp = {
    mutations: mutations.length,
    order: listOrder(),
  };

  // ── 5. Home / End：移到首 / 末位 ──
  handleByIndex(3).focus();
  press(handleByIndex(3), "Home");
  await sleep(30);
  result.home = {
    mutations: mutations.length,
    order: listOrder(),
  };
  press(handleByIndex(0), "End");
  await sleep(30);
  result.end = {
    mutations: mutations.length,
    order: listOrder(),
  };

  // ── 6. mutate 失败：列表保持移动前顺序，显示错误 toast ──
  const beforeFailure = listOrder();
  const mutationsBeforeFailure = mutations.length;
  failNext = true;
  handleByIndex(1).focus();
  press(handleByIndex(1), "ArrowUp");
  await sleep(30);
  result.failure = {
    attempted: mutations.length - mutationsBeforeFailure,
    before: beforeFailure,
    after: listOrder(),
    toast: document.body.innerText.includes("排序未保存"),
  };

  // ── 7. 重排成功后收起打开中的行内编辑：编辑按下标定位，下标已变 ──
  const firstEditButton = document.querySelector('[aria-label^="编辑模型 "]');
  firstEditButton.click();
  const editorOpenBefore = document.querySelector('[aria-label^="编辑表单 "]') !== null;
  handleByIndex(0).focus();
  press(handleByIndex(0), "ArrowDown");
  await sleep(30);
  result.editorAfterMove = {
    editorOpenBefore,
    editorOpenAfter: document.querySelector('[aria-label^="编辑表单 "]') !== null,
    mutations: mutations.length,
    order: listOrder(),
  };

  // ── 8. 只有一个模型：手柄禁用 ──
  const routeSelect = document.querySelector("select");
  routeSelect.value = "single-route";
  routeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(20);
  const singleHandle = handleByIndex(0);
  result.single = {
    rows: rows().length,
    order: listOrder(),
    label: singleHandle?.getAttribute("aria-label") ?? "",
    disabled: singleHandle?.disabled === true,
    draggable: singleHandle?.draggable === true,
    mutating: mutations.length,
  };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装模型排序页。 */
export function buildModelReorderHtml(bundleSource, scheme) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n${brandRule(scheme)}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${MODEL_REORDER_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
