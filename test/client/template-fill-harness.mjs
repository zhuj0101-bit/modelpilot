// 工单 #29 的浏览器夹具：编辑表单 / 新增表单的「填入默认模板」按钮。
//
// 与 model-edit-harness 相同的思路：打包后的 Workbench 由最小 React 兼容渲染器
// 渲染成真实 DOM，在 headless Chrome 里做真实点击并读回字段、投影 ops 与计算样式。
// 默认模板通过 window.localStorage 的注入桩在首次渲染前就位 —— Workbench 在
// useState 初始化时读取它，因此不能等到渲染之后再写。
//
// 三个场景各自使用独立页面：
// - with：已保存模板（窗口 / 输出 / 两个模态 / off,low）
// - none：没有模板（按钮必须禁用并说明）
// - empty：模板里 token 为空、档位为空（整体替换语义）

import { THEME_TOKEN_FIXTURE, SHIM_SOURCE } from "./layout-harness.mjs";
import { MODEL_EDIT_ROUTE_SOURCE } from "./model-edit-harness.mjs";

/** 场景种子：完整模板。 */
export const TEMPLATE_SEED = Object.freeze({
  version: 1,
  contextWindow: "131072",
  maxTokens: "8192",
  inputText: true,
  inputImage: true,
  reasoningLevels: ["off", "low"],
});

/** 场景种子：空 token、空档位 —— 填入后表单字段应如实清空。 */
export const EMPTY_TOKEN_TEMPLATE_SEED = Object.freeze({
  version: 1,
  contextWindow: "",
  maxTokens: "",
  inputText: true,
  inputImage: false,
  reasoningLevels: [],
});

