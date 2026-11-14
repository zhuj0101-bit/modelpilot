// 工单 #32 第一批的浏览器夹具：路由设置卡片 + 九个字段 + 删除整条路由。
//
// 与 model-edit-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，再在 headless Chrome 里做真实点击、读回字段 / mutate 参数 /
// 计算样式。这里只放夹具；断言在 route-edit.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

/** 与宿主 llm-pi-ai schema 同形的协议 union；额外加一个假协议证明来自 schema。 */
export const SCHEMA_PROTOCOLS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "mistral-conversations",
  "bedrock-converse-stream",
  "preview-experimental",
]);

const PROVIDER_SOURCE = String.raw`
  const previewChat = {
    id: "preview-chat",
    displayName: "Preview Chat",
    baseURL: "https://preview.invalid/v1",
    api: "openai-completions",
    apiKeyEnv: "PREVIEW_CHAT_API_KEY",
    defaultContextWindow: 1000000,
    defaultMaxTokens: 32768,
    cacheRetention: "short",
    transport: "auto",
    timeoutMs: 60000,
    models: [
      { id: "jxf/dsv4.1-flash", name: "jxf/dsv4.1-flash", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
      { id: "jxf/dsv4.1-pro", name: "jxf/dsv4.1-pro", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
      { id: "tx/deepseek-v4.1-flash", name: "tx/deepseek-v4.1-flash", contextWindow: 128000, maxTokens: 8192, input: ["text"] },
    ],
    compat: { supportsReasoningEffort: true },
    futureHostField: { keep: true },
  };
  const backupRoute = {
    id: "backup-route",
    baseURL: "https://backup.invalid/v1",
    models: [{ id: "backup/one", input: ["text"] }],
  };
  const spareRoute = {
    id: "spare-route",
    baseURL: "https://spare.invalid/v1",
    models: [{ id: "spare/one", input: ["text"] }],
  };
`;

function fixtureSource(routeMode) {
  if (routeMode === "one") {
    return `${PROVIDER_SOURCE}
  const providers = { "preview-chat": previewChat };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };`;
  }
  if (routeMode === "usage") {
    return String.raw`
  const providers = {
    "sparse-chat": {
      id: "sparse-chat",
      displayName: "Sparse Chat",
      baseURL: "https://sparse.invalid/v1",
      api: "openai-completions",
      models: [
        { id: "jxf/dsv4.1-flash", input: ["text"] },
        { id: "tx/deepseek-v4.1-chat", contextWindow: 128000, input: ["text"] },
        { id: "qwen/complete", contextWindow: 262144, maxTokens: 8192, input: ["text"] },
      ],
    },
    "all-sparse": {
      id: "all-sparse",
      baseURL: "https://all-sparse.invalid/v1",
      models: [{ id: "a/one" }, { id: "a/two" }],
    },
    "declared-route": {
      id: "declared-route",
      baseURL: "https://declared.invalid/v1",
      models: [{ id: "d/one", contextWindow: 128000, maxTokens: 4096 }],
    },
    "empty-route": {
      id: "empty-route",
      baseURL: "https://empty.invalid/v1",
      models: [],
    },
  };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };`;
  }
  return `${PROVIDER_SOURCE}
  const providers = { "preview-chat": previewChat, "backup-route": backupRoute, "spare-route": spareRoute };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };`;
}

function configFormsSource(schemaMode) {
  if (schemaMode === "schema") {
    return String.raw`
  const schemaOps = {
    rehydrate: (serialized) => serialized,
    nodeAtPath: (root, path) => (
      path.length === 3 && path[0] === "providers" && path[2] === "api" ? root : undefined
    ),
  };
  const schemaUnion = {
    type: "union",
    list: ${JSON.stringify(SCHEMA_PROTOCOLS.map((value) => ({ value })))},
  };
  const describe = () => ({
    getSnapshot: () => ({ view: { namespaces: [{ ns: "llm-pi-ai", schema: schemaUnion }] } }),
  });
  const configForms = { get: () => scope, whileServed: (namespaces, register) => register(new Set(namespaces)), describe, schema: schemaOps };
`;
  }
  return String.raw`
  const configForms = { get: () => scope, whileServed: (namespaces, register) => register(new Set(namespaces)) };
`;
}

