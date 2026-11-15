// 工单 #31 的浏览器夹具：长模型列表的分组折叠、摘要去重、搜索联动与密度切换。
//
// 与既有 client 夹具同一套最小 React 渲染器：把打包后的 Workbench 渲染成真实
// DOM，派发真实 click / input / DragEvent，读回分组顺序、行文案、title、折叠
// 状态、mutate 参数与 localStorage。断言在 model-list-grouping.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/** 密度偏好的 localStorage key（与 src/core/model-list-view.js 保持一致）。 */
export const DENSITY_KEY = "modelpilot.model-list-density.v1";

/**
 * 9 条模型：
 * - acme（3，摘要完全相同 → 提到组头）
 * - jxf（3，第三条摘要不同 → 组头不显示摘要）
 * - tx（2，摘要相同 → 提到组头）
 * - standalone（无 `/` → 「其他」组，排最后）
 * 组内顺序故意与字母序不同，用来确认组内保持 models 数组顺序。
 */
const GROUPING_ROUTE_SOURCE = String.raw`
  const sharedSummary = {
    contextWindow: 131072,
    maxTokens: 8192,
    input: ["text"],
    reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
  };
  const route = {
    id: "preview-chat",
    name: "preview-chat",
    baseURL: "https://preview.invalid/v1",
    models: [
      { id: "acme/zeta", name: "acme/zeta", ...sharedSummary },
      { id: "acme/alpha", name: "acme/alpha", ...sharedSummary },
      { id: "acme/flash", name: "acme/flash", ...sharedSummary },
      { id: "jxf/dsv4.1-flash", name: "jxf/dsv4.1-flash", ...sharedSummary },
      { id: "jxf/dsv4.1-pro", name: "jxf/dsv4.1-pro", ...sharedSummary },
      {
        id: "jxf/dsv4-pro-reason",
        name: "jxf/dsv4-pro-reason",
        contextWindow: 200000,
        maxTokens: 65536,
        input: ["text", "image"],
        reasoningEfforts: false,
      },
      { id: "tx/deepseek-v4.1-flash", name: "tx/deepseek-v4.1-flash", ...sharedSummary },
      { id: "tx/deepseek-v4.1-pro", name: "tx/deepseek-v4.1-pro", ...sharedSummary },
      { id: "standalone", name: "standalone", ...sharedSummary },
    ],
  };
`;

export const MODEL_GROUPING_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

