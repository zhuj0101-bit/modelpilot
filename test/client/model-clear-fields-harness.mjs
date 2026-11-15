// 工单 #38 的浏览器夹具：清空 token 字段、清空提示、共享输入判定与输入模态校验。
//
// 和 model-edit-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，再在 headless Chrome 里做真实输入与点击。这里只放夹具；
// 断言在 model-clear-fields.test.mjs 里。

import { THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";
import { SHIM_SOURCE } from "./layout-harness.mjs";

/** 两条模型：一条带 token 值与 input；一条没有 input（不能误判为「清空模态」）。 */
export const MODEL_CLEAR_ROUTE_SOURCE = String.raw`
  const route = {
    id: "preview-clear",
    name: "preview-clear",
    baseURL: "https://preview.invalid/v1",
    models: [
      {
        id: "jxf/clearable",
        name: "jxf/clearable",
        contextWindow: 131072,
        maxTokens: 32768,
        input: ["text"],
        reasoningEfforts: false,
        compat: { supportsReasoningEffort: true },
      },
      {
        id: "tx/no-input",
        name: "tx/no-input",
        maxTokens: 8192,
        reasoningEfforts: false,
      },
    ],
  };
`;

export const MODEL_CLEAR_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
  window.localStorage.setItem("modelpilot.model-list-density.v1", "detailed");

${MODEL_CLEAR_ROUTE_SOURCE}
  const providers = { "preview-clear": route };
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
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const panelText = () => byAria("该路由的模型列表")?.innerText ?? "";
  const CLEAR_NOTE = "清空 = 删除该字段，改由路由默认值接管";
  const INPUT_ERROR = "至少保留一个输入模态（宿主会拒绝空 input）";
  const clearNotes = () => [...document.querySelectorAll("div")]
    .filter((element) => element.textContent.trim() === CLEAR_NOTE).length;
  const formHasInputError = () => document.body.innerText.includes(INPUT_ERROR);
  const tokenError = () => document.body.innerText.includes("请输入正整数");
  const opPreview = () => {
    const pre = [...document.querySelectorAll("pre")].find((element) => element.textContent.includes('"providers"'));
    return pre === undefined ? [] : JSON.parse(pre.textContent);
  };
  const changedLine = () => [...document.querySelectorAll("div")]
    .find((element) => element.textContent.startsWith("改动字段："))?.textContent ?? "";

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };

  // ── 1. 清空已有 contextWindow / maxTokens：保存可用、显示提示、写入后键消失 ──
  byAria("编辑模型 jxf/clearable").click();
  result.initial = {
    contextWindow: byAria("编辑上下文窗口").value,
    maxTokens: byAria("编辑输出上限").value,
    saveDisabled: byAria("保存修改").disabled,
    clearNotes: clearNotes(),
  };

  setValue(byAria("编辑上下文窗口"), "");
  await sleep(30);
  result.clearContext = {
    saveDisabled: byAria("保存修改").disabled,
    clearNotes: clearNotes(),
    changedLine: changedLine(),
    error: tokenError(),
    ops: opPreview(),
  };

  setValue(byAria("编辑输出上限"), "");
  await sleep(30);
  result.clearBoth = {
    saveDisabled: byAria("保存修改").disabled,
    clearNotes: clearNotes(),
    changedLine: changedLine(),
  };

  byAria("保存修改").click();
  await sleep(50);
  result.save = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    contextWindow: route.models[0].contextWindow,
    maxTokens: route.models[0].maxTokens,
    hasContextWindow: Object.hasOwn(route.models[0], "contextWindow"),
    hasMaxTokens: Object.hasOwn(route.models[0], "maxTokens"),
    compat: JSON.parse(JSON.stringify(route.models[0].compat)),
    listText: panelText(),
    editorClosed: byAria("编辑表单 jxf/clearable") === null,
  };

  // ── 2. 重新打开：字段已缺失 → 空值、没有多余额外提示、保存禁用 ──
  byAria("编辑模型 jxf/clearable").click();
  result.reopen = {
    contextWindow: byAria("编辑上下文窗口").value,
    maxTokens: byAria("编辑输出上限").value,
    saveDisabled: byAria("保存修改").disabled,
    clearNotes: clearNotes(),
  };

  // ── 3. 共享判定：007 合法并归一到 7；超长数字被输入层拒绝并回显 ──
  setValue(byAria("编辑上下文窗口"), "007");
  await sleep(30);
  result.leadingZero = {
    value: byAria("编辑上下文窗口").value,
    saveDisabled: byAria("保存修改").disabled,
    ops: opPreview(),
    error: tokenError(),
  };
  setValue(byAria("编辑上下文窗口"), "");
  await sleep(30);
  setValue(byAria("编辑上下文窗口"), "99999999999999999999");
  await sleep(30);
  result.oversized = {
    value: byAria("编辑上下文窗口").value,
    saveDisabled: byAria("保存修改").disabled,
    error: tokenError(),
  };
  byAria("取消编辑").click();

  // ── 4. 输入模态：两个都不勾 → 禁用保存 + 字段下方说明；留一个即可保存 ──
  byAria("编辑模型 jxf/clearable").click();
  byAria("编辑输入模态 text").click();
  await sleep(30);
  result.modalityNone = {
    saveDisabled: byAria("保存修改").disabled,
    error: formHasInputError(),
    checkedText: byAria("编辑输入模态 text").checked,
    checkedImage: byAria("编辑输入模态 image").checked,
  };
  byAria("编辑输入模态 image").click();
  await sleep(30);
  result.modalityImage = {
    saveDisabled: byAria("保存修改").disabled,
    error: formHasInputError(),
    ops: opPreview(),
  };
  byAria("编辑输入模态 image").click();
  await sleep(30);
  result.modalityBackToNone = {
    saveDisabled: byAria("保存修改").disabled,
    error: formHasInputError(),
  };
  byAria("取消编辑").click();

  // ── 5. 本来就没有 input 的模型：两个框空着不是「清空」，改其他字段仍可保存 ──
  byAria("编辑模型 tx/no-input").click();
  setValue(byAria("编辑输出上限"), "9000");
  await sleep(30);
  result.noExistingInput = {
    checkedText: byAria("编辑输入模态 text").checked,
    checkedImage: byAria("编辑输入模态 image").checked,
    error: formHasInputError(),
    saveDisabled: byAria("保存修改").disabled,
  };
  byAria("取消编辑").click();

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装清空字段夹具页。 */
export function buildModelClearHtml(bundleSource, scheme) {
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
    `<script>${MODEL_CLEAR_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