const HELPERS = String.raw`
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
  const buttons = () => [...document.querySelectorAll("button")];
  const buttonByAria = (label) => buttons().find((element) => element.getAttribute("aria-label") === label);
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const setSelect = (select, value) => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const routeCard = () => document.querySelector('section[aria-label="路由设置"]');
  const routeSummary = () => document.querySelector('[aria-label="展开路由设置"], [aria-label="收起路由设置"]');
  const routeSelect = () => document.querySelector("select");
  const opsOf = () => {
    const label = [...document.querySelectorAll("summary")]
      .find((element) => element.textContent.includes("保存将写入的 settingsOps"));
    if (label === undefined) return null;
    return JSON.parse(label.parentElement.querySelector("pre").textContent);
  };
  const parseColor = (text) => {
    const match = String(text).match(/rgba?\(([^)]+)\)/);
    if (!match) return { r: 0, g: 0, b: 0, a: 0 };
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (foreground, background) => {
    const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
  };
  const effectiveBackground = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color.a > 0) layers.push(color);
      if (color.a === 1) break;
    }
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (let index = layers.length - 1; index >= 0; index--) background = over(layers[index], background);
    return background;
  };
  const styleOf = (element) => getComputedStyle(element);
`;

function multiProbe(schemaMode) {
  return String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
${fixtureSource("multi")}
  const mutations = [];
  const setPath = (root, path, value) => {
    let node = root;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    node[path[path.length - 1]] = value;
  };
  const unsetPath = (root, path) => {
    let node = root;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    const last = path[path.length - 1];
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => {
      const copy = JSON.parse(JSON.stringify(ops));
      mutations.push(copy);
      for (const op of copy) {
        if (op.op === "set") setPath(snapshot.value, op.path, op.value);
        else if (op.op === "unset") unsetPath(snapshot.value, op.path);
      }
      return true;
    },
  };
${configFormsSource(schemaMode)}
  let Workbench;
  let spec;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms,
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
${HELPERS}

  const result = { scheme: styleOf(document.documentElement).colorScheme };
  result.initial = {
    collapsed: routeCard() !== null && routeSummary()?.getAttribute("aria-expanded") === "false",
    summary: routeSummary()?.textContent.trim() ?? "",
    route: routeSelect().value,
  };

  // ── 1. 展开：九个字段预填、未改动保存禁用、协议选项来自 schema ──
  routeSummary().click();
  result.expanded = {
    open: routeSummary()?.getAttribute("aria-expanded") === "true",
    displayName: byAria("路由显示名").value,
    baseURL: byAria("路由接口地址").value,
    api: byAria("路由协议").value,
    apiKeyEnv: byAria("路由密钥引用").value,
    defaultContextWindow: byAria("路由默认上下文").value,
    defaultMaxTokens: byAria("路由默认输出上限").value,
    cacheRetention: byAria("路由缓存").value,
    transport: byAria("路由传输").value,
    timeoutMs: byAria("路由超时").value,
    saveDisabled: byAria("保存路由设置").disabled,
    deleteDisabled: byAria("删除路由").disabled,
    apiOptions: [...byAria("路由协议").options].map((option) => option.value),
    schemaHint: document.body.innerText.includes("选项来自宿主 schema"),
    fallbackNotice: document.body.innerText.includes("协议清单读取失败，使用内置列表"),
    defaultsHint: document.body.innerText.includes("未声明窗口 / 输出上限的模型回落到这两个值"),
    cacheOptions: [...byAria("路由缓存").options].map((option) => option.value),
    transportOptions: [...byAria("路由传输").options].map((option) => option.value),
    changed: document.body.innerText.includes("改动字段：无（保存已禁用）"),
    ops: opsOf(),
  };

  // ── 2. 改 baseURL + defaultMaxTokens：预览 2 条 set 叶子路径 ──
  setValue(byAria("路由接口地址"), "https://preview.invalid/v2");
  setValue(byAria("路由默认输出上限"), "16384");
  result.edit = {
    saveDisabled: byAria("保存路由设置").disabled,
    changed: document.body.innerText.includes("改动字段：接口地址 / 默认输出上限"),
    ops: opsOf(),
    opsSummary: [...document.querySelectorAll("summary")]
      .map((element) => element.textContent)
      .find((text) => text.includes("保存将写入的 settingsOps")) ?? "",
  };
  result.theme = {
    card: { background: styleOf(routeCard()).backgroundColor },
    select: {
      background: styleOf(byAria("路由协议")).backgroundColor,
      color: styleOf(byAria("路由协议")).color,
    },
    save: (() => {
      const button = byAria("保存路由设置");
      return {
        color: styleOf(button).color,
        background: styleOf(button).backgroundColor,
        ratio: contrast(parseColor(styleOf(button).color), effectiveBackground(button)),
      };
    })(),
    danger: (() => {
      const button = byAria("删除路由");
      return {
        color: styleOf(button).color,
        background: styleOf(button).backgroundColor,
        ratio: contrast(parseColor(styleOf(button).color), effectiveBackground(button)),
      };
    })(),
  };

  byAria("保存路由设置").click();
  await sleep(30);
  result.save = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    summaryAfter: routeSummary()?.textContent.trim() ?? "",
    provider: JSON.parse(JSON.stringify(providers["preview-chat"])),
    formAfter: {
      baseURL: byAria("路由接口地址").value,
      defaultMaxTokens: byAria("路由默认输出上限").value,
    },
  };

  // ── 3. 清空 displayName：1 条 unset 叶子路径 ──
  setValue(byAria("路由显示名"), "");
  result.clear = {
    saveDisabled: byAria("保存路由设置").disabled,
    changed: document.body.innerText.includes("改动字段：显示名"),
    ops: opsOf(),
  };
  byAria("保存路由设置").click();
  await sleep(30);
  result.clearSaved = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    displayName: providers["preview-chat"].displayName,
  };

  // ── 4. 删除确认：模型条数 + 不可撤销；取消不写 ──
  byAria("删除路由").click();
  result.deleteDialog = {
    open: byAria("删除路由确认") !== null,
    text: byAria("删除路由确认")?.innerText ?? "",
    background: styleOf(byAria("删除路由确认")).backgroundColor,
    color: styleOf(byAria("删除路由确认")).color,
    danger: (() => {
      const button = byAria("确认删除路由");
      return {
        color: styleOf(button).color,
        background: styleOf(button).backgroundColor,
        ratio: contrast(parseColor(styleOf(button).color), effectiveBackground(button)),
      };
    })(),
  };
  byAria("取消删除路由").click();
  result.deleteDialog.cancelled = byAria("删除路由确认") === null;
  result.deleteDialog.mutationsAfterCancel = mutations.length;

  // ── 5. 确认删除：1 条 unset 整条路由，选择器切到下一条路由 ──
  byAria("删除路由").click();
  byAria("确认删除路由").click();
  await sleep(30);
  result.remove = {
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    routes: Object.keys(providers),
    routeAfter: routeSelect().value,
    summaryAfter: routeSummary()?.textContent.trim() ?? "",
    listAfter: byAria("该路由的模型列表")?.innerText ?? "",
  };

  // ── 6. stale-route：弹窗打开期间路由被别处删掉，确认必须拒绝写入 ──
  routeSummary().click();
  byAria("删除路由").click();
  const removedRoute = providers["backup-route"];
  delete providers["backup-route"];
  byAria("确认删除路由").click();
  await sleep(30);
  result.staleDelete = {
    mutations: mutations.length,
    message: document.body.innerText.includes("stale-route"),
    routeStillMissing: providers["backup-route"] === undefined,
  };
  providers["backup-route"] = removedRoute;

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;
}

