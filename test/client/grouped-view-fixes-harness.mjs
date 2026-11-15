// 工单 #32 的浏览器夹具：分组视图下的跨组拖动拦截 + 紧凑模式摘要可达性。
//
// 与 #19 / #31 同一套最小 React 渲染器：把打包后的 Workbench 渲染成真实
// DOM，派发真实 DragEvent / KeyboardEvent / click，读回插入线、mutate 参数、
// 列表顺序、行容器的 aria-label / title 与行内摘要节点的计算样式。断言在
// grouped-view-fixes.test.mjs 里。
//
// 工单 #34：工单 #32 给行容器加的 aria-label 不生效（div → generic 角色，
// ARIA 1.2 禁止可访问名），摘要实际由紧凑模式的 sr-only 节点 / 详细模式的
// 可见摘要提供；这里按实际生效的那一种读回。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";
import { GROUPING_ROUTE_SOURCE } from "./model-list-grouping-harness.mjs";

export const GROUPED_VIEW_FIXES_PROBE_SOURCE = String.raw`
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
  const CROSS_TOAST = "只能在同一分组内调整顺序；跨分组无法排序";
  const INITIAL_ORDER = [
    "acme/zeta",
    "acme/alpha",
    "acme/flash",
    "jxf/dsv4.1-flash",
    "jxf/dsv4.1-pro",
    "jxf/dsv4-pro-reason",
    "tx/deepseek-v4.1-flash",
    "tx/deepseek-v4.1-pro",
    "standalone",
  ];
  const rows = () => [...document.querySelectorAll("[data-model-key]")];
  const listOrder = () => rows().map((row) => row.getAttribute("data-model-key"));
  const rowOf = (id) => document.querySelector('[data-model-key="' + id + '"]');
  const handleOf = (id) => rowOf(id)?.querySelector('[aria-label^="拖动排序 第 "]') ?? null;
  const nameOf = (id) => rowOf(id)?.querySelector('span[id^="modelpilot-model-name-"]') ?? null;
  const srOf = (id) => rowOf(id)?.querySelector("[data-modelpilot-sr-summary]") ?? null;
  const line = () => document.querySelector('[title="插入位置"]');
  const lineRow = () => line()?.closest("[data-model-key]")?.getAttribute("data-model-key") ?? "";
  const groupOf = (id) => rowOf(id)?.closest("[data-model-group]")?.getAttribute("data-model-group") ?? "";
  const toastText = () => {
    const text = document.body.innerText;
    if (text.includes(CROSS_TOAST)) return CROSS_TOAST;
    const match = text.match(/已把 [^\n]+ 移到第 \d+ 位/);
    return match === null ? "" : match[0];
  };
  const summaryNodeOf = (id) => [...(rowOf(id)?.querySelectorAll("span") ?? [])]
    .find((span) => !span.hasAttribute("data-modelpilot-sr-summary") && span.textContent.includes("窗口")) ?? null;
  const groupSummaryOf = (key) => [...document.querySelectorAll('[aria-label^="模型分组 "]')]
    .find((button) => button.children[1].textContent === key)
    ?.parentElement?.querySelector(":scope > span")?.textContent ?? "";
  // 工单 #34：行容器不再挂 aria-label（generic 角色的可访问名被 ARIA 1.2
  // 禁止），这里读回的是「没有」以及行内真正进入阅读顺序的摘要节点。
  const rowAriaLabels = () => Object.fromEntries(rows().map((row) => [
    row.getAttribute("data-model-key"),
    row.getAttribute("aria-label"),
  ]));
  const summaryTexts = () => Object.fromEntries(rows().map((row) => {
    const id = row.getAttribute("data-model-key");
    const sr = srOf(id);
    return [id, sr === null ? summaryNodeOf(id)?.textContent ?? "" : sr.textContent];
  }));
  const snapshotOrder = () => providers["preview-chat"].models.map((model) => model.id);
  const srStyleOf = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent,
      display: style.display,
      visibility: style.visibility,
      position: style.position,
      width: style.width,
      height: style.height,
      margin: style.margin,
      padding: style.padding,
      overflow: style.overflow,
      clip: style.clip,
      whiteSpace: style.whiteSpace,
      borderWidth: style.borderWidth,
      rectWidth: rect.width,
      rectHeight: rect.height,
    };
  };
  const dragStart = (id) => {
    const handle = handleOf(id);
    if (handle === null) throw new Error("missing handle for " + id);
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    return dataTransfer;
  };
  const dragOver = (id, dataTransfer, fraction = 0.75) => {
    const row = rowOf(id);
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
  const click = (label) => document.querySelector('[aria-label="' + label + '"]')?.click();

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };

  // ── 1. 紧凑模式（默认）：行内 sr-only 摘要，行容器不可命名 ──
  result.compact = {
    order: listOrder(),
    rowAriaLabels: rowAriaLabels(),
    rows: rows().map((row) => {
      const id = row.getAttribute("data-model-key");
      const sr = srOf(id);
      const name = nameOf(id);
      const edit = row.querySelector('[aria-label^="编辑模型 "]');
      return {
        id,
        group: groupOf(id),
        rowTitle: row.getAttribute("title"),
        nameTitle: name.getAttribute("title"),
        nameText: name.textContent,
        visibleSummary: summaryNodeOf(id)?.textContent ?? "",
        sr: sr === null ? null : srStyleOf(sr),
        // 阅读顺序：短 ID → 摘要 → 操作按钮。
        nameBeforeSummary: sr !== null
          && (name.compareDocumentPosition(sr) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        summaryBeforeActions: sr !== null && edit !== null
          && (sr.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        rowHeight: row.getBoundingClientRect().height,
      };
    }),
    mutations: mutations.length,
    storage: window.localStorage.getItem("modelpilot.model-list-density.v1"),
  };

  // ── 2. 跨组拖动经过：不画插入线；回到本组行后插入线恢复 ──
  const crossDt = dragStart("jxf/dsv4.1-flash");
  dragOver("tx/deepseek-v4.1-flash", crossDt);
  await sleep(20);
  result.crossOver = {
    insertLine: line() !== null,
    lineRow: lineRow(),
    dropEffect: crossDt.dropEffect,
    opacity: getComputedStyle(rowOf("jxf/dsv4.1-flash")).opacity,
    mutations: mutations.length,
    order: listOrder(),
  };
  dragOver("jxf/dsv4.1-pro", crossDt);
  await sleep(20);
  result.sameOverAfterCross = {
    insertLine: line() !== null,
    lineRow: lineRow(),
    dropEffect: crossDt.dropEffect,
    mutations: mutations.length,
  };
  dragOver("tx/deepseek-v4.1-flash", crossDt);
  await sleep(20);
  result.crossAgain = {
    insertLine: line() !== null,
    lineRow: lineRow(),
    dropEffect: crossDt.dropEffect,
    mutations: mutations.length,
  };

  // ── 3. Esc 取消跨组拖动：不写盘，也不弹提示（此时还没有任何 toast）──
  const cancelDt = dragStart("jxf/dsv4-pro-reason");
  dragOver("tx/deepseek-v4.1-pro", cancelDt);
  await sleep(20);
  press(document, "Escape");
  await sleep(20);
  dropOn("tx/deepseek-v4.1-pro", cancelDt);
  await sleep(30);
  result.crossCancel = {
    mutations: mutations.length,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    toastPresent: toastText() !== "",
    toast: toastText(),
    insertLine: line() !== null,
  };

  // ── 4. 跨组松手：不写盘、顺序不变、提示只能同组排序 ──
  const rejectDt = dragStart("jxf/dsv4.1-flash");
  dragOver("tx/deepseek-v4.1-flash", rejectDt);
  await sleep(20);
  dropOn("tx/deepseek-v4.1-flash", rejectDt);
  await sleep(30);
  result.crossDrop = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1] ?? null,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    toast: toastText(),
    insertLine: line() !== null,
    opacity: getComputedStyle(rowOf("jxf/dsv4.1-flash")).opacity,
  };

  // ── 5. 同组拖动：#19 行为不变（一次 mutate、一条整数组 set）──
  const sameDt = dragStart("jxf/dsv4.1-flash");
  dragOver("jxf/dsv4-pro-reason", sameDt);
  await sleep(20);
  result.sameOver = {
    insertLine: line() !== null,
    lineRow: lineRow(),
    dropEffect: sameDt.dropEffect,
  };
  dropOn("jxf/dsv4-pro-reason", sameDt);
  await sleep(40);
  result.sameDrop = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1] ?? null,
    opCount: mutations[mutations.length - 1]?.length ?? 0,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    toast: toastText(),
    groups: rows().map((row) => ({
      id: row.getAttribute("data-model-key"),
      group: groupOf(row.getAttribute("data-model-key")),
    })),
  };

  // ── 6. 反方向跨组（tx → jxf）与拖到「其他」组：同样拒绝 ──
  const reverseDt = dragStart("tx/deepseek-v4.1-flash");
  dragOver("jxf/dsv4.1-pro", reverseDt);
  await sleep(20);
  dropOn("jxf/dsv4.1-pro", reverseDt);
  await sleep(30);
  result.reverseCross = {
    mutations: mutations.length,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    toast: toastText(),
  };
  const otherDt = dragStart("standalone");
  dragOver("tx/deepseek-v4.1-pro", otherDt);
  await sleep(20);
  dropOn("tx/deepseek-v4.1-pro", otherDt);
  await sleep(30);
  result.otherCross = {
    mutations: mutations.length,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    toast: toastText(),
  };

  // ── 7. 键盘排序仍严格在本组内：End 到 jxf 组末位，只写一次 ──
  const jxfRows = () => listOrder().filter((id) => groupOf(id) === "jxf");
  const jxfFirst = jxfRows()[0];
  const jxfLast = jxfRows()[jxfRows().length - 1];
  const handle = handleOf(jxfFirst);
  handle.focus();
  press(handle, "End");
  await sleep(40);
  result.keyboard = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1] ?? null,
    order: listOrder(),
    snapshotOrder: snapshotOrder(),
    from: jxfFirst,
    to: jxfLast,
    groupOrder: jxfRows(),
    toast: toastText(),
  };

  // ── 8. 详细模式：摘要可见、行容器没有 title，也没有 aria-label ──
  const compactSummaries = summaryTexts();
  click("详细视图");
  await sleep(30);
  result.detailed = {
    rowAriaLabels: rowAriaLabels(),
    srCount: document.querySelectorAll("[data-modelpilot-sr-summary]").length,
    rowTitles: Object.fromEntries(rows().map((row) => [
      row.getAttribute("data-model-key"),
      row.getAttribute("title"),
    ])),
    nameTitles: Object.fromEntries(rows().map((row) => {
      const id = row.getAttribute("data-model-key");
      return [id, nameOf(id)?.getAttribute("title")];
    })),
    mixedSummaryText: summaryNodeOf("jxf/dsv4-pro-reason")?.textContent ?? "",
    mixedSummaryTitle: summaryNodeOf("jxf/dsv4-pro-reason")?.getAttribute("title") ?? "",
    acmeGroupSummary: groupSummaryOf("acme"),
    acmeRowSummary: summaryNodeOf("acme/zeta")?.textContent ?? "",
    jxfGroupSummary: groupSummaryOf("jxf"),
    rowHeights: Object.fromEntries(rows().map((row) => [
      row.getAttribute("data-model-key"),
      row.getBoundingClientRect().height,
    ])),
    mutations: mutations.length,
    storage: window.localStorage.getItem("modelpilot.model-list-density.v1"),
  };

  // ── 9. 切回紧凑：摘要文本不变，sr-only 节点恢复 ──
  click("紧凑视图");
  await sleep(30);
  result.compactAgain = {
    rowAriaLabels: rowAriaLabels(),
    summaries: summaryTexts(),
    srCount: document.querySelectorAll("[data-modelpilot-sr-summary]").length,
    order: listOrder(),
    mutations: mutations.length,
    storage: window.localStorage.getItem("modelpilot.model-list-density.v1"),
  };
  result.compactSummariesBeforeSwitch = compactSummaries;
  result.initialOrder = INITIAL_ORDER;

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 组装工单 #32 的分组页；双主题、默认紧凑。 */
export function buildGroupedViewFixesHtml(bundleSource, scheme) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<title>grouped-view-fixes-${scheme}</title>`,
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${GROUPED_VIEW_FIXES_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
