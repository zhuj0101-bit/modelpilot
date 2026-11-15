// 工单 #25 的浏览器夹具：主模型列表的搜索、多选与批量操作。
//
// 与 model-reorder-harness 同一套最小 React 渲染器：把打包后的 Workbench
// 渲染成真实 DOM，派发真实的 input / change / click 事件，读回行顺序、
// mutate 参数、按钮禁用状态与提示文案。断言在 model-list-search-bulk.test.mjs。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/** 深色 / 浅色各自的品牌色 token。 */
export const BRAND_TOKENS = Object.freeze({
  light: "#3b6fd4",
  dark: "#7aa4ee",
});

function brandRule(scheme) {
  return `  :root[data-scheme="${scheme}"] { --dsw-alias-brand-primary: ${BRAND_TOKENS[scheme]}; }`;
}

export const MODEL_LIST_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
  // 工单 #31 默认紧凑；本夹具验证 #25 的搜索 / 批量行为，用详细模式保持行高夹具稳定。
  window.localStorage.setItem("modelpilot.model-list-density.v1", "detailed");

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
        reasoningEfforts: { off: null, low: "low" },
        compat: { supportsReasoningEffort: true, nested: { keep: true } },
        futureHostField: { keep: ["exactly", "these"] },
      },
      {
        id: "jxf/dsv4.1-pro",
        name: "jxf/dsv4.1-pro",
        contextWindow: 1000000,
        maxTokens: 32768,
        input: ["text", "image"],
      },
      {
        id: "tx/deepseek-v4.1-flash",
        name: "tx/deepseek-v4.1-flash",
        contextWindow: 128000,
        maxTokens: 8192,
        input: ["text"],
      },
      {
        id: "qwen/complete",
        name: "qwen/complete",
        contextWindow: 262144,
        maxTokens: 8192,
        input: ["text"],
      },
      {
        id: "openai/gpt-case",
        name: "openai/gpt-case",
        contextWindow: 128000,
        maxTokens: 8192,
        input: ["text"],
      },
    ],
  };
  const otherRoute = {
    id: "other-route",
    baseURL: "https://other.invalid/v1",
    models: [{ id: "only/one", input: ["text"] }],
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
  let deferNext = false;
  let resolveMutation = null;
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
      if (deferNext) {
        deferNext = false;
        await new Promise((resolve) => { resolveMutation = resolve; });
      }
      for (const op of ops) {
        if (op.op === "set") setPath(snapshot.value, op.path, op.value);
      }
      return true;
    },
  };
  window.__bulkResolveMutation = () => {
    if (typeof resolveMutation === "function") {
      const resolve = resolveMutation;
      resolveMutation = null;
      resolve();
    }
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
  // 工单 #34：行容器不再挂 aria-label，机械读取用稳定的 data-model-key。
  const rows = () => [...document.querySelectorAll("[data-model-key]")];
  const listOrder = () => rows().map((row) => row.getAttribute("data-model-key"));
  const panel = () => document.querySelector('[aria-label="该路由的模型列表"]');
  const panelText = () => panel()?.innerText ?? "";
  const search = () => document.getElementById("modelpilot-model-search");
  const setText = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const click = (element) => element.click();
  const checkbox = (id) => document.querySelector('[aria-label="选择模型 ' + id + '"]');
  const handle = (index) => document.getElementById("modelpilot-model-handle-" + index);
  const find = (label) => document.querySelector('[aria-label="' + label + '"]');
  const selectedIds = () => rows()
    .filter((row) => row.querySelector('input[type="checkbox"][aria-label^="选择模型 "]')?.checked === true)
    .map((row) => row.getAttribute("data-model-key"));
  const footerText = () => {
    const match = panelText().match(/显示 \d+ \/ \d+ 条/);
    return match === null ? "" : match[0];
  };
  const selectAll = () => document.querySelector("[data-modelpilot-select-all]");
  const allSelectedChecked = () => selectAll()?.checked === true;
  const bulkText = () => find("模型批量操作")?.innerText ?? "";
  const routeSelect = () => document.querySelector("select");

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };

  // ── 1. 初始：搜索框在模型卡片标题行，每行有复选框与仍可拖动的手柄 ──
  result.geometry = {
    rowHeights: rows().map((row) => row.getBoundingClientRect().height),
    panelHeight: panel()?.getBoundingClientRect().height ?? 0,
    searchBackground: getComputedStyle(search()).backgroundColor,
    searchColor: getComputedStyle(search()).color,
    searchColorScheme: getComputedStyle(search()).colorScheme,
    checkboxColorScheme: getComputedStyle(rows()[0].querySelector('input[type="checkbox"]')).colorScheme,
    checkboxHeight: rows()[0].querySelector('input[type="checkbox"]').getBoundingClientRect().height,
  };
  result.initial = {
    order: listOrder(),
    searchInPanel: panel()?.contains(search()) === true,
    searchPlaceholder: search()?.placeholder ?? "",
    searchValue: search()?.value ?? "",
    checkboxCount: rows().filter((row) => row.querySelector('input[type="checkbox"]') !== null).length,
    checkboxes: rows().map((row) => row.querySelector('input[type="checkbox"]')?.getAttribute("aria-label") ?? ""),
    bulkText: bulkText(),
    handlesDraggable: [0, 1, 2, 3, 4].map((index) => handle(index)?.draggable === true),
    mutations: mutations.length,
  };

  // ── 2. 输入即筛：不区分大小写、顺序不变、显示 X / Y 条 + 清空搜索 ──
  setText(search(), "JXF");
  await sleep(10);
  result.filtered = {
    order: listOrder(),
    footer: footerText(),
    clearButton: find("清空搜索") !== null,
    handlesDisabled: [0, 1].map((index) => handle(index)?.disabled === true),
    handlesDraggable: [0, 1].map((index) => handle(index)?.draggable === true),
    handleTitle: handle(0)?.title ?? "",
    mutations: mutations.length,
    searchValue: search()?.value ?? "",
  };

  setText(search(), "zzz");
  await sleep(10);
  result.noMatch = {
    rows: rows().length,
    text: panelText(),
    clearButton: find("清空搜索") !== null,
    mutations: mutations.length,
  };
  click(find("清空搜索"));
  await sleep(10);
  result.cleared = {
    order: listOrder(),
    footer: footerText(),
    clearButton: find("清空搜索") !== null,
    handlesDraggable: [0, 1].map((index) => handle(index)?.draggable === true),
    mutations: mutations.length,
  };

  // ── 3. 勾选：计数 / 取消选择；全选只作用于当前筛选结果 ──
  click(checkbox("jxf/dsv4.1-flash"));
  click(checkbox("tx/deepseek-v4.1-flash"));
  await sleep(10);
  result.selection = {
    selected: selectedIds(),
    bulkText: bulkText(),
    cancelDisabled: find("取消选择")?.disabled === true,
  };

  setText(search(), "jxf");
  await sleep(10);
  click(selectAll());
  await sleep(10);
  result.selectAllFiltered = {
    checked: allSelectedChecked(),
    selected: selectedIds(),
    bulkText: bulkText(),
  };
  click(selectAll());
  await sleep(10);
  result.selectAllFilteredOff = {
    checked: allSelectedChecked(),
    selected: selectedIds(),
    bulkText: bulkText(),
  };
  click(find("取消选择"));
  await sleep(10);
  result.cancelled = { selected: selectedIds(), bulkText: bulkText() };

  // ── 4. 切换路由清空搜索词与选择 ──
  click(checkbox("jxf/dsv4.1-flash"));
  await sleep(10);
  routeSelect().value = "other-route";
  routeSelect().dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(20);
  result.routeSwitch = {
    order: listOrder(),
    searchValue: search()?.value ?? "",
    selected: selectedIds(),
    bulkText: bulkText(),
  };
  routeSelect().value = "preview-chat";
  routeSelect().dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(20);
  result.routeBack = { order: listOrder(), searchValue: search()?.value ?? "" };

  // ── 5. 批量删除：先二次确认，确认后一次 mutate、一条 set 整数组 ──
  click(checkbox("jxf/dsv4.1-pro"));
  click(checkbox("qwen/complete"));
  await sleep(10);
  const mutationsBeforeDelete = mutations.length;
  click(find("批量删除"));
  await sleep(10);
  result.bulkDeleteDialog = {
    open: find("批量删除模型确认") !== null,
    text: find("批量删除模型确认")?.innerText ?? "",
    mutations: mutations.length - mutationsBeforeDelete,
  };
  click(find("确认批量删除"));
  await sleep(40);
  result.bulkDelete = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    order: listOrder(),
    snapshotOrder: providers["preview-chat"].models.map((model) => model.id),
    selected: selectedIds(),
    bulkText: bulkText(),
    dialogClosed: find("批量删除模型确认") === null,
    toast: document.body.innerText.includes("已删除 2 条模型"),
  };

  // ── 6. 选中全部：批量删除禁用并说明至少保留一条 ──
  click(selectAll());
  await sleep(10);
  const mutationsBeforeAll = mutations.length;
  result.deleteAllBlocked = {
    selected: selectedIds().length,
    deleteDisabled: find("批量删除")?.disabled === true,
    deleteTitle: find("批量删除")?.title ?? "",
    bulkText: bulkText(),
    mutations: mutations.length - mutationsBeforeAll,
  };
  click(find("取消选择"));
  await sleep(10);

  // ── 7. 批量改字段：输出上限 + 推理档位，一条 set 保留其他字段 ──
  click(checkbox("jxf/dsv4.1-flash"));
  click(checkbox("openai/gpt-case"));
  await sleep(10);
  click(find("批量改字段"));
  await sleep(10);
  result.bulkFieldsOpen = {
    panel: find("批量修改字段") !== null,
    applyDisabled: find("应用批量修改")?.disabled === true,
    hint: find("批量修改字段")?.innerText ?? "",
  };
  click(find("批量设置输出上限"));
  await sleep(5);
  setText(find("批量输出上限"), "4096");
  click(find("批量设置推理档位"));
  await sleep(5);
  click(find("批量推理档位 xhigh"));
  await sleep(10);
  result.bulkFieldsReady = {
    applyDisabled: find("应用批量修改")?.disabled === true,
    maxTokens: find("批量输出上限")?.value ?? "",
    hint: find("批量修改字段")?.innerText ?? "",
  };
  click(find("应用批量修改"));
  await sleep(40);
  result.bulkFields = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    selected: selectedIds(),
    bulkText: bulkText(),
    panelGone: find("批量修改字段") === null,
    toast: document.body.innerText.includes("已批量更新 2 条模型"),
    snapshot: JSON.parse(JSON.stringify(providers["preview-chat"].models)),
  };

  // ── 8. 单条编辑成功后清空选择（修改后下标不变，但规则要求清空） ──
  click(checkbox("tx/deepseek-v4.1-flash"));
  await sleep(10);
  click(find("编辑模型 tx/deepseek-v4.1-flash"));
  await sleep(10);
  setText(find("编辑输出上限"), "5000");
  await sleep(10);
  const mutationsBeforeEdit = mutations.length;
  click(find("保存修改"));
  await sleep(40);
  result.editClearsSelection = {
    mutations: mutations.length - mutationsBeforeEdit,
    lastOps: mutations[mutations.length - 1],
    selected: selectedIds(),
    bulkText: bulkText(),
  };

  // ── 9. 写入进行中：批量按钮与行复选框禁用，防重复提交 ──
  click(checkbox("jxf/dsv4.1-flash"));
  await sleep(10);
  deferNext = true;
  const mutationsBeforeBusy = mutations.length;
  click(find("批量删除"));
  await sleep(10);
  click(find("确认批量删除"));
  await sleep(10);
  result.busy = {
    deleteDisabled: find("批量删除")?.disabled === true,
    cancelDisabled: find("取消选择")?.disabled === true,
    rowCheckboxDisabled: checkbox("tx/deepseek-v4.1-flash")?.disabled === true,
    searchUsable: search()?.disabled !== true,
    dialogBusyLabel: find("批量删除模型确认")?.innerText.includes("删除中…") === true,
  };
  window.__bulkResolveMutation();
  await sleep(40);
  result.busyAfter = {
    mutations: mutations.length - mutationsBeforeBusy,
    order: listOrder(),
    selected: selectedIds(),
  };

  // ── 10. 写前复核：确认框打开后外部把列表顺序换掉，确认时拒绝写入 ──
  click(checkbox("tx/deepseek-v4.1-flash"));
  await sleep(10);
  click(find("批量删除"));
  await sleep(10);
  const beforeStale = JSON.parse(JSON.stringify(providers["preview-chat"].models));
  providers["preview-chat"].models = [beforeStale[1], beforeStale[0], ...beforeStale.slice(2)];
  const mutationsBeforeStale = mutations.length;
  result.staleDialogOpen = find("批量删除模型确认") !== null;
  click(find("确认批量删除"));
  await sleep(20);
  result.staleGuard = {
    mutations: mutations.length - mutationsBeforeStale,
    snapshotOrder: providers["preview-chat"].models.map((model) => model.id),
    toast: document.body.innerText.includes("批量操作未执行"),
    selected: selectedIds(),
  };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装「搜索 + 批量操作」页。 */
export function buildModelListHtml(bundleSource, scheme) {
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
    `<script>${MODEL_LIST_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