function usageProbe() {
  return String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
${fixtureSource("usage")}
  const mutations = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => { mutations.push(JSON.parse(JSON.stringify(ops))); return true; },
  };
${configFormsSource("schema")}
  let Workbench;
  let spec;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms,
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
${HELPERS}

  const defaultsBlock = () => document.querySelector('[aria-label="路由默认值说明"]');
  const blockText = () => defaultsBlock()?.innerText ?? "";
  // 计数行的「1 个」是按钮：按块内直接子元素的 textContent 取整句话
  // （innerText 在 flex/inline 边界上会吞掉空格或拆行）。
  const lineOf = (label) => {
    const block = defaultsBlock();
    if (block === null) return "";
    for (const child of [...block.children]) {
      const text = child.textContent.trim();
      if (text.startsWith(label + "：")) return text;
    }
    return "";
  };
  const usageButton = (prefix) => buttons()
    .find((element) => (element.getAttribute("aria-label") ?? "").startsWith(prefix));
  const clickUsage = (prefix) => {
    const button = usageButton(prefix);
    if (button === undefined) throw new Error("未找到计数按钮：" + prefix);
    button.click();
  };
  const listOf = (label) => document.querySelector('[aria-label="使用' + label + '的模型清单"]')?.innerText ?? "";
  const switchRoute = (value) => setSelect(routeSelect(), value);

  const result = { scheme: styleOf(document.documentElement).colorScheme };

  // ── 1. 两个默认值都留空：显示宿主内置回落常量，不显示计数 ──
  routeSummary().click();
  result.blank = {
    block: blockText(),
    windowLine: lineOf("默认上下文"),
    outputLine: lineOf("默认输出上限"),
    countButtons: buttons().filter((element) => (element.getAttribute("aria-label") ?? "").startsWith("展开使用")).length,
    mutations: mutations.length,
  };

  // ── 2. 只填窗口：窗口计数 1 个，输出上限仍是留空回落 ──
  setValue(byAria("路由默认上下文"), "1000000");
  result.windowTyped = {
    windowLine: lineOf("默认上下文"),
    outputLine: lineOf("默认输出上限"),
    block: blockText(),
    mutations: mutations.length,
  };

  // ── 3. 点「1 个」就地展开：写清那个模型未声明什么 ──
  clickUsage("展开使用默认上下文");
  result.windowExpanded = {
    list: listOf("默认上下文"),
    expanded: usageButton("收起使用默认上下文") !== undefined,
  };
  clickUsage("收起使用默认上下文");
  result.windowCollapsed = { list: listOf("默认上下文"), collapsed: listOf("默认上下文") === "" };

  // ── 4. 再填输出上限：两个计数各自算，输出上限 2 个受影响的模型 ──
  setValue(byAria("路由默认输出上限"), "32768");
  result.bothTyped = {
    windowLine: lineOf("默认上下文"),
    outputLine: lineOf("默认输出上限"),
    block: blockText(),
    mutations: mutations.length,
  };
  clickUsage("展开使用默认输出上限");
  result.outputExpanded = { list: listOf("默认输出上限") };

  // ── 5. 清空窗口默认值：实时回到留空回落，不需要保存 ──
  setValue(byAria("路由默认上下文"), "");
  result.windowCleared = {
    windowLine: lineOf("默认上下文"),
    outputLine: lineOf("默认输出上限"),
    windowListGone: listOf("默认上下文") === "",
    mutations: mutations.length,
  };
  setValue(byAria("路由默认上下文"), "1000000");

  // ── 6. 全部模型都会受影响 ──
  switchRoute("all-sparse");
  routeSummary().click();
  setValue(byAria("路由默认上下文"), "1000000");
  setValue(byAria("路由默认输出上限"), "32768");
  result.allAffected = {
    block: blockText(),
    windowLine: lineOf("默认上下文"),
    outputLine: lineOf("默认输出上限"),
  };

  // ── 7. 全部模型都声明了自己的值 ──
  switchRoute("declared-route");
  routeSummary().click();
  setValue(byAria("路由默认上下文"), "1000000");
  setValue(byAria("路由默认输出上限"), "32768");
  result.noneAffected = {
    block: blockText(),
    windowLine: lineOf("默认上下文"),
    outputLine: lineOf("默认输出上限"),
  };

  // ── 8. 路由没有模型：不显示计数行（留空回落仍要说） ──
  switchRoute("empty-route");
  routeSummary().click();
  setValue(byAria("路由默认上下文"), "1000000");
  setValue(byAria("路由默认输出上限"), "32768");
  result.empty = {
    block: blockText(),
    windowLine: lineOf("默认上下文"),
    outputLine: lineOf("默认输出上限"),
    hasCountText: blockText().includes("当前路由"),
    emptyListHint: document.body.innerText.includes("该路由没有模型"),
    mutations: mutations.length,
  };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;
}

