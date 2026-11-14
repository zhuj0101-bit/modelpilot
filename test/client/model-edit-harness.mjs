// 工单 #26 一期的浏览器夹具：模型列表 + 行内编辑 + 删除确认 + 预算提示。
//
// 和 layout-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，再在 headless Chrome 里做真实点击与计算样式测量。
// 这里只放夹具；断言在 model-edit.test.mjs 里。

import { THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";
import { SHIM_SOURCE } from "./layout-harness.mjs";

/** 三条模型：一条普通、一条带 compat、一条无推理档位。 */
export const MODEL_EDIT_ROUTE_SOURCE = String.raw`
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
        reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
        // 宿主会物化空 compat；这不应触发「原样保留」提示。
        compat: { chatTemplateKwargs: {}, chatTemplateArgs: {} },
      },
      {
        id: "jxf/dsv4.1-pro",
        name: "jxf/dsv4.1-pro",
        contextWindow: 1000000,
        maxTokens: 32768,
        input: ["text"],
        reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
        compat: { supportsReasoningEffort: true, nested: { keep: true } },
      },
      {
        id: "tx/deepseek-v4.1-flash",
        name: "tx/deepseek-v4.1-flash",
        contextWindow: 128000,
        maxTokens: 8192,
        input: ["text"],
      },
    ],
  };
`;

export const MODEL_EDIT_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

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
    remote: {
      llm: { discoverModels: async () => ({ ok: true, value: [] }) },
      // 工单 #18：密钥区块注入的宿主管道。夹具默认所有引用都已配置且可写；
      // 具体状态机由 test/client/api-key-harness.mjs 单独覆盖。
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
  const buttonByAria = (label) => buttons().find((element) => element.getAttribute("aria-label") === label);
  const buttonByText = (text) => buttons().find((element) => element.textContent.trim() === text);
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const panelText = () => byAria("该路由的模型列表")?.innerText ?? "";
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
  result.initial = {
    countText: panelText().split("\n")[0],
    summaries: [...document.querySelectorAll('[aria-label^="模型 jxf"], [aria-label^="模型 tx"]')]
      .map((row) => row.innerText),
    editButtons: [...document.querySelectorAll('[aria-label^="编辑模型"]')].map((element) => element.getAttribute("aria-label")),
  };

  // ── 1. 展开第一条：预填、保存禁用、预算提示三档 ──
  byAria("编辑模型 jxf/dsv4.1-flash").click();
  result.edit = {
    contextWindow: byAria("编辑上下文窗口").value,
    maxTokens: byAria("编辑输出上限").value,
    name: byAria("编辑显示名").value,
    saveDisabled: byAria("保存修改").disabled,
    compatNotice: document.body.innerText.includes("该模型还声明了 compat 字段"),
    editorOpen: byAria("编辑表单 jxf/dsv4.1-flash") !== null,
  };
  result.edit.zeroHint = document.body.innerText.includes("可用上下文 800,000（零损失 ✓）");

  setValue(byAria("编辑输出上限"), "150000");
  result.edit.slightHint = document.body.innerText.includes("可用上下文 784,464（比最优少 1.9%）");
  setValue(byAria("编辑输出上限"), "384000");
  result.edit.strongHint = document.body.innerText.includes("⚠ 可用上下文 550,464（比最优少 31.2%）")
    && document.body.innerText.includes("建议 ≤ 134,464 可零损失");
  setValue(byAria("编辑输出上限"), "32768");

  // 只改 maxTokens 时，保存应启用，且 op 预览里能看到合并后的完整行。
  setValue(byAria("编辑输出上限"), "48000");
  result.edit.canSaveAfterChange = !byAria("保存修改").disabled;

  // ── 2. 同时只编辑一条：点第二条，第一条收起；compat 提示出现 ──
  byAria("编辑模型 jxf/dsv4.1-pro").click();
  result.switch = {
    firstEditorGone: byAria("编辑表单 jxf/dsv4.1-flash") === null,
    secondEditorOpen: byAria("编辑表单 jxf/dsv4.1-pro") !== null,
    compatNotice: document.body.innerText.includes("该模型还声明了 compat 字段，保存时会原样保留"),
    saveDisabled: byAria("保存修改").disabled,
    name: byAria("编辑显示名").value,
  };

  result.theme = {
    panel: {
      background: styleOf(byAria("该路由的模型列表")).backgroundColor,
      border: styleOf(byAria("该路由的模型列表")).borderTopColor,
    },
    editor: {
      background: styleOf(byAria("编辑表单 jxf/dsv4.1-pro")).backgroundColor,
    },
    compatibility: (() => {
      const node = [...document.querySelectorAll("div")].find((element) => element.textContent.startsWith("ⓘ 该模型还声明了 compat"));
      return node === undefined ? null : {
        background: styleOf(node).backgroundColor,
        color: styleOf(node).color,
        ratio: contrast(parseColor(styleOf(node).color), effectiveBackground(node)),
      };
    })(),
  };

  // ── 3. 保存 compat 模型：1 条 set，compat 原样保留，列表同步 ──
  setValue(byAria("编辑输出上限"), "48000");
  byAria("保存修改").click();
  await sleep(30);
  result.save = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    compatAfter: JSON.parse(JSON.stringify(route.models[1].compat)),
    listAfter: panelText(),
  };

  // ── 4. 删除二次确认：自绘弹窗、取消、确认后重写数组 ──
  byAria("编辑模型 jxf/dsv4.1-pro").click();
  byAria("删除模型").click();
  result.deleteDialog = {
    open: byAria("删除模型确认") !== null,
    text: byAria("删除模型确认")?.innerText ?? "",
    background: styleOf(byAria("删除模型确认")).backgroundColor,
    color: styleOf(byAria("删除模型确认")).color,
    danger: (() => {
      const button = byAria("确认删除");
      return {
        color: styleOf(button).color,
        background: styleOf(button).backgroundColor,
        ratio: contrast(parseColor(styleOf(button).color), effectiveBackground(button)),
      };
    })(),
  };
  byAria("取消删除").click();
  result.deleteDialog.cancelled = byAria("删除模型确认") === null;

  byAria("编辑模型 jxf/dsv4.1-pro").click();
  byAria("删除模型").click();
  byAria("确认删除").click();
  await sleep(30);
  result.remove = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    listAfter: panelText(),
    modelsLength: route.models.length,
  };

  // ── 5. stale-index：编辑期间配置被别处改动，保存必须禁用并提示重试 ──
  byAria("编辑模型 jxf/dsv4.1-flash").click();
  const before = route.models[0];
  route.models[0] = { ...before, id: "someone/else" };
  byAria("编辑档位 minimal").click();
  result.stale = {
    message: document.body.innerText.includes("已失效"),
    saveDisabled: byAria("保存修改").disabled,
    opCount: (() => {
      const summary = [...document.querySelectorAll("summary")].find((element) => element.textContent.includes("保存将写入的 settingsOps"));
      return summary?.textContent ?? "";
    })(),
  };
  route.models[0] = before;

  // ── 6. 预算提示的计算样式（当前编辑行仍是 1M / 32K → 零损失） ──
  const budgetNode = [...document.querySelectorAll('[role="status"]')]
    .find((element) => element.textContent.includes("可用上下文"));
  result.theme.budget = budgetNode === undefined ? null : {
    text: budgetNode.innerText,
    color: styleOf(budgetNode).color,
    ratio: contrast(parseColor(styleOf(budgetNode).color), effectiveBackground(budgetNode)),
  };

  // ── 7. 删到 0 条：列表显示空态，不崩 ──
  byAria("取消编辑")?.click();
  for (const id of ["jxf/dsv4.1-flash", "tx/deepseek-v4.1-flash"]) {
    byAria("编辑模型 " + id)?.click();
    byAria("删除模型")?.click();
    byAria("确认删除")?.click();
    await sleep(30);
  }
  result.empty = {
    countText: panelText().split("\n")[0],
    message: document.body.innerText.includes("该路由没有模型"),
    modelsLength: route.models.length,
  };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装模型编辑页。 */
export function buildModelEditHtml(bundleSource, scheme) {
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
    `<script>${MODEL_EDIT_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