${GROUPING_ROUTE_SOURCE}
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
    remote: { llm: { discoverModels: async () => ({ ok: true, value: [] }) } },
  };
  client.apply(ctx);
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, spec.inject());

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const DENSITY_KEY = ${JSON.stringify(DENSITY_KEY)};
  const rows = () => [...document.querySelectorAll('[aria-label^="模型 "]')];
  const listOrder = () => rows().map((row) => row.getAttribute("aria-label").slice(3));
  const groupButtons = () => [...document.querySelectorAll('[aria-label^="模型分组 "]')];
  const groupKeys = () => groupButtons().map((button) => button.children[1].textContent);
  const groupCounts = () => groupButtons().map((button) => button.children[2].textContent);
  const groupExpanded = () => groupButtons().map((button) => button.getAttribute("aria-expanded"));
  const groupSummary = () => groupButtons().map((button) => {
    const header = button.parentElement;
    const summary = [...header.children].find((child) => child.tagName === "SPAN");
    return summary?.textContent ?? "";
  });
  const groupButton = (key) => groupButtons().find((button) => button.children[1].textContent === key);
  const rowOf = (id) => document.querySelector('[aria-label="模型 ' + id + '"]');
  const handle = (index) => document.getElementById("modelpilot-model-handle-" + index);
  const nameOf = (id) => rowOf(id)?.querySelector('span[id^="modelpilot-model-name-"]') ?? null;
  const rowSummary = (id) => [...(rowOf(id)?.querySelectorAll("span") ?? [])]
    .map((span) => span.textContent)
    .find((text) => text.includes("窗口")) ?? "";
  const rowText = (id) => rowOf(id)?.innerText ?? "";
  const find = (label) => document.querySelector('[aria-label="' + label + '"]');
  const click = (element) => element.click();
  const setText = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const search = () => document.getElementById("modelpilot-model-search");
  const panelText = () => document.querySelector('[aria-label="该路由的模型列表"]')?.innerText ?? "";
  const footerText = () => {
    const match = panelText().match(/显示 \d+ \/ \d+ 条/);
    return match === null ? "" : match[0];
  };
  const selectedCount = () => {
    const match = panelText().match(/已选 \d+ 条/);
    return match === null ? 0 : Number(match[0].match(/\d+/)[0]);
  };
  const densityState = () => ({
    compact: find("紧凑视图")?.getAttribute("aria-pressed") ?? "",
    detailed: find("详细视图")?.getAttribute("aria-pressed") ?? "",
    stored: window.localStorage.getItem(DENSITY_KEY),
  });
  const dragStart = (element) => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    return dataTransfer;
  };
  const dropOn = (element, dataTransfer, fraction) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * fraction,
    }));
  };

  const snapshotState = () => ({
    groups: groupKeys(),
    counts: groupCounts(),
    expanded: groupExpanded(),
    headerSummaries: groupSummary(),
    order: listOrder(),
    names: rows().map((row) => {
      const name = row.querySelector('span[id^="modelpilot-model-name-"]');
      return name === null
        ? null
        : { text: name.textContent, title: name.getAttribute("title") ?? "" };
    }),
    rowSummaries: listOrder().map((id) => rowSummary(id)),
    rowText: listOrder().map((id) => rowText(id)),
    density: densityState(),
    handles: [...document.querySelectorAll('[aria-label^="拖动排序 第 "]')].length,
    disabledHandles: [...document.querySelectorAll('[aria-label^="拖动排序 第 "]')]
      .filter((element) => element.disabled === true).length,
    selected: selectedCount(),
    footer: footerText(),
    mutations: mutations.length,
  });

  const result = {
    scheme: getComputedStyle(document.documentElement).colorScheme,
    initialStorage: window.localStorage.getItem(DENSITY_KEY),
  };

  // ── 1. 初始：默认紧凑；组按字母序、「其他」最后；组内短名、行保持数组顺序 ──
  result.initial = snapshotState();
  result.initial.groupAria = groupButtons().map((button) => button.getAttribute("aria-label"));
  result.initial.rows = listOrder().map((id) => ({
    id,
    rowTitle: rowOf(id)?.getAttribute("title") ?? "",
    nameText: nameOf(id)?.textContent ?? "",
    nameTitle: nameOf(id)?.getAttribute("title") ?? "",
    nameFont: getComputedStyle(nameOf(id)).fontSize,
    rowHeight: rowOf(id)?.getBoundingClientRect().height ?? 0,
    hasSummaryText: rowText(id).includes("窗口"),
  }));
  const acmeSummary = groupButtons().find((button) => button.children[1].textContent === "acme")
    ?.parentElement?.querySelector(":scope > span");
  result.initial.groupSummary = {
    tag: acmeSummary?.tagName ?? "",
    inButton: acmeSummary?.closest("button") !== null,
    cursor: acmeSummary === null ? "" : getComputedStyle(acmeSummary).cursor,
    text: acmeSummary?.textContent ?? "",
  };
  result.initial.firstRow = {
    rowTitle: rowOf("acme/zeta")?.getAttribute("title") ?? "",
    nameTitle: nameOf("acme/zeta")?.getAttribute("title") ?? "",
    hasSummaryText: rowText("acme/zeta").includes("窗口"),
    width: rowOf("acme/zeta")?.getBoundingClientRect().width ?? 0,
  };

  // ── 2. 折叠 acme：行隐藏、计数不变、全选只勾当前可见的行、不写盘 ──
  click(groupButton("acme"));
  await sleep(10);
  result.collapsed = snapshotState();
  click(find("全选模型"));
  await sleep(10);
  result.collapsedSelectAll = snapshotState();
  click(find("取消选择"));
  await sleep(10);
  click(groupButton("acme"));
  await sleep(10);
  result.expandedAgain = snapshotState();

  // ── 3. 详细：组内摘要相同 → 提到组头且行内不重复；混合 → 组头留空 ──
  click(find("详细视图"));
  await sleep(10);
  result.detailed = snapshotState();
  result.detailed.rowHeights = listOrder().map((id) => rowOf(id)?.getBoundingClientRect().height ?? 0);
  const detailedSummary = groupButtons().find((button) => button.children[1].textContent === "jxf")
    ?.parentElement?.querySelector(":scope > span");
  result.detailed.jxfHeaderSummary = detailedSummary?.textContent ?? "";

  // ── 4. 紧凑：摘要移入短 ID 的 title，行内不再显示；偏好写 localStorage ──
  click(find("紧凑视图"));
  await sleep(10);
  result.compact = snapshotState();
  result.compact.rowHeights = listOrder().map((id) => rowOf(id)?.getBoundingClientRect().height ?? 0);

  // ── 5. 搜索：命中组自动展开（即使之前手动折叠），未命中组收起；全选只勾可见 ──
  click(groupButton("tx"));
  await sleep(10);
  setText(search(), "flash");
  await sleep(20);
  result.search = snapshotState();
  result.search.matchingRows = listOrder();
  click(groupButton("jxf"));
  await sleep(10);
  result.searchManualCollapse = snapshotState();
  click(find("全选模型"));
  await sleep(10);
  result.searchSelectAll = snapshotState();
  click(find("取消选择"));
  await sleep(10);
  click(find("清空搜索"));
  await sleep(20);
  result.cleared = snapshotState();

  // ── 6. 拖动：分组视图下按行在 models 数组里的绝对下标写盘 ──
  const dt = dragStart(handle(0));
  dropOn(rowOf("acme/flash"), dt, 0.75);
  await sleep(30);
  result.drag = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    order: listOrder(),
    snapshotOrder: providers["preview-chat"].models.map((model) => model.id),
    mutating: mutations.length,
  };

  // ── 7. 折叠后的组没有拖动手柄；搜索时手柄禁用 ──
  click(groupButton("acme"));
  await sleep(10);
  result.collapsedNoHandles = {
    handles: [...document.querySelectorAll('[aria-label^="拖动排序 第 "]')].map((element) => element.id),
    hiddenHandle: handle(0),
    rows: listOrder(),
  };
  click(groupButton("acme"));
  await sleep(10);
  setText(search(), "jxf");
  await sleep(20);
  result.searchHandles = {
    handles: [...document.querySelectorAll('[aria-label^="拖动排序 第 "]')].map((element) => ({
      id: element.id,
      disabled: element.disabled === true,
      draggable: element.draggable === true,
      title: element.title,
    })),
    footer: footerText(),
  };
  setText(search(), "");
  await sleep(20);

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/**
 * 组装分组页。storedDensity 在渲染前写入 localStorage，用于验证读取回落。
 */
export function buildModelListGroupingHtml(bundleSource, scheme, { storedDensity = null } = {}) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  const preset = storedDensity === null
    ? ""
    : `<script>window.localStorage.setItem(${JSON.stringify(DENSITY_KEY)}, ${JSON.stringify(storedDensity)});</script>`;
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<title>model-list-grouping-${scheme}</title>`,
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    preset,
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${MODEL_GROUPING_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