function oneRouteProbe() {
  return String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
${fixtureSource("one")}
  const mutations = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => { mutations.push(JSON.parse(JSON.stringify(ops))); return true; },
  };
${configFormsSource("fallback")}
  let Workbench;
  let spec;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms,
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
  window.__renderComponent(Workbench, spec.inject());
${HELPERS}

  routeSummary().click();
  const result = {
    scheme: styleOf(document.documentElement).colorScheme,
    collapsedSummary: "",
    deleteDisabled: byAria("删除路由").disabled,
    lastRouteHint: document.body.innerText.includes("至少要保留一个路由"),
    fallbackNotice: document.body.innerText.includes("协议清单读取失败，使用内置列表"),
    apiOptions: [...byAria("路由协议").options].map((option) => option.value),
    saveDisabled: byAria("保存路由设置").disabled,
    summary: routeSummary()?.textContent.trim() ?? "",
    mutations: mutations.length,
  };
  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;
}

/** 以指定主题 / 夹具变体组装路由设置页。 */
export function buildRouteEditHtml(bundleSource, scheme, { routeMode = "multi", schemaMode = "schema" } = {}) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  const probe = routeMode === "one"
    ? oneRouteProbe()
    : routeMode === "usage"
      ? usageProbe()
      : multiProbe(schemaMode);
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
    `<script>${probe}</script>`,
    "</body></html>",
  ].join("\n");
}
