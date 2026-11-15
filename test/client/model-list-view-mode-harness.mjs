// 工单 #39 的浏览器夹具：平铺 / 分组视图开关与平铺下的全局排序。
//
// 与 #19 / #31 / #32 同一套最小 React 渲染器：把打包后的 Workbench 渲染成
// 真实 DOM，派发真实 click / DragEvent / KeyboardEvent，读回组头、行顺序、
// 序号、写入的整数组、toast、localStorage 与 mutate 次数。断言在
// model-list-view-mode.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/** 视图偏好的 localStorage key（与 src/core/model-list-view.js 保持一致）。 */
export const VIEW_MODE_KEY = "modelpilot.model-list-view.v1";

/**
 * 工单 #39 的实测二夹具：5 条模型、3 个分组。
 *
 * 数组顺序：jxf/alpha, tx/beta, jxf/gamma, standalone, tx/delta
 * 分组显示：jxf(alpha,gamma) | tx(beta,delta) | 其他(standalone)
 * 平铺显示：与数组顺序一致
 */
export const VIEW_MODE_ROUTE_SOURCE = String.raw`
  const summary = {
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
      { id: "jxf/alpha", name: "jxf/alpha", ...summary },
      { id: "tx/beta", name: "tx/beta", ...summary },
      { id: "jxf/gamma", name: "jxf/gamma", ...summary },
      { id: "standalone", name: "standalone", ...summary },
      { id: "tx/delta", name: "tx/delta", ...summary },
    ],
  };
`;

/** 页面初始化：加载打包产物并把 Workbench 渲染到 #root。 */
export const VIEW_MODE_BOOT_SOURCE = String.raw`
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

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
  const VIEW_KEY = ${JSON.stringify(VIEW_MODE_KEY)};
  const CROSS_TOAST = "只能在同一分组内调整顺序；跨分组无法排序";
  const rows = () => [...document.querySelectorAll("[data-model-key]")];
  const listOrder = () => rows().map((row) => row.getAttribute("data-model-key"));
  const rowOf = (id) => document.querySelector('[data-model-key="' + id + '"]');
  const nameOf = (id) => rowOf(id)?.querySelector('span[id^="modelpilot-model-name-"]') ?? null;
  const ordinalOf = (id) => {
    const name = nameOf(id);
    const index = name?.previousElementSibling;
    return index === null || index === undefined ? null : Number(index.textContent);
  };
  const handleOf = (id) => rowOf(id)?.querySelector('[aria-label^="拖动排序 第 "]') ?? null;
  const groupButtons = () => [...document.querySelectorAll('[aria-label^="模型分组 "]')];
  const groupKeys = () => groupButtons().map((button) => button.children[1].textContent);
  const groupExpanded = () => groupButtons().map((button) => button.getAttribute("aria-expanded"));
  const groupSummaryTexts = () => groupButtons().map((button) => {
    const summary = [...button.parentElement.children].find((child) => child.tagName === "SPAN");
    return summary?.textContent ?? "";
  });
  const groupButton = (key) => groupButtons().find((button) => button.children[1].textContent === key);
  const line = () => document.querySelector('[title="插入位置"]');
  const lineRow = () => line()?.closest("[data-model-key]")?.getAttribute("data-model-key") ?? "";
  const find = (label) => document.querySelector('[aria-label="' + label + '"]');
  const click = (element) => element?.click();
  const press = (element, key) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };
  const setText = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const search = () => document.getElementById("modelpilot-model-search");
  const toastText = () => {
    const text = document.body.innerText;
    if (text.includes(CROSS_TOAST)) return CROSS_TOAST;
    const match = text.match(/已把 [^\n]+ 移到第 \d+ 位/);
    return match === null ? "" : match[0];
  };
  const summaryOf = (id) => [...(rowOf(id)?.querySelectorAll("span") ?? [])]
    .filter((span) => !span.hasAttribute("data-modelpilot-sr-summary"))
    .map((span) => span.textContent)
    .find((text) => text.includes("窗口")) ?? "";
  const srCount = () => document.querySelectorAll("[data-modelpilot-sr-summary]").length;
  const snapshotOrder = () => providers["preview-chat"].models.map((model) => model.id);
  const viewState = () => ({
    flat: find("平铺视图")?.getAttribute("aria-pressed") ?? "",
    grouped: find("分组视图")?.getAttribute("aria-pressed") ?? "",
    flatTitle: find("平铺视图")?.getAttribute("title") ?? "",
    groupedTitle: find("分组视图")?.getAttribute("title") ?? "",
    flatText: find("平铺视图")?.textContent ?? "",
    groupedText: find("分组视图")?.textContent ?? "",
    stored: window.localStorage.getItem(VIEW_KEY),
  });
  const densityState = () => ({
    compact: find("紧凑视图")?.getAttribute("aria-pressed") ?? "",
    detailed: find("详细视图")?.getAttribute("aria-pressed") ?? "",
    stored: window.localStorage.getItem("modelpilot.model-list-density.v1"),
  });
  const listState = () => ({
    groups: groupKeys(),
    groupNodes: document.querySelectorAll("[data-model-group]").length,
    expanded: groupExpanded(),
    headerSummaries: groupSummaryTexts(),
    order: listOrder(),
    ordinals: listOrder().map(ordinalOf),
    names: listOrder().map((id) => nameOf(id)?.textContent ?? ""),
    handleTitles: listOrder().map((id) => handleOf(id)?.getAttribute("title") ?? ""),
    mutations: mutations.length,
  });
  const dragStart = (id) => {
    const handle = handleOf(id);
    if (handle === null) throw new Error("missing handle for " + id);
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    return dataTransfer;
  };
  const dragOver = (id, dataTransfer, fraction = 0.75) => {
    const row = rowOf(id);
    if (row === null) throw new Error("missing row for " + id);
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * fraction,
    }));
  };
  const dropOn = (id, dataTransfer, fraction = 0.75) => {
    const row = rowOf(id);
    if (row === null) throw new Error("missing row for " + id);
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * fraction,
    }));
  };
  const pressMove = async (id, key) => {
    const before = mutations.length;
    const element = handleOf(id);
    if (element === null) throw new Error("missing handle for " + id);
    element.focus();
    press(element, key);
    await sleep(60);
    return {
      id,
      key,
      mutationsBefore: before,
      mutations: mutations.length,
      lastOps: mutations[mutations.length - 1] ?? null,
      order: listOrder(),
      snapshotOrder: snapshotOrder(),
      toast: toastText(),
    };
  };
`;

