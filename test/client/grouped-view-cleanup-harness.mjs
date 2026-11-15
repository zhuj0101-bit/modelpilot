// 工单 #34 问题二的浏览器夹具：分组消失后清理 collapsedGroups，同名组重建
// 时默认展开，同时不把无关分组的折叠状态一起清掉。
//
// 已折叠的分组不渲染行，无法从界面删除它；这里按宿主的真实行为处理「别处
// 改了配置」：直接替换快照里的 models 并通过 scope.subscribe 通知组件，再
// 用真实的「新增模型」表单加回 acme/new。断言在
// grouped-view-cleanup.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";
import { GROUPING_ROUTE_SOURCE } from "./model-list-grouping-harness.mjs";

export const GROUPED_VIEW_CLEANUP_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

${GROUPING_ROUTE_SOURCE}
  const providers = { "preview-chat": route };
  let snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const listeners = new Set();
  const mutations = [];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const setPath = (root, path, value) => {
    let node = root;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    node[path[path.length - 1]] = value;
  };
  // 每次写盘 / 外部更新都换成新的快照对象并通知订阅者：组件用
  // scope.subscribe 更新自身状态，引用不变时不会重渲染。
  const publish = () => {
    const current = snapshot.value.providers;
    const nextProviders = {};
    for (const [id, provider] of Object.entries(current)) {
      nextProviders[id] = Array.isArray(provider.models)
        ? { ...provider, models: [...provider.models] }
        : { ...provider };
    }
    snapshot = {
      ...snapshot,
      value: { providers: nextProviders },
      user: { providers: nextProviders },
      revision: snapshot.revision + 1,
    };
    for (const listener of [...listeners]) listener();
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mutate: async (ops) => {
      mutations.push(clone(ops));
      for (const op of ops) {
        if (op.op === "set") setPath(snapshot.value, op.path, op.value);
      }
      publish();
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
  const rows = () => [...document.querySelectorAll("[data-model-key]")];
  const rowIds = () => rows().map((row) => row.getAttribute("data-model-key"));
  const groupButtons = () => [...document.querySelectorAll('[aria-label^="模型分组 "]')];
  const groupBtn = (key) => groupButtons().find((button) => button.children[1].textContent === key) ?? null;
  const groupKeys = () => groupButtons().map((button) => button.children[1].textContent);
  const expandedState = () => Object.fromEntries(
    groupButtons().map((button) => [button.children[1].textContent, button.getAttribute("aria-expanded")]),
  );
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const providerModels = () => snapshot.value.providers["preview-chat"].models.map((model) => model.id);

  const result = {};
  result.initial = {
    groups: groupKeys(),
    expanded: expandedState(),
    rows: rowIds(),
    mutations: mutations.length,
  };

  // ── 1. 折叠 acme 与 jxf：两个现存分组进入折叠状态，不写配置 ──
  groupBtn("acme").click();
  await sleep(20);
  groupBtn("jxf").click();
  await sleep(20);
  result.collapsed = {
    expanded: expandedState(),
    rows: rowIds(),
    mutations: mutations.length,
  };

  // ── 2. 宿主的另一处更新删掉了 acme 的三条模型（折叠中的行不在 DOM 里，
  //       界面无法点击；这里按宿主的真实写盘路径提交一次 set，并通过
  //       scope.subscribe 把新快照推给组件）──
  const remaining = snapshot.value.providers["preview-chat"].models.filter((model) => !model.id.startsWith("acme/"));
  await scope.mutate([{
    op: "set",
    path: ["providers", "preview-chat", "models"],
    value: remaining,
  }]);
  await sleep(40);
  result.afterDelete = {
    groups: groupKeys(),
    expanded: expandedState(),
    rows: rowIds(),
    mutations: mutations.length,
    models: providerModels(),
  };

  // ── 3. 从真实的「新增模型」表单加回 acme/new：新组必须默认展开 ──
  setValue(document.querySelector("#modelpilot-model-id"), "acme/new");
  await sleep(30);
  const applyButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "写入 DSH 设置");
  if (applyButton === undefined) throw new Error("write button not found");
  result.addButtonDisabled = applyButton.disabled;
  applyButton.click();
  await sleep(60);
  result.afterAdd = {
    groups: groupKeys(),
    expanded: expandedState(),
    rows: rowIds(),
    models: providerModels(),
    mutations: mutations.length,
  };
  result.mutations = mutations;

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 组装工单 #34 的分组折叠清理夹具；使用浅色宿主 token。 */
export function buildGroupedViewCleanupHtml(bundleSource, scheme = "light") {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<title>grouped-view-cleanup-${scheme}</title>`,
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${GROUPED_VIEW_CLEANUP_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
