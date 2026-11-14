// 工单 #21 的浏览器夹具：路由选择器旁的「+ 新建路由」与弹窗。
//
// 和 route-edit-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，在 headless Chrome 里做真实点击、等待宿主目录返回、读回
// mutate 参数 / 路由选择 / 密钥状态 / 计算样式。断言在 new-route.test.mjs。

import { SHIM_SOURCE, THEME_TOKENS, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

const CATALOG_SOURCE = String.raw`
  const catalog = [
    { provider: "anthropic", displayName: "Anthropic", settingsNs: "llm-pi-ai", settingsPath: ["providers", "anthropic"], declared: false },
    { provider: "minimax-cn", displayName: "MiniMax CN", settingsNs: "llm-pi-ai", settingsPath: ["providers", "minimax-cn"], declared: false },
    { provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai", settingsPath: ["providers", "openai"], declared: false },
    { provider: "preview-chat", displayName: "Preview Chat", settingsNs: "llm-pi-ai", settingsPath: ["providers", "preview-chat"], declared: false },
    { provider: "deepseek", displayName: "DeepSeek", settingsNs: "llm-deepseek", settingsPath: ["providers", "deepseek"] },
  ];
`;

/** 所有场景共用的宿主夹具与 DOM 工具；每个场景只在后面追加自己的操作。 */
const COMMON_SOURCE = String.raw`
(async () => {
  try {
    const client = window.__CLIENT__;
    if (!client) throw new Error("client bundle did not register");

    const previewChat = {
      id: "preview-chat",
      displayName: "Preview Chat",
      baseURL: "https://preview.invalid/v1",
      api: "openai-completions",
      apiKeyEnv: "PREVIEW_CHAT_API_KEY",
      defaultContextWindow: 1000000,
      defaultMaxTokens: 32768,
      models: [
        { id: "jxf/dsv4.1-flash", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
        { id: "jxf/dsv4.1-pro", contextWindow: 1000000, maxTokens: 32768, input: ["text"] },
      ],
    };
    __PROVIDERS__
    let snapshot = {
      status: "ready",
      value: { providers },
      user: { providers },
      revision: 1,
      writable: true,
    };
    const listeners = new Set();
    const mutations = [];
    const credentialCalls = [];
    let failMutations = false;
    let catalogCalls = 0;
    let heldCatalog = null;
    const HOLD_CATALOG = __HOLD__;
${CATALOG_SOURCE}

    const listConfigurableProviders = () => {
      catalogCalls += 1;
      if (HOLD_CATALOG && catalogCalls === 1) {
        return new Promise((resolve) => { heldCatalog = resolve; });
      }
      return Promise.resolve({ ok: true, value: catalog });
    };

    const scope = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      mutate: async (ops) => {
        const copy = JSON.parse(JSON.stringify(ops));
        mutations.push(copy);
        if (failMutations) return false;
        for (const op of copy) {
          if (op.op === "set" && op.path.length === 2 && op.path[0] === "providers") {
            const providers = {
              ...snapshot.value.providers,
              [op.path[1]]: JSON.parse(JSON.stringify(op.value)),
            };
            snapshot = {
              ...snapshot,
              revision: snapshot.revision + 1,
              value: { ...snapshot.value, providers },
            };
          }
        }
        for (const listener of listeners) listener();
        return true;
      },
    };

    const discoverModels = async () => ({ ok: true, value: [] });
    const credentialOps = {
      describe: async (refs) => {
        credentialCalls.push([...refs]);
        return {
          ok: true,
          value: Object.fromEntries(refs.map((ref) => [ref, {
            configured: ref === "MY_RELAY_API_KEY",
            writable: true,
          }])),
        };
      },
      set: async () => ({ ok: true, value: undefined }),
      unset: async () => ({ ok: true, value: undefined }),
    };

    const configForms = {
      get: () => scope,
      whileServed: (namespaces, register) => register(new Set(namespaces)),
    };
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
      remote: {
        llm: { discoverModels, listConfigurableProviders },
        credentials: credentialOps,
      },
    };
    client.apply(ctx);
    if (typeof Workbench !== "function") throw new Error("workbench component not registered");
    window.__renderComponent(Workbench, spec.inject());

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
    const buttons = () => [...document.querySelectorAll("button")];
    const buttonByText = (text) => buttons().find((element) => element.textContent.trim() === text);
    const buttonByAria = (label) => buttons().find((element) => element.getAttribute("aria-label") === label);
    const dialog = () => document.querySelector('[role="dialog"][aria-label="新建路由"]');
    const overlay = () => dialog()?.parentElement ?? null;
    const routeSelect = () => document.querySelector('section[aria-label="当前路由"] select');
    const routeCardSummary = () => document.querySelector('[aria-label="展开路由设置"], [aria-label="收起路由设置"]');
    const cardOpen = () => document.querySelector('[aria-label="收起路由设置"]') !== null;
    const createButton = () => buttons().find((element) => {
      const text = element.textContent.trim();
      return text === "创建路由" || text === "创建中…";
    });
    const fieldText = (ariaLabel) => byAria(ariaLabel)?.closest("label")?.innerText ?? "";
    const styleOf = (element) => getComputedStyle(element);
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setSelect = (select, value) => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const catalogRows = () => [...document.querySelectorAll('[role="listbox"][aria-label="可配置提供商"] label')].map((label) => {
      const input = label.querySelector("input[type=radio]");
      return {
        provider: input?.getAttribute("aria-label") ?? "",
        disabled: input?.disabled === true,
        checked: input?.checked === true,
        text: label.textContent.trim(),
        opacity: styleOf(label).opacity,
      };
    });
    const openDialog = async (wait = 30) => {
      buttonByAria("新建路由").click();
      if (wait > 0) await sleep(wait);
    };
    const pickCustom = async () => {
      byAria("自定义").click();
      await sleep(10);
    };
    const routeFields = () => ({
      baseURL: byAria("路由接口地址")?.value ?? null,
      api: byAria("路由协议")?.value ?? null,
      apiKeyEnv: byAria("路由密钥引用")?.value ?? null,
    });
    const credentialStatus = () => byAria("密钥状态")?.innerText ?? "";

    const scenario = "__SCENARIO__";
    const result = {
      scenario,
      scheme: styleOf(document.documentElement).colorScheme,
      initial: {
        createButton: byAria("新建路由")?.textContent.trim() ?? null,
        route: routeSelect()?.value ?? null,
        emptyWarning: document.body.innerText.includes("当前没有配置 pi-ai 路由"),
        routes: [...(routeSelect()?.options ?? [])].map((option) => option.value),
      },
    };

__BODY__

    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

function scenarioBody(scenario) {
  if (scenario === "first-route") {
    return String.raw`
    // 一条路由都没有：按钮必须仍可用；建完立刻切过去并展开卡片。
    await openDialog();
    byAria("anthropic").click();
    result.pick = { createDisabled: createButton().disabled };
    createButton().click();
    await sleep(40);
    result.after = {
      mutations: mutations.length,
      op: mutations[0],
      dialogOpen: dialog() !== null,
      route: routeSelect()?.value ?? null,
      routes: [...(routeSelect()?.options ?? [])].map((option) => option.value),
      emptyWarning: document.body.innerText.includes("当前没有配置 pi-ai 路由"),
      cardOpen: cardOpen(),
      provider: snapshot.value.providers["anthropic"] ?? null,
      credentialCalls: credentialCalls.length,
    };
`;
  }
  if (scenario === "catalog") {
    return String.raw`
    await openDialog(0);
    result.loading = {
      text: dialog()?.innerText.includes("正在读取宿主目录…") === true,
      dialogOpen: dialog() !== null,
      dialogText: dialog()?.innerText ?? null,
      catalogCalls,
    };
    heldCatalog({ ok: true, value: catalog });
    await sleep(30);
    result.rows = catalogRows();
    result.dialog = {
      open: dialog() !== null,
      text: dialog()?.innerText ?? "",
      title: dialog()?.querySelector("span")?.textContent ?? "",
    };

    setValue(byAria("搜索提供商"), "mini");
    result.filtered = catalogRows().map((row) => row.provider);
    setValue(byAria("搜索提供商"), "");
    result.unfiltered = catalogRows().map((row) => row.provider);

    byAria("minimax-cn").click();
    result.selected = {
      createDisabled: createButton().disabled,
      checked: byAria("minimax-cn").checked,
    };
    createButton().click();
    await sleep(40);
    result.after = {
      mutations: mutations.length,
      op: mutations[0],
      dialogOpen: dialog() !== null,
      route: routeSelect()?.value ?? null,
      routes: [...(routeSelect()?.options ?? [])].map((option) => option.value),
      cardOpen: cardOpen(),
      provider: snapshot.value.providers["minimax-cn"] ?? null,
      toast: document.body.innerText.includes("已创建路由 minimax-cn"),
      credentialCalls: credentialCalls.length,
    };

    // 再打开一次：刚建的路由应变为「已配置」且不可再选。
    await openDialog();
    result.reopened = catalogRows();
    buttonByText("取消").click();
    result.closedByCancel = dialog() === null;
`;
  }
  if (scenario === "custom") {
    return String.raw`
    await openDialog();
    await pickCustom();
    result.fields = {
      provider: byAria("provider id")?.value ?? null,
      baseURL: byAria("接口地址")?.value ?? null,
      protocol: byAria("协议")?.value ?? null,
      protocolOptions: [...(byAria("协议")?.options ?? [])].map((option) => option.value),
      keyRef: byAria("密钥引用")?.value ?? null,
      modelsVisible: byAria("模型 ID") !== null,
      dialogBg: styleOf(dialog()).backgroundColor,
      dialogColor: styleOf(dialog()).color,
    };

    // 0. 只填 provider id、接口地址留空：就地报错、创建禁用、不产出 op。
    setValue(byAria("provider id"), "my-relay");
    result.emptyBaseURL = {
      error: fieldText("接口地址"),
      createDisabled: createButton().disabled,
      mutations: mutations.length,
    };

    // 1. provider id 非法：就地报错、创建禁用、不产出 op。
    setValue(byAria("provider id"), "My-Relay");
    setValue(byAria("接口地址"), "https://relay.invalid/v1");
    setValue(byAria("模型 ID"), "relay/one");
    result.invalidId = {
      error: fieldText("provider id"),
      createDisabled: createButton().disabled,
      mutations: mutations.length,
    };

    // 2. 与已存在路由重名：禁用 + 「该路由已存在」；目录里有它时模型输入收起。
    setValue(byAria("provider id"), "preview-chat");
    result.duplicate = {
      error: fieldText("provider id"),
      createDisabled: createButton().disabled,
      modelsVisible: byAria("模型 ID") !== null,
      mutations: mutations.length,
    };

    // 3. 接口地址不是 http(s)://：就地报错、创建禁用。
    setValue(byAria("provider id"), "my-relay");
    setValue(byAria("接口地址"), "ftp://relay.invalid/v1");
    result.badBaseURL = {
      error: fieldText("接口地址"),
      createDisabled: createButton().disabled,
      mutations: mutations.length,
    };

    // 4. 目录外的路由没有模型：禁用 + 提示；补上模型后恢复可创建。
    setValue(byAria("接口地址"), "https://relay.invalid/v1");
    setValue(byAria("模型 ID"), "");
    result.missingModels = {
      error: fieldText("模型 ID"),
      createDisabled: createButton().disabled,
      mutations: mutations.length,
    };
    setValue(byAria("模型 ID"), "relay/alpha, relay/beta, relay/alpha");
    setValue(byAria("密钥引用"), "MY_RELAY_API_KEY");
    result.ready = {
      createDisabled: createButton().disabled,
      protocol: byAria("协议")?.value,
      modelsVisible: byAria("模型 ID") !== null,
      hint: dialog()?.innerText.includes("目录未描述") === true,
    };

    createButton().click();
    await sleep(60);
    result.after = {
      mutations: mutations.length,
      op: mutations[0],
      dialogOpen: dialog() !== null,
      route: routeSelect()?.value ?? null,
      cardOpen: cardOpen(),
      summary: routeCardSummary()?.textContent.trim() ?? "",
      fields: routeFields(),
      provider: snapshot.value.providers["my-relay"] ?? null,
      credentialCalls,
      credentialStatus: credentialStatus(),
      toast: document.body.innerText.includes("已创建路由 my-relay"),
    };
`;
  }
  if (scenario === "custom-known") {
    return String.raw`
    await openDialog();
    await pickCustom();
    setValue(byAria("provider id"), "anthropic");
    setValue(byAria("接口地址"), "https://proxy.invalid/anthropic");
    result.known = {
      modelsVisible: byAria("模型 ID") !== null,
      hint: dialog()?.innerText.includes("无需列出模型") === true,
      providerHint: fieldText("provider id"),
      createDisabled: createButton().disabled,
    };
    createButton().click();
    await sleep(40);
    result.after = {
      mutations: mutations.length,
      op: mutations[0],
      dialogOpen: dialog() !== null,
      route: routeSelect()?.value ?? null,
      fields: routeFields(),
      cardOpen: cardOpen(),
    };
`;
  }
  if (scenario === "failure") {
    return String.raw`
    await openDialog();
    await pickCustom();
    setValue(byAria("provider id"), "my-relay");
    setValue(byAria("接口地址"), "https://relay.invalid/v1");
    setValue(byAria("模型 ID"), "relay/one");
    setValue(byAria("密钥引用"), "MY_RELAY_API_KEY");
    failMutations = true;
    createButton().click();
    await sleep(40);
    result.failed = {
      mutations: mutations.length,
      dialogOpen: dialog() !== null,
      error: dialog()?.innerText.includes("创建被宿主拒绝") === true,
      provider: byAria("provider id")?.value ?? null,
      baseURL: byAria("接口地址")?.value ?? null,
      models: byAria("模型 ID")?.value ?? null,
      routeStillAbsent: snapshot.value.providers["my-relay"] === undefined,
    };
    failMutations = false;
    createButton().click();
    await sleep(40);
    result.recovered = {
      mutations: mutations.length,
      dialogOpen: dialog() !== null,
      route: routeSelect()?.value ?? null,
      cardOpen: cardOpen(),
      provider: snapshot.value.providers["my-relay"] ?? null,
    };
`;
  }
  if (scenario === "theme") {
    return String.raw`
    await openDialog();
    const dialogElement = dialog();
    const rows = catalogRows();
    result.theme = {
      dialog: {
        background: styleOf(dialogElement).backgroundColor,
        color: styleOf(dialogElement).color,
        colorScheme: styleOf(dialogElement).colorScheme,
        width: Math.round(dialogElement.getBoundingClientRect().width),
      },
      overlay: { background: styleOf(overlay()).backgroundColor, position: styleOf(overlay()).position },
      normalRow: { opacity: rows.find((row) => !row.disabled)?.opacity ?? null },
      disabledRow: { opacity: rows.find((row) => row.disabled)?.opacity ?? null },
      statuses: rows.map((row) => row.text.match(/已配置|未配置/)?.[0] ?? ""),
      search: {
        background: styleOf(byAria("搜索提供商")).backgroundColor,
        color: styleOf(byAria("搜索提供商")).color,
        colorScheme: styleOf(byAria("搜索提供商")).colorScheme,
      },
      create: {
        color: styleOf(createButton()).color,
        background: styleOf(createButton()).backgroundColor,
        disabled: createButton().disabled,
      },
    };
    await pickCustom();
    result.theme.custom = {
      input: {
        background: styleOf(byAria("provider id")).backgroundColor,
        color: styleOf(byAria("provider id")).color,
      },
      select: {
        background: styleOf(byAria("协议")).backgroundColor,
        color: styleOf(byAria("协议")).color,
        colorScheme: styleOf(byAria("协议")).colorScheme,
      },
    };
`;
  }
  throw new Error(`未知场景：${scenario}`);
}

/** 组装一个完全自包含的 file:// 测试页：React 桩 → 打包产物 → 场景探针。 */
export function buildNewRouteHtml(bundleSource, options = {}) {
  const scenario = options.scenario ?? "catalog";
  const scheme = options.scheme ?? "light";
  if (!Object.hasOwn(THEME_TOKENS, scheme)) throw new TypeError(`未知主题：${scheme}`);
  const providers = options.emptyProviders
    ? "const providers = {};"
    : "const providers = { \"preview-chat\": previewChat };";
  const common = COMMON_SOURCE
    .replace("__PROVIDERS__", providers)
    .replace("__HOLD__", String(options.holdCatalog === true))
    .replace("__SCENARIO__", scenario)
    .replace("__BODY__", scenarioBody(scenario));
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${common}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