export const VIEW_MODE_PROBE_SOURCE = String.raw`
(async () => {
  try {
${VIEW_MODE_ROUTE_SOURCE}
${VIEW_MODE_BOOT_SOURCE}

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };

  // ── 1. 默认分组：有组头，组按字母序；不写任何存储 ──
  result.initial = {
    ...listState(),
    view: viewState(),
    density: densityState(),
  };

  // ── 2. 分组视图：跨组拖动仍被拒绝（#32 行为不变）──
  const crossDt = dragStart("jxf/alpha");
  dragOver("tx/beta", crossDt);
  await sleep(20);
  result.groupedCrossOver = {
    insertLine: line() !== null,
    lineRow: lineRow(),
    dropEffect: crossDt.dropEffect,
    mutations: mutations.length,
  };
  dropOn("tx/beta", crossDt);
  await sleep(40);
  result.groupedCrossDrop = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1] ?? null,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    toast: toastText(),
    insertLine: line() !== null,
  };

  // ── 3. 分组视图折叠 tx：切换视图前留一个折叠状态 ──
  click(groupButton("tx"));
  await sleep(20);
  result.groupedCollapsed = listState();

  // ── 4. 切到平铺：无组头、行按数组顺序、序号 1..N；视图状态不写配置 ──
  const beforeFlatSwitch = mutations.length;
  click(find("平铺视图"));
  await sleep(30);
  result.switchToFlat = {
    ...listState(),
    view: viewState(),
    density: densityState(),
    mutationsBefore: beforeFlatSwitch,
  };

  // ── 5. 平铺下把 tx/beta 拖到 jxf/alpha 之前（跨组允许）──
  const flatDt = dragStart("tx/beta");
  dragOver("jxf/alpha", flatDt, 0.25);
  await sleep(20);
  result.flatCrossOver = {
    insertLine: line() !== null,
    lineRow: lineRow(),
    dropEffect: flatDt.dropEffect,
    mutations: mutations.length,
    order: listOrder(),
  };
  dropOn("jxf/alpha", flatDt, 0.25);
  await sleep(60);
  result.flatDrop = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1] ?? null,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    toast: toastText(),
    firstRow: listOrder()[0],
    ordinals: listOrder().map(ordinalOf),
  };

  // ── 6. 平铺下键盘：Home / End / ↑ / ↓ 都按全表名次，跨组连续 ──
  result.flatKeyboardHome = await pressMove("tx/delta", "Home");
  result.flatKeyboardEnd = await pressMove("tx/delta", "End");
  result.flatKeyboardDown = await pressMove("tx/beta", "ArrowDown");
  result.flatKeyboardUp = await pressMove("tx/beta", "ArrowUp");

  // ── 7. 切回分组：组头恢复，折叠状态与切换前一致；不写配置 ──
  const beforeGroupedSwitch = mutations.length;
  click(find("分组视图"));
  await sleep(30);
  result.backToGrouped = {
    ...listState(),
    view: viewState(),
    mutationsBefore: beforeGroupedSwitch,
  };
  click(groupButton("tx"));
  await sleep(20);
  result.groupedReexpanded = {
    order: listOrder(),
    expanded: groupExpanded(),
    ordinals: listOrder().map(ordinalOf),
    snapshotOrder: snapshotOrder(),
    mutations: mutations.length,
  };

  // ── 8. 密度在两种视图下都照常工作；切视图不重置密度，也不写配置 ──
  const beforeDetailed = mutations.length;
  click(find("详细视图"));
  await sleep(30);
  result.detailedGrouped = {
    ...listState(),
    view: viewState(),
    density: densityState(),
    srCount: srCount(),
    summaries: listOrder().map((id) => summaryOf(id)),
    mutationsBefore: beforeDetailed,
  };
  const beforeFlatDetailed = mutations.length;
  click(find("平铺视图"));
  await sleep(30);
  result.detailedFlat = {
    ...listState(),
    view: viewState(),
    density: densityState(),
    srCount: srCount(),
    summaries: listOrder().map((id) => summaryOf(id)),
    mutationsBefore: beforeFlatDetailed,
  };
  click(find("紧凑视图"));
  await sleep(30);
  result.compactFlat = {
    ...listState(),
    view: viewState(),
    density: densityState(),
    srCount: srCount(),
    summaries: listOrder().map((id) => summaryOf(id)),
  };

  // ── 9. 平铺下搜索：没有折叠，"全选" 只勾命中行；清空恢复 ──
  setText(search(), "gamma");
  await sleep(30);
  result.flatSearch = {
    order: listOrder(),
    groups: groupKeys(),
    footer: (document.querySelector('[aria-label="该路由的模型列表"]')?.innerText ?? "")
      .match(/显示 \d+ \/ \d+ 条/)?.[0] ?? "",
    mutations: mutations.length,
  };
  click(find("全选"));
  await sleep(20);
  result.flatSearchSelectAll = {
    selected: [...document.querySelectorAll('input[aria-label^="选择模型 "]')]
      .filter((input) => input.checked).length,
    visible: rows().length,
    mutations: mutations.length,
  };
  setText(search(), "");
  await sleep(30);
  result.flatSearchCleared = { order: listOrder(), mutations: mutations.length };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

export const VIEW_MODE_STORED_PROBE_SOURCE = String.raw`
(async () => {
  try {
${VIEW_MODE_ROUTE_SOURCE}
${VIEW_MODE_BOOT_SOURCE}

  document.getElementById("result").textContent = JSON.stringify({
    scheme: getComputedStyle(document.documentElement).colorScheme,
    view: viewState(),
    density: densityState(),
    groups: groupKeys(),
    groupNodes: document.querySelectorAll("[data-model-group]").length,
    order: listOrder(),
    ordinals: listOrder().map(ordinalOf),
    names: listOrder().map((id) => nameOf(id)?.textContent ?? ""),
    handleTitles: listOrder().map((id) => handleOf(id)?.getAttribute("title") ?? ""),
    summaries: listOrder().map((id) => summaryOf(id)),
    srCount: srCount(),
    mutations: mutations.length,
  });
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

function presetScript({ storedView = null, storedDensity = null }) {
  const lines = [];
  if (storedView !== null) {
    lines.push(`window.localStorage.setItem(${JSON.stringify(VIEW_MODE_KEY)}, ${JSON.stringify(storedView)});`);
  }
  if (storedDensity !== null) {
    lines.push(`window.localStorage.setItem("modelpilot.model-list-density.v1", ${JSON.stringify(storedDensity)});`);
  }
  return lines.length === 0 ? "" : `<script>${lines.join("\n")}</script>`;
}

function buildPage(bundleSource, scheme, probeSource, presets) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<title>model-list-view-mode-${scheme}</title>`,
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    presetScript(presets),
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${probeSource}</script>`,
    "</body></html>",
  ].join("\n");
}

/** 组装工单 #39 的交互页；默认无存储（分组视图）。 */
export function buildModelListViewModeHtml(bundleSource, scheme, presets = {}) {
  return buildPage(bundleSource, scheme, VIEW_MODE_PROBE_SOURCE, presets);
}

/** 组装只读初始状态页：用于验证 localStorage 里的视图 / 密度偏好被读回。 */
export function buildModelListViewModeStoredHtml(bundleSource, scheme, presets = {}) {
  return buildPage(bundleSource, scheme, VIEW_MODE_STORED_PROBE_SOURCE, presets);
}
