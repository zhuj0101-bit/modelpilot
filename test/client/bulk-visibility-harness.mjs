// 工单 #33 的浏览器夹具：批量操作的可见性与安全边界。
//
// 两套独立页面：
// 1. buildBulkVisibilityHtml —— 折叠 / 搜索隐藏选中、全选三态；
// 2. buildBulkDeleteConfirmHtml —— 批量删除二次确认、隐藏条目点名、Esc / Tab。
//
// 与既有 client 夹具同一套最小 React 渲染器：把打包后的 Workbench 渲染成真实
// DOM，派发真实 click / change / keydown 事件，读回界面文案、复选框状态与
// mutate 参数。断言在 bulk-visibility.test.mjs / bulk-delete-confirm.test.mjs。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

const PAGE_STYLE = "<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n"
  + THEME_TOKEN_FIXTURE
  + "\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>";

/** 8 条模型、4 个分组：acme(3) / jxf(3) / tx(2) / 其他(0)。 */
const ROUTE_SOURCE = String.raw`
  const route = {
    id: "preview-chat",
    name: "preview-chat",
    baseURL: "https://preview.invalid/v1",
    models: [
      { id: "acme/one", name: "acme/one", input: ["text"] },
      { id: "acme/two", name: "acme/two", input: ["text"] },
      { id: "acme/three", name: "acme/three", input: ["text"] },
      { id: "jxf/one", name: "jxf/one", input: ["text"] },
      { id: "jxf/two", name: "jxf/two", input: ["text"] },
      { id: "jxf/three", name: "jxf/three", input: ["text"] },
      { id: "tx/one", name: "tx/one", input: ["text"] },
      { id: "tx/two", name: "tx/two", input: ["text"] },
    ],
  };
  const otherRoute = {
    id: "other-route",
    baseURL: "https://other.invalid/v1",
    models: [{ id: "other/only", input: ["text"] }],
  };
  const providers = { "preview-chat": route, "other-route": otherRoute };
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
`;

