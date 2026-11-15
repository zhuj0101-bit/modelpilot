// 工单 #28 的浏览器夹具：模型行内直接删除 + 编辑表单顶部「收起」。
//
// 与 model-edit-harness 共用同一条路由事实与最小 React 兼容渲染器；这里只
// 驱动行内删除与收起两条路径，断言在 inline-model-delete.test.mjs 里。

import { MODEL_EDIT_ROUTE_SOURCE } from "./model-edit-harness.mjs";
import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/**
 * 探针：先记录三行的编辑 / 删除按钮，再依次验证取消、确认、编辑中删除、
 * 只读禁用、收起按钮的干净 / 有改动两态，以及删到 0 条仍允许调用。
 *
 * `writable` 会写进快照；只读页面只跑初始按钮与点击无响应两条。
 */
function probeSource(writable) {
  return String.raw`
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
    writable: ${writable ? "true" : "false"},
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
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const dialogTitle = () => byAria("删除模型确认")?.querySelector("span")?.textContent ?? "";
  const panelText = () => byAria("该路由的模型列表")?.innerText ?? "";
  const collapseButton = () => byAria("收起编辑");

  const modelIds = ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash"];
  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };
  result.initial = {
    countText: panelText().split("\n")[0],
    editLabels: [...document.querySelectorAll('[aria-label^="编辑模型"]')].map((element) => element.getAttribute("aria-label")),
    deleteLabels: [...document.querySelectorAll('[aria-label^="删除模型 "]')].map((element) => element.getAttribute("aria-label")),
    rows: modelIds.map((id) => {
      const modelRow = byAria("模型 " + id);
      const edit = modelRow?.querySelector('[aria-label="编辑模型 ' + id + '"]');
      const remove = modelRow?.querySelector('[aria-label="删除模型 ' + id + '"]');
      return {
        hasEdit: edit !== null && edit !== undefined,
        hasDelete: remove !== null && remove !== undefined,
        sameActions: edit !== null && remove !== null && edit.parentElement === remove.parentElement,
        editBeforeDelete: edit !== null && remove !== null
          && edit.compareDocumentPosition(remove) === Node.DOCUMENT_POSITION_FOLLOWING,
        deleteText: remove?.textContent.trim() ?? "",
        deleteDisabled: remove?.disabled ?? null,
      };
    }),
  };
  result.initial.editorOpen = byAria("编辑表单 jxf/dsv4.1-flash") !== null;

  // ── 只读页面：按钮禁用，点它不弹窗、不发请求 ──
  if (!snapshot.writable) {
    const remove = byAria("删除模型 jxf/dsv4.1-flash");
    remove?.click();
    await sleep(0);
    result.readOnly = {
      deleteDisabled: remove?.disabled === true,
      dialogOpen: byAria("删除模型确认") !== null,
      mutations: mutations.length,
    };
    document.getElementById("result").textContent = JSON.stringify(result);
    return;
  }

  // ── 1. 行内「删除」直接打开同一个确认弹窗；取消不发请求 ──
  byAria("删除模型 jxf/dsv4.1-pro").click();
  await sleep(0);
  result.dialog = {
    open: byAria("删除模型确认") !== null,
    title: dialogTitle(),
    text: byAria("删除模型确认")?.innerText ?? "",
    editorOpened: byAria("编辑表单 jxf/dsv4.1-pro") !== null,
    mutations: mutations.length,
  };
  byAria("取消删除").click();
  await sleep(0);
  result.dialog.cancelled = byAria("删除模型确认") === null;
  result.dialog.mutationsAfterCancel = mutations.length;

  // ── 2. 确认后复用原有删除写入：恰好一条 set 重写 models 数组 ──
  const beforeRemove = mutations.length;
  byAria("删除模型 jxf/dsv4.1-pro").click();
  byAria("确认删除").click();
  await sleep(30);
  result.remove = {
    mutations: mutations.length - beforeRemove,
    lastOps: mutations[mutations.length - 1],
    modelsLength: route.models.length,
    listText: panelText(),
  };

  // ── 3. 收起按钮：干净时可用、有改动时禁用并提示、底部取消仍在 ──
  byAria("编辑模型 jxf/dsv4.1-flash").click();
  await sleep(0);
  const editor = () => byAria("编辑表单 jxf/dsv4.1-flash");
  result.collapse = {
    present: collapseButton() !== null,
    headerFirstRow: collapseButton()?.parentElement === editor()?.firstElementChild,
    cleanDisabled: collapseButton()?.disabled,
    cleanTitle: collapseButton()?.title ?? "",
    cancelPresent: byAria("取消编辑") !== null,
  };
  const beforeCollapse = mutations.length;
  collapseButton()?.click();
  await sleep(0);
  result.collapse.cleanClosedEditor = editor() === null;
  result.collapse.cleanMutations = mutations.length - beforeCollapse;

  byAria("编辑模型 jxf/dsv4.1-flash").click();
  setValue(byAria("编辑输出上限"), "48000");
  await sleep(20);
  result.collapse.dirtyDisabled = collapseButton()?.disabled === true;
  result.collapse.dirtyTitle = collapseButton()?.title ?? "";
  result.collapse.bottomCancelEnabled = byAria("取消编辑")?.disabled === false;
  collapseButton()?.click();
  await sleep(0);
  result.collapse.dirtyStillOpen = editor() !== null;
  byAria("取消编辑").click();
  await sleep(0);
  result.collapse.bottomCancelClosed = editor() === null;
  result.collapse.dirtyMutations = mutations.length - beforeCollapse;

  // 改回原值 → 改动集为空，收起重新可用。
  byAria("编辑模型 jxf/dsv4.1-flash").click();
  setValue(byAria("编辑输出上限"), "48000");
  await sleep(20);
  setValue(byAria("编辑输出上限"), "32768");
  await sleep(20);
  result.collapse.reenabledAfterRevert = collapseButton()?.disabled === false;
  collapseButton()?.click();
  await sleep(0);
  result.collapse.revertClosedEditor = editor() === null;

  // ── 4. 正在编辑这一行时，行内删除仍可用，且不会先收起编辑 ──
  byAria("编辑模型 jxf/dsv4.1-flash").click();
  byAria("删除模型 jxf/dsv4.1-flash").click();
  await sleep(0);
  result.editRowDelete = {
    dialogOpen: byAria("删除模型确认") !== null,
    title: dialogTitle(),
    editorStillOpen: editor() !== null,
  };
  const beforeEditRemove = mutations.length;
  byAria("确认删除").click();
  await sleep(30);
  result.editRowDelete.mutations = mutations.length - beforeEditRemove;
  result.editRowDelete.lastOps = mutations[mutations.length - 1];
  result.editRowDelete.editorClosed = editor() === null;
  result.editRowDelete.modelsLength = route.models.length;

  // ── 5. 只剩 1 条时行内删除仍允许调用；守卫沿用原有删除逻辑 ──
  const beforeLast = mutations.length;
  byAria("删除模型 tx/deepseek-v4.1-flash").click();
  await sleep(0);
  result.lastModel = {
    dialogOpen: byAria("删除模型确认") !== null,
    title: dialogTitle(),
  };
  byAria("确认删除").click();
  await sleep(30);
  result.lastModel.mutations = mutations.length - beforeLast;
  result.lastModel.lastOps = mutations[mutations.length - 1];
  result.lastModel.modelsLength = route.models.length;
  result.lastModel.emptyState = panelText().includes("该路由没有模型");

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;
}

/** 以指定主题与写权限组装行内删除页。 */
export function buildInlineModelDeleteHtml(bundleSource, scheme, writable = true) {
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
    `<script>${probeSource(writable)}</script>`,
    "</body></html>",
  ].join("\n");
}
