// 工单 #27 的浏览器夹具：模型行摘要的来源标记 + 悬停解释 + 窄容器单行省略。
//
// 和 model-edit-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，再在 headless Chrome 里读取文案、title 与计算样式。
// 这里只放夹具；断言在 model-row-sources.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/**
 * 一条声明齐全的路由：
 * - acme/declared：四个字段全部自己声明；
 * - acme/route-defaults：四个字段都没声明，token 与模态回落到路由默认值，
 *   推理档位没有路由级默认值 → 无档；
 * - acme/empty-input：contextWindow / maxTokens / 推理自己声明，input 是空数组
 *   （明确选择「一个模态都不开」）→ 显示未设置且不带 ↑。
 */
export const MODEL_ROW_ROUTE_SOURCE = String.raw`
  const route = {
    id: "preview-chat",
    name: "preview-chat",
    baseURL: "https://preview.invalid/v1",
    defaultContextWindow: 1000000,
    defaultMaxTokens: 128000,
    defaultInput: ["text", "image"],
    models: [
      {
        id: "acme/declared",
        name: "acme/declared",
        contextWindow: 131072,
        maxTokens: 32768,
        input: ["text"],
        reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
      },
      { id: "acme/route-defaults", name: "acme/route-defaults" },
      {
        id: "acme/empty-input",
        name: "acme/empty-input",
        contextWindow: 262144,
        maxTokens: 8192,
        input: [],
        reasoningEfforts: false,
      },
    ],
  };
`;

export const MODEL_ROW_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
  // 工单 #31 默认紧凑；本夹具验证详细模式的摘要来源标注。
  window.localStorage.setItem("modelpilot.model-list-density.v1", "detailed");

${MODEL_ROW_ROUTE_SOURCE}
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
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, spec.inject());

  const styleOf = (element) => getComputedStyle(element);
  const panel = document.querySelector('[aria-label="该路由的模型列表"]');
  const rowOf = (id) => document.querySelector('[data-model-key="' + id + '"]');
  const summaryOf = (id) => rowOf(id)?.querySelector("span[title]") ?? null;
  const readRow = (id) => {
    const row = rowOf(id);
    const summary = summaryOf(id);
    if (row === null || summary === null) return null;
    const style = styleOf(summary);
    const panelRect = panel.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      text: summary.textContent,
      title: summary.getAttribute("title"),
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      overflow: style.overflow,
      display: style.display,
      lineHeight: Number.parseFloat(style.lineHeight),
      summaryHeight: summary.getBoundingClientRect().height,
      summaryWidth: summary.getBoundingClientRect().width,
      clientWidth: summary.clientWidth,
      scrollWidth: summary.scrollWidth,
      panelWidth: panelRect.width,
      rowWidth: rowRect.width,
      rowLeft: rowRect.left,
      rowRight: rowRect.right,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
    };
  };

  const result = {
    scheme: styleOf(document.documentElement).colorScheme,
    title: document.title,
    rows: {
      declared: readRow("acme/declared"),
      routeDefaults: readRow("acme/route-defaults"),
      emptyInput: readRow("acme/empty-input"),
    },
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  };
  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装模型行摘要页；narrow 用 320px 卡片宽度验证单行省略。 */
export function buildModelRowSourcesHtml(bundleSource, scheme, { narrow = false, title = "model-row-sources" } = {}) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  const rootStyle = narrow
    ? "#root { width: 320px; }"
    : "#root { max-width: 980px; margin: 0 auto; }";
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<title>${title}</title>`,
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n${rootStyle}\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${MODEL_ROW_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