export const TEMPLATE_FILL_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  // 注入内存 storage：必须在 Workbench 首次渲染（useState 初始化）前完成。
  const seed = window.__TEMPLATE_SEED__;
  const store = new Map();
  if (seed !== null) store.set("modelpilot.default-template.v1", JSON.stringify(seed));
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
  const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
  const buttons = () => [...document.querySelectorAll("button")];
  const buttonByAria = (label) => buttons().find((element) => element.getAttribute("aria-label") === label);
  const buttonByText = (text) => buttons().find((element) => element.textContent.trim() === text);
  const editor = () => document.querySelector('[aria-label^="编辑表单"]');
  const editorFill = () => editor() === null ? undefined : editor().querySelector('[aria-label="填入默认模板"]');
  const createFill = () =>
    buttons().find((element) => element.getAttribute("aria-label") === "填入默认模板" && element.closest('[aria-label^="编辑表单"]') === null);
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const createCheckbox = (text) =>
    [...document.querySelectorAll("label")].find(
      (element) => element.textContent.trim() === text && element.querySelector("input[aria-label]") === null,
    )?.querySelector("input");
  const createLevels = () =>
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].filter((level) => createCheckbox(level)?.checked);
  const createState = () => ({
    contextWindow: byAria("上下文窗口").value,
    maxTokens: byAria("输出上限").value,
    text: createCheckbox("text")?.checked ?? null,
    image: createCheckbox("image")?.checked ?? null,
    levels: createLevels(),
  });
  const editorState = () => {
    const root = editor();
    if (root === null) return null;
    return {
      name: byAria("编辑显示名").value,
      contextWindow: byAria("编辑上下文窗口").value,
      maxTokens: byAria("编辑输出上限").value,
      text: byAria("编辑输入模态 text").checked,
      image: byAria("编辑输入模态 image").checked,
      levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        .filter((level) => byAria("编辑档位 " + level)?.checked),
    };
  };
  const editorLine = (prefix) =>
    (editor()?.innerText ?? "").split("\n").find((line) => line.startsWith(prefix)) ?? "";
  const editorHint = () => {
    const spans = [...(editor()?.querySelectorAll("span") ?? [])];
    const node = spans.find((element) => element.textContent.startsWith("默认模板："))
      ?? spans.find((element) => element.textContent.startsWith("尚未设置默认模板"));
    return node?.innerText ?? "";
  };
  const createHint = () => {
    const spans = [...document.querySelectorAll("span")];
    const node = spans.find((element) => element.textContent.startsWith("默认模板："))
      ?? spans.find((element) => element.textContent.startsWith("尚未设置默认模板"));
    return node?.innerText ?? "";
  };
  const editorOps = () => {
    const pre = editor()?.querySelector("pre");
    return pre === null || pre === undefined ? [] : JSON.parse(pre.textContent);
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
    return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
  };
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
  const styleOf = (element) => getComputedStyle(element);

  const result = { scheme: styleOf(document.documentElement).colorScheme };

  // ── 新增表单：挂载后是否按模板预填、按钮是否可用、提示行 ──
  result.create = {
    initial: createState(),
    fill: {
      disabled: createFill().disabled,
      text: createFill().textContent.trim(),
      inlineStyle: createFill().getAttribute("style") ?? "",
      color: styleOf(createFill()).color,
      ratio: contrast(parseColor(styleOf(createFill()).color), effectiveBackground(createFill())),
    },
    hintLine: createHint(),
  };
  result.create.sameRow = createFill().parentElement === buttonByText("存为默认模板").parentElement;
  const createBeforeClick = createState();
  createFill().click();
  result.create.clickNoop = JSON.stringify(createState()) === JSON.stringify(createBeforeClick);

  // ── 新增表单：清空 → 填入默认模板 ──
  buttonByText("清空").click();
  result.create.afterClear = createState();
  setValue(byAria("上下文窗口"), "55555");
  setValue(byAria("输出上限"), "4444");
  createCheckbox("image").click();
  createCheckbox("medium").click();
  result.create.mutated = createState();
  createFill().click();
  result.create.afterFill = createState();

  // ── 编辑表单：初始按钮 / 摘要 ──
  byAria("编辑模型 jxf/dsv4.1-flash").click();
  result.edit = {
    initial: {
      state: editorState(),
      fill: {
        disabled: editorFill().disabled,
        text: editorFill().textContent.trim(),
        inlineStyle: editorFill().getAttribute("style") ?? "",
        color: styleOf(editorFill()).color,
        ratio: contrast(parseColor(styleOf(editorFill()).color), effectiveBackground(editorFill())),
      },
      hint: editorHint(),
      changedLine: editorLine("改动字段："),
      saveDisabled: byAria("保存修改").disabled,
    },
    theme: {},
  };

  // ── 点「填入默认模板」：五个字段、显示名、改动字段、完整行 ops ──
  const editBeforeClick = JSON.stringify(editorState());
  editorFill().click();
  result.edit.initial.clickNoop = JSON.stringify(editorState()) === editBeforeClick
    && editorLine("改动字段：") === result.edit.initial.changedLine;
  result.edit.filled = {
    state: editorState(),
    hint: editorHint(),
    changedLine: editorLine("改动字段："),
    saveDisabled: byAria("保存修改").disabled,
    zeroHint: (editor()?.innerText ?? "").includes("全不选：不修改现有 reasoningEfforts"),
    ops: editorOps(),
  };
  const firstFill = JSON.stringify({ state: result.edit.filled.state, ops: result.edit.filled.ops });

  // 幂等：再点一次，状态与投影不变。
  editorFill().click();
  result.edit.secondFill = {
    state: editorState(),
    ops: editorOps(),
    identical: JSON.stringify({ state: editorState(), ops: editorOps() }) === firstFill,
  };

  // 按钮 / 提示行的 token 与对比度（有模板态）。
  const hintNode = [...editor().querySelectorAll("span")].find((node) => node.textContent.startsWith("默认模板："));
  result.edit.theme = {
    fill: {
      inlineStyle: editorFill().getAttribute("style") ?? "",
      background: styleOf(editorFill()).backgroundColor,
      border: styleOf(editorFill()).borderTopColor,
      color: styleOf(editorFill()).color,
      opacity: styleOf(editorFill()).opacity,
      ratio: contrast(parseColor(styleOf(editorFill()).color), effectiveBackground(editorFill())),
    },
    hint: hintNode === undefined ? null : {
      text: hintNode.innerText,
      color: styleOf(hintNode).color,
      opacity: styleOf(hintNode).opacity,
      ratio: contrast(parseColor(styleOf(hintNode).color), effectiveBackground(hintNode)),
    },
  };

  // 取消不写入。
  byAria("取消编辑").click();
  result.edit.cancelled = {
    editorOpen: editor() !== null,
    mutations: mutations.length,
  };

  // ── 填模板后保存：一条 set，完整行 + compat ──
  byAria("编辑模型 jxf/dsv4.1-flash").click();
  editorFill().click();
  result.save = { mutationsBefore: mutations.length, opsBefore: editorOps() };
  byAria("保存修改").click();
  await sleep(30);
  result.save.mutations = mutations.length;
  result.save.lastOps = mutations[mutations.length - 1];
  result.save.savedRow = JSON.parse(JSON.stringify(route.models[0]));
  result.save.listText = document.querySelector('[aria-label="该路由的模型列表"]')?.innerText ?? "";

  // ── 无模板态：按钮禁用样式与提示 ──
  result.disabledTheme = seed === null ? {
    editorFill: {
      disabled: editorFill()?.disabled ?? false,
      inlineStyle: editorFill()?.getAttribute("style") ?? "",
      opacity: styleOf(editorFill()).opacity,
      ratio: contrast(parseColor(styleOf(editorFill()).color), effectiveBackground(editorFill())),
    },
    hint: (() => {
      const node = [...editor().querySelectorAll("span")].find((element) => element.textContent.startsWith("尚未设置默认模板"));
      return node === undefined ? null : {
        text: node.innerText,
        color: styleOf(node).color,
        ratio: contrast(parseColor(styleOf(node).color), effectiveBackground(node)),
      };
    })(),
  } : null;

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题与模板种子组装「填入默认模板」页面。 */
export function buildTemplateFillHtml(bundleSource, scheme, seedTemplate) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  const seed = seedTemplate === null ? "null" : JSON.stringify(seedTemplate);
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
    `<script>window.__TEMPLATE_SEED__ = ${seed};</script>`,
    `<script>${TEMPLATE_FILL_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