function buildPage(bundleSource, scheme, probeSource) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    PAGE_STYLE,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${probeSource}</script>`,
    "</body></html>",
  ].join("\n");
}

export const BULK_VISIBILITY_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
  window.localStorage.setItem("modelpilot.model-list-density.v1", "compact");

${ROUTE_SOURCE}

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rows = () => [...document.querySelectorAll("[data-model-key]")];
  const listOrder = () => rows().map((row) => row.getAttribute("data-model-key"));
  const groupButtons = () => [...document.querySelectorAll('[aria-label^="模型分组 "]')];
  const groupButton = (key) => groupButtons().find((button) => button.children[1].textContent === key);
  const find = (label) => document.querySelector('[aria-label="' + label + '"]');
  const click = (element) => element.click();
  const setText = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const search = () => document.getElementById("modelpilot-model-search");
  const selectAll = () => document.querySelector("[data-modelpilot-select-all]");
  const hiddenHint = () => document.querySelector("[data-modelpilot-hidden-selection]");
  const checkbox = (id) => document.querySelector('[aria-label="选择模型 ' + id + '"]');
  const selectedIds = () => rows()
    .filter((row) => row.querySelector('input[type="checkbox"][aria-label^="选择模型 "]')?.checked === true)
    .map((row) => row.getAttribute("data-model-key"));
  const panelText = () => document.querySelector('[aria-label="该路由的模型列表"]')?.innerText ?? "";
  const bulkText = () => find("模型批量操作")?.innerText ?? "";
  const selectedCount = () => {
    const match = bulkText().match(/已选 (\d+) 条/);
    return match === null ? 0 : Number(match[1]);
  };
  const state = () => ({
    order: listOrder(),
    selected: selectedIds(),
    selectedCount: selectedCount(),
    bulkText: bulkText(),
    selectAllChecked: selectAll()?.checked === true,
    selectAllIndeterminate: selectAll()?.indeterminate === true,
    selectAllLabel: selectAll()?.getAttribute("aria-label") ?? "",
    hiddenText: hiddenHint()?.textContent ?? "",
    mutations: mutations.length,
  });

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };
  result.initial = state();

  // ── 1. 8 条里选 3 条：半选；点一次勾满；再点一次清空 ──
  click(checkbox("acme/one"));
  click(checkbox("acme/two"));
  click(checkbox("acme/three"));
  await sleep(10);
  result.partial = state();

  click(selectAll());
  await sleep(10);
  result.selectedAll = state();

  click(selectAll());
  await sleep(10);
  result.deselectedAll = state();

  // ── 2. 重新勾选 acme 的 3 条后折叠该组：选择保留但明确提示未显示 ──
  click(checkbox("acme/one"));
  click(checkbox("acme/two"));
  click(checkbox("acme/three"));
  await sleep(10);
  const mutationsBeforeCollapse = mutations.length;
  click(groupButton("acme"));
  await sleep(10);
  result.collapsed = state();
  result.collapsed.mutationsAfter = mutations.length - mutationsBeforeCollapse;

  // 取消隐藏选择：只移除看不见的 3 条，已选归零，全称不写配置。
  click(find("取消这些选择"));
  await sleep(10);
  result.hiddenCleared = state();

  // ── 3. 搜索把已选行过滤掉：同样提示未显示，可一键取消 ──
  click(groupButton("acme"));
  await sleep(10);
  click(checkbox("acme/one"));
  await sleep(10);
  setText(search(), "jxf/one");
  await sleep(20);
  result.searchHidden = state();
  result.searchGroupCounts = groupButtons().map((button) => button.children[2].textContent);
  click(find("取消这些选择"));
  await sleep(10);
  result.searchHiddenCleared = state();

  // ── 4. 清空搜索恢复全部，折叠 / 搜索 / 选择全程不写配置 ──
  click(find("清空搜索"));
  await sleep(20);
  result.cleared = state();

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

export const BULK_DELETE_CONFIRM_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
  window.localStorage.setItem("modelpilot.model-list-density.v1", "compact");

${ROUTE_SOURCE}

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rows = () => [...document.querySelectorAll("[data-model-key]")];
  const listOrder = () => rows().map((row) => row.getAttribute("data-model-key"));
  const groupButtons = () => [...document.querySelectorAll('[aria-label^="模型分组 "]')];
  const groupButton = (key) => groupButtons().find((button) => button.children[1].textContent === key);
  const find = (label) => document.querySelector('[aria-label="' + label + '"]');
  const click = (element) => element.click();
  const checkbox = (id) => document.querySelector('[aria-label="选择模型 ' + id + '"]');
  const selectAll = () => document.querySelector("[data-modelpilot-select-all]");
  const routeSelect = () => document.querySelector("select");
  const bulkText = () => find("模型批量操作")?.innerText ?? "";
  const selectedIds = () => rows()
    .filter((row) => row.querySelector('input[type="checkbox"][aria-label^="选择模型 "]')?.checked === true)
    .map((row) => row.getAttribute("data-model-key"));
  const dialog = () => find("批量删除模型确认");
  const dialogState = () => ({
    open: dialog() !== null,
    text: dialog()?.innerText ?? "",
    focused: document.activeElement?.getAttribute("aria-label") ?? "",
    mutations: mutations.length,
  });

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };

  // ── 0. 超过 5 条：正文最多列 5 条，剩余用「……另有 N 条」收尾 ──
  for (const id of ["acme/one", "acme/two", "acme/three", "jxf/one", "jxf/two", "tx/one"]) {
    click(checkbox(id));
  }
  await sleep(10);
  click(find("批量删除"));
  await sleep(10);
  result.overflow = dialogState();
  result.overflow.countText = (result.overflow.text.match(/删除 (\d+) 条模型/) ?? [])[1] ?? "";
  click(find("取消批量删除"));
  await sleep(10);
  result.overflow.closed = dialog() === null;
  click(find("取消选择"));
  await sleep(10);

  // ── 1. 打开确认框：不写盘，点名被删 id 与不可撤销 ──
  click(checkbox("tx/one"));
  click(checkbox("jxf/one"));
  await sleep(10);
  result.beforeOpen = {
    selected: selectedIds(),
    bulkText: bulkText(),
    mutations: mutations.length,
  };
  click(find("批量删除"));
  await sleep(10);
  result.opened = dialogState();
  result.opened.bulkText = bulkText();
  result.opened.countText = (result.opened.text.match(/删除 (\d+) 条模型/) ?? [])[1] ?? "";

  // ── 2. 取消：弹窗关闭、选择不变、仍不写盘 ──
  click(find("取消批量删除"));
  await sleep(10);
  result.cancelled = {
    dialogOpen: dialog() !== null,
    selected: selectedIds(),
    bulkText: bulkText(),
    mutations: mutations.length,
  };

  // ── 3. 确认：一次 mutate、一条 set 整数组，写盘成功后关闭并清空选择 ──
  click(find("批量删除"));
  await sleep(10);
  click(find("确认批量删除"));
  await sleep(40);
  result.confirmed = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    dialogOpen: dialog() !== null,
    selected: selectedIds(),
    order: listOrder(),
    snapshotOrder: providers["preview-chat"].models.map((model) => model.id),
    toast: document.body.innerText.includes("已删除 2 条模型"),
  };

  // ── 4. 隐藏选中：折叠组里的 3 条必须在确认框里点名 ──
  click(checkbox("acme/one"));
  click(checkbox("acme/two"));
  click(checkbox("acme/three"));
  await sleep(10);
  click(groupButton("acme"));
  await sleep(10);
  const mutationsBeforeHidden = mutations.length;
  click(find("批量删除"));
  await sleep(10);
  result.hidden = dialogState();
  result.hidden.bulkText = bulkText();
  result.hidden.countText = (result.hidden.text.match(/删除 (\d+) 条模型/) ?? [])[1] ?? "";
  click(find("取消批量删除"));
  await sleep(10);
  result.hidden.mutationsAfterCancel = mutations.length - mutationsBeforeHidden;

  // ── 5. Esc 关闭：复用 ConfirmDialog 既有行为 ──
  click(find("批量删除"));
  await sleep(10);
  const escDialog = dialog();
  escDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await sleep(10);
  result.escape = {
    dialogOpen: dialog() !== null,
    selected: selectedIds(),
    bulkText: bulkText(),
    hiddenText: document.querySelector("[data-modelpilot-hidden-selection]")?.textContent ?? "",
    mutations: mutations.length,
  };

  // ── 6. Tab 焦点循环：最后一个按钮 Tab → 第一个，第一个 Shift+Tab → 最后一个 ──
  click(find("批量删除"));
  await sleep(10);
  const tabDialog = dialog();
  const focusables = [...tabDialog.querySelectorAll("button:not([disabled])")];
  focusables[focusables.length - 1].focus();
  tabDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  const tabForward = document.activeElement === focusables[0];
  focusables[0].focus();
  tabDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  const tabBackward = document.activeElement === focusables[focusables.length - 1];
  result.tabTrap = { forward: tabForward, backward: tabBackward, focusables: focusables.length };
  click(find("取消批量删除"));
  await sleep(10);

  // ── 7. 全选后不能删光：按钮禁用，点它不会弹窗 ──
  click(find("取消选择"));
  await sleep(10);
  click(groupButton("acme"));
  await sleep(10);
  click(selectAll());
  await sleep(10);
  const mutationsBeforeBlocked = mutations.length;
  click(find("批量删除"));
  await sleep(10);
  result.deleteAllBlocked = {
    selected: selectedIds().length,
    deleteDisabled: find("批量删除")?.disabled === true,
    dialogOpen: dialog() !== null,
    mutations: mutations.length - mutationsBeforeBlocked,
  };
  click(find("取消选择"));
  await sleep(10);

  // ── 8. 取消选择 / 切换路由都会关闭已经打开的确认框 ──
  click(checkbox("jxf/two"));
  await sleep(10);
  click(find("批量删除"));
  await sleep(10);
  click(find("取消选择"));
  await sleep(10);
  result.closedByClear = { dialogOpen: dialog() !== null, selected: selectedIds(), mutations: mutations.length };

  click(checkbox("jxf/two"));
  await sleep(10);
  click(find("批量删除"));
  await sleep(10);
  routeSelect().value = "other-route";
  routeSelect().dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(20);
  result.closedByRouteSwitch = {
    dialogOpen: dialog() !== null,
    selected: selectedIds(),
    bulkText: bulkText(),
    mutations: mutations.length,
  };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

export function buildBulkVisibilityHtml(bundleSource, scheme) {
  return buildPage(bundleSource, scheme, BULK_VISIBILITY_PROBE_SOURCE);
}

export function buildBulkDeleteConfirmHtml(bundleSource, scheme) {
  return buildPage(bundleSource, scheme, BULK_DELETE_CONFIRM_PROBE_SOURCE);
}
