// 工单 #30：提示文案精简（说明进 hover，状态常驻）的真实 DOM 夹具。
//
// 复用工作台的既有最小渲染器与宿主 token 夹具：页面初始态与展开“路由设置”
// 后读回可见文字、每个 ⓘ 的 title，以及筛选时拖动手柄的条件文案。

import { SHIM_SOURCE } from "./layout-harness.mjs";
import { VISUAL_TOKEN_FIXTURE } from "./visual-harness.mjs";

export const HINT_FIXTURE_SOURCE = String.raw`
(() => {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  const route = {
    id: "preview-chat",
    name: "Preview Chat",
    baseURL: "https://preview.invalid/v1",
    api: "openai-completions",
    apiKeyEnv: "PREVIEW_CHAT_API_KEY",
    defaultContextWindow: 1000000,
    defaultMaxTokens: 32768,
    defaultInput: ["text", "image"],
    models: [
      { id: "acme/declared", contextWindow: 131072, maxTokens: 32768, input: ["text"], reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" } },
      { id: "acme/route-defaults" },
      { id: "acme/empty-input", contextWindow: 262144, maxTokens: 8192, input: [], reasoningEfforts: false },
    ],
  };
  const providers = { "preview-chat": route };
  const snapshot = { status: "ready", value: { providers }, user: { providers }, revision: 1, writable: true };
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true };
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
  window.__renderComponent(Workbench, spec.inject());

  const titles = () => [...document.querySelectorAll("[title]")]
    .map((element) => element.getAttribute("title"))
    .filter((value) => typeof value === "string" && value.trim() !== "");
  const titleStarting = (prefix) => titles().find((value) => value.startsWith(prefix)) ?? "";
  const labelOf = (ariaLabel) => document.querySelector('[aria-label="' + ariaLabel + '"]')?.closest("label") ?? null;
  const labelTitle = (ariaLabel) => labelOf(ariaLabel)?.querySelector("[title]")?.getAttribute("title") ?? "";
  const labelByPlaceholder = (placeholder) => [...document.querySelectorAll("input")]
    .find((element) => element.placeholder === placeholder)?.closest("label") ?? null;
  const placeholderTitle = (placeholder) => labelByPlaceholder(placeholder)?.querySelector("[title]")?.getAttribute("title") ?? "";
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const initialBody = document.body.innerText;
  const result = {
    initial: {
      body: initialBody,
      headerTip: document.querySelector("h2 [title]")?.getAttribute("title") ?? "",
      modelIdTip: placeholderTitle("如 tflow/alpha-32b"),
      reasoningTip: titleStarting("全不选 = 不设置推理档位"),
      maxTokensTip: labelTitle("输出上限"),
      oldExplanation: ["填入模型 ID 后这里显示将要写入的内容", "支持的推理档位：", "maxTokens 有两个作用", "不写空数组", "宿主回落"].filter((text) => initialBody.includes(text)),
      tips: titles(),
    },
  };

  // 展开路由设置：静态说明消失，字段说明改在 ⓘ 里，条件行照常出现。
  document.querySelector('[aria-label="展开路由设置"]').click();
  const defaultsBlock = document.querySelector('[aria-label="路由默认值说明"]');
  result.expanded = {
    body: document.body.innerText,
    staticSemanticsGone: !document.body.innerText.includes("未声明窗口 / 输出上限 / 输入模态的模型回落到这里的默认值"),
    summaryTip: document.querySelector('[aria-label="收起路由设置"] [title]')?.getAttribute("title") ?? "",
    displayNameTip: labelTitle("路由显示名"),
    baseUrlTip: labelTitle("路由接口地址"),
    apiTip: labelTitle("路由协议"),
    keyRefTip: labelTitle("路由密钥引用"),
    contextTip: labelTitle("路由默认上下文"),
    maxTokensTip: labelTitle("路由默认输出上限"),
    timeoutTip: labelTitle("路由超时"),
    inputTip: titleStarting("留空 = 按纯文本处理"),
    cacheTip: labelTitle("路由缓存"),
    transportTip: labelTitle("路由传输"),
    credentialTip: document.querySelector('[aria-label="密钥"] [title]')?.getAttribute("title") ?? "",
    defaultLines: [...(defaultsBlock?.children ?? [])].map((element) => element.textContent.trim()),
    tips: titles(),
  };
  result.expanded.oldExplanation = ["宿主", "configForms", "设置进 hover", "未声明 contextWindow", "不写空数组"].filter((text) => result.expanded.body.includes(text));

  // 条件文案：筛选为空时不出现“筛选状态下不可排序”，输入后只出现在拖动手柄的 title 里。
  const handle = () => document.querySelector('[aria-label^="拖动排序 第 1 位"]');
  result.filter = {
    emptyTitle: handle()?.getAttribute("title") ?? "",
    emptyBody: document.body.innerText.includes("筛选状态下不可排序"),
  };
  const search = document.querySelector('[aria-label="搜索模型列表"]');
  setValue(search, "acme");
  result.filter.typedTitle = document.querySelector('[aria-label^="拖动排序 第 1 位"]')?.getAttribute("title") ?? "";
  result.filter.typedBody = document.body.innerText.includes("筛选状态下不可排序");
  setValue(search, "");
  result.filter.clearedTitle = document.querySelector('[aria-label^="拖动排序 第 1 位"]')?.getAttribute("title") ?? "";

  document.getElementById("result").textContent = JSON.stringify(result);
})();
`;

export function buildHintCopyHtml(bundleSource, scheme) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    "<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }",
    "#root { max-width: 1100px; margin: 0 auto; }",
    VISUAL_TOKEN_FIXTURE,
    "</style></head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${HINT_FIXTURE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
