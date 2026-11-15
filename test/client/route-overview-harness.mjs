// 工单 #24 的浏览器夹具：全部路由总览 + 批量密钥状态。
//
// 和 api-key-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，在 headless Chrome 里做真实点击，读回 describe 调用参数、
// 行文案、三态圆点的计算对比度与行 hover 反馈。断言在
// test/client/route-overview.test.mjs 里。
//
// 场景：
//   mixed     6 条路由（插入顺序故意乱序；两条共用 SHARED_API_KEY）
//   loading   describe 延迟 300ms，用于验证「正在读取」不冒充「未配置」
//   batch65   65 条唯一引用 → 64 + 1 两批
//   batch128  128 条唯一引用 → 64 + 64 两批
//   partial   65 条，第二批失败 → 该批及之后为未知，可重试
//
// 截图模式（buildRouteOverviewScreenshotHtml）复用同一份 mixed 夹具，
// 只把探针结果隐藏，保留真实页面。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

const MIXED_PROVIDERS = Object.freeze({
  "zeta-chat": { apiKeyEnv: "ZETA_API_KEY", api: "openai-completions", models: [{ id: "zeta/one" }] },
  "alpha-chat": {
    apiKeyEnv: "ALPHA_API_KEY",
    api: "openai-completions",
    models: [{ id: "alpha/one" }, { id: "alpha/two" }, { id: "alpha/three" }],
  },
  "beta-relay": { api: "anthropic-messages", models: [{ id: "beta/one" }, { id: "beta/two" }] },
  "gamma-local": { api: "", models: [] },
  "delta-claude": { apiKeyEnv: "SHARED_API_KEY", api: "openai-responses", models: [{ id: "delta/one" }] },
  "epsilon-relay": {
    apiKeyEnv: "SHARED_API_KEY",
    api: "ollama",
    models: [{ id: "e1" }, { id: "e2" }, { id: "e3" }, { id: "e4" }],
  },
});

const MIXED_STORE = Object.freeze({
  ZETA_API_KEY: { configured: true, writable: true },
  ALPHA_API_KEY: { configured: true, writable: false },
  BETA_RELAY_API_KEY: { configured: false, writable: true },
  GAMMA_LOCAL_API_KEY: { configured: true, writable: true },
  SHARED_API_KEY: { configured: false, writable: true },
  // 改 apiKeyEnv 后才会被引用的新条目：已配置，用来证明快照变化后总览真的重查了。
  NEW_BETA_KEY: { configured: true, writable: true },
});

function bulkProviders(count) {
  const providers = {};
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(3, "0");
    providers[`route-${suffix}`] = {
      apiKeyEnv: `ROUTE_${suffix}_KEY`,
      api: "openai-completions",
      models: [{ id: `route-${suffix}/m1` }],
    };
  }
  return providers;
}

function configuredStore(providers) {
  const store = {};
  for (const provider of Object.values(providers)) {
    if (typeof provider.apiKeyEnv === "string") store[provider.apiKeyEnv] = { configured: true, writable: true };
  }
  return store;
}

/**
 * 渲染页面所需的宿主夹具：快照 + 可通知的订阅 + describe / set / unset。
 * `failSecondBatch` 只在第二批（refs.length === 1）失败一次，重试后成功。
 */
function setupSource({ providers, store, delayMs = 0, failSecondBatch = false }) {
  return String.raw`
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
  const providers = ${JSON.stringify(providers)};
  const credentialStore = ${JSON.stringify(store)};
  let snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const subscribers = new Set();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const setPath = (root, path, value) => {
    let node = root;
    for (let index = 0; index < path.length - 1; index += 1) node = node[path[index]];
    node[path[path.length - 1]] = value;
  };
  const unsetPath = (root, path) => {
    let node = root;
    for (let index = 0; index < path.length - 1; index += 1) node = node[path[index]];
    const last = path[path.length - 1];
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    mutate: async (ops) => {
      const copy = clone(ops);
      for (const op of copy) {
        if (op.op === "set") setPath(snapshot.value, op.path, op.value);
        else if (op.op === "unset") unsetPath(snapshot.value, op.path);
      }
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value },
        user: { ...snapshot.user },
        revision: snapshot.revision + 1,
      };
      for (const listener of [...subscribers]) listener();
      return true;
    },
  };
  const calls = { describe: [], set: [], unset: [] };
  let failArmed = ${failSecondBatch ? "true" : "false"};
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
      llm: {
        discoverModels: async () => ({ ok: true, value: [] }),
        listConfigurableProviders: async () => ({ ok: true, value: [] }),
      },
      credentials: {
        describe: async (refs) => {
          calls.describe.push([...refs]);
          ${delayMs > 0 ? `await new Promise((resolve) => setTimeout(resolve, ${delayMs}));` : ""}
          if (failArmed && refs.length === 1) {
            failArmed = false;
            return { ok: false, error: { code: "gateway/internal", message: "凭据服务不可用" } };
          }
          const value = {};
          for (const ref of refs) {
            value[ref] = credentialStore[ref] === undefined
              ? { configured: false, writable: true }
              : { ...credentialStore[ref] };
          }
          return { ok: true, value };
        },
        set: async (ref, value) => {
          calls.set.push([ref, value]);
          credentialStore[ref] = { configured: true, writable: true };
          return { ok: true, value: undefined };
        },
        unset: async (ref) => {
          calls.unset.push(ref);
          credentialStore[ref] = { configured: false, writable: true };
          return { ok: true, value: undefined };
        },
      },
    },
  };
  client.apply(ctx);
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, spec.inject());
  `;
}

const HELPERS_SOURCE = String.raw`
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
  const routeSelect = () => document.querySelector('section[aria-label="当前路由"] select');
  const headerText = () => {
    const button = byAria("展开全部路由") ?? byAria("收起全部路由");
    return (button?.innerText ?? "").replace(/ⓘ/g, "").replace(/\s+/g, " ").trim();
  };
  const table = () => byAria("全部路由清单");
  const rows = () => [...(table()?.querySelectorAll("tbody tr") ?? [])];
  const rowOf = (id) => byAria("路由 " + id);
  const cellTexts = (row) => [...row.querySelectorAll("td")].map((cell) => cell.innerText.replace(/\s+/g, " ").trim());
  const rowSummary = () => rows().map((row) => ({
    id: row.getAttribute("aria-label").replace(/^路由 /, ""),
    cells: cellTexts(row),
  }));
  const styleOf = (element) => getComputedStyle(element);
  const parseColor = (text) => {
    const match = String(text).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(",").map((part) => Number(part.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const blend = (front, back) => ({
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  });
  const backgroundOf = (element) => {
    const layers = [];
    let node = element;
    while (node !== null) {
      const color = parseColor(styleOf(node).backgroundColor);
      if (color !== null && color.a > 0) layers.push(color);
      node = node.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let index = layers.length - 1; index >= 0; index -= 1) base = blend(layers[index], base);
    return base;
  };
  const luminance = (color) => {
    const channel = (value) => {
      const text = value / 255;
      return text <= 0.03928 ? text / 12.92 : Math.pow((text + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const contrast = (front, back) => {
    const left = luminance(front);
    const right = luminance(back);
    const lighter = Math.max(left, right);
    const darker = Math.min(left, right);
    return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
  };
  const keyCell = (id) => byAria("密钥状态 " + id);
  const keyTextOf = (id) => (keyCell(id)?.innerText ?? "").replace(/\s+/g, " ").trim();
  const dotInfo = (id) => {
    const cell = keyCell(id);
    if (cell === null) return null;
    const dot = [...cell.querySelectorAll("span")].find((span) => span.getAttribute("aria-hidden") === "true");
    if (dot === undefined) return null;
    const label = [...cell.querySelectorAll("span")].find((span) => !span.getAttribute("aria-hidden") && span.textContent.trim() !== "");
    const dotStyle = styleOf(dot);
    const dotBackground = backgroundOf(dot);
    return {
      glyph: dot.textContent,
      color: dotStyle.color,
      background: dotStyle.backgroundColor,
      borderColor: dotStyle.borderTopColor,
      dotContrast: contrast(parseColor(dotStyle.color), dotBackground),
      labelContrast: label === undefined
        ? null
        : contrast(parseColor(styleOf(label).color), backgroundOf(label)),
    };
  };
  const rowBackground = (id) => styleOf(rowOf(id)).backgroundColor;
  const rowTransition = (id) => {
    const style = styleOf(rowOf(id));
    return { property: style.transitionProperty, duration: style.transitionDuration };
  };
  const openRouteCard = async () => {
    const button = byAria("展开路由设置");
    if (button !== null) button.click();
    await sleep(120);
  };
  const describeLengths = () => calls.describe.map((refs) => refs.length);
`;

const MIXED_PROBE_SOURCE = String.raw`
(async () => {
  try {
    const result = {};
    await sleep(60);

    // ── 1. 折叠（默认）：不发 describe，标题只报条数 ──
    result.stage = "collapsed";
    result.collapsed = {
      header: headerText(),
      describes: calls.describe.length,
      hasTable: table() !== null,
    };

    // ── 2. 展开：一批查完 5 个去重引用，行按 id 字母序 ──
    result.stage = "expanded";
    byAria("展开全部路由").click();
    await sleep(120);
    result.expanded = {
      header: headerText(),
      expanded: byAria("收起全部路由")?.getAttribute("aria-expanded") ?? null,
      describeCalls: calls.describe.map((refs) => [...refs]),
      rows: rowSummary(),
      keyTexts: Object.fromEntries(rows().map((row) => {
        const id = row.getAttribute("aria-label").replace(/^路由 /, "");
        return [id, keyTextOf(id)];
      })),
      dots: {
        configured: dotInfo("alpha-chat"),
        unconfigured: dotInfo("beta-relay"),
      },
      selected: routeSelect()?.value ?? null,
      modelsTitle: document.querySelector('section[aria-label="该路由的模型列表"]')?.firstElementChild?.innerText ?? "",
    };

    // ── 3. 行 hover：背景变化 + 120ms 过渡 ──
    result.hover = {
      before: rowBackground("gamma-local"),
      transition: rowTransition("gamma-local"),
    };
    rowOf("gamma-local").dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    await sleep(60);
    result.hover.after = rowBackground("gamma-local");

    // ── 4. 点非当前行：切换路由，总览保持展开 ──
    result.stage = "switched";
    rowOf("beta-relay").click();
    await sleep(120);
    result.switched = {
      selected: routeSelect()?.value ?? null,
      overviewExpanded: byAria("收起全部路由") !== null,
      overviewHeader: headerText(),
      modelsTitle: document
        .querySelector('section[aria-label="该路由的模型列表"]')
        ?.firstElementChild?.innerText ?? "",
      routeCardExpanded: byAria("展开路由设置")?.getAttribute("aria-expanded") ?? null,
      describes: calls.describe.length,
    };

    // ── 5. 点当前行：不做任何事（不重置、不重新查询） ──
    rowOf("beta-relay").click();
    await sleep(80);
    result.currentRowClick = {
      selected: routeSelect()?.value ?? null,
      describes: calls.describe.length,
      overviewExpanded: byAria("收起全部路由") !== null,
    };

    // ── 6. 折叠后不再查询；重新展开才再查一次 ──
    result.stage = "collapsedAgain";
    byAria("收起全部路由").click();
    await sleep(100);
    result.collapsedAgain = {
      header: headerText(),
      describes: calls.describe.length,
      hasTable: table() !== null,
    };
    byAria("展开全部路由").click();
    await sleep(120);
    result.reopened = { describes: calls.describe.length, header: headerText() };

    // ── 7. 设置 / 清除密钥 → credentialRefresh → 总览自动重查 ──
    result.stage = "setKey";
    await openRouteCard();
    // beta-relay 没有声明 apiKeyEnv：先采用派生建议，才有「设置密钥」入口。
    buttonByAria("采用引用名建议")?.click();
    await sleep(120);
    buttonByAria("设置密钥").click();
    await sleep(20);
    setValue(byAria("密钥值"), "  overview-secret  ");
    buttonByAria("保存密钥").click();
    await sleep(160);
    result.setKey = {
      setCalls: calls.set.map(([ref, value]) => ({ ref, value })),
      describes: calls.describe.length,
      overviewCalls: calls.describe.map((refs) => [...refs]),
      keyText: keyTextOf("beta-relay"),
      header: headerText(),
      secretInBodyText: document.body.innerText.includes("overview-secret"),
      secretInStorage: (() => {
        try {
          return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes("overview-secret");
        } catch {
          return false;
        }
      })(),
    };
    buttonByAria("清除密钥").click();
    await sleep(30);
    buttonByAria("确认清除密钥").click();
    await sleep(160);
    result.clearKey = {
      unsetCalls: [...calls.unset],
      describes: calls.describe.length,
      keyText: keyTextOf("beta-relay"),
      header: headerText(),
    };

    // ── 8. 改 apiKeyEnv 并保存 → 快照订阅 + 新 describe ──
    result.stage = "changedRef";
    setValue(byAria("路由密钥引用"), "NEW_BETA_KEY");
    await sleep(60);
    buttonByAria("保存路由设置").click();
    await sleep(200);
    result.changedRef = {
      selected: routeSelect()?.value ?? null,
      keyText: keyTextOf("beta-relay"),
      header: headerText(),
      overviewCalls: calls.describe.map((refs) => [...refs]),
      mutations: document.body.innerText.includes("已保存路由设置 beta-relay"),
    };

    // ── 9. 增 / 删路由（宿主快照变化）→ 总览行与 describe 自动跟上 ──
    result.stage = "addedRoute";
    await scope.mutate([{
      op: "set",
      path: ["providers", "theta-added"],
      value: { api: "openai-completions", models: [{ id: "theta/one" }] },
    }]);
    await sleep(160);
    result.addedRoute = {
      hasRow: rowOf("theta-added") !== null,
      rows: rows().length,
      header: headerText(),
      overviewCalls: calls.describe.map((refs) => [...refs]),
      keyText: keyTextOf("theta-added"),
    };
    await scope.mutate([{ op: "unset", path: ["providers", "zeta-chat"] }]);
    await sleep(160);
    result.deletedRoute = {
      hasRow: rowOf("zeta-chat") !== null,
      rows: rows().length,
      header: headerText(),
      overviewCalls: calls.describe.map((refs) => [...refs]),
    };

    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({
      __error: String(error),
      stage: result.stage,
      partial: result,
      stack: error.stack,
    });
  }
})();
`;

const LOADING_PROBE_SOURCE = String.raw`
(async () => {
  try {
    const result = {};
    await sleep(60);
    byAria("展开全部路由").click();
    await sleep(20);
    result.loading = {
      header: headerText(),
      statusText: byAria("全部路由密钥状态")?.innerText ?? "",
      bodyText: document.body.innerText,
      keyTexts: Object.fromEntries(rows().map((row) => {
        const id = row.getAttribute("aria-label").replace(/^路由 /, "");
        return [id, keyTextOf(id)];
      })),
      describes: calls.describe.length,
    };
    await sleep(500);
    result.ready = {
      header: headerText(),
      statusPresent: byAria("全部路由密钥状态") !== null,
      keyTexts: Object.fromEntries(rows().map((row) => {
        const id = row.getAttribute("aria-label").replace(/^路由 /, "");
        return [id, keyTextOf(id)];
      })),
    };
    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

const BATCH_PROBE_SOURCE = String.raw`
(async () => {
  try {
    const result = {};
    await sleep(60);
    byAria("展开全部路由").click();
    await sleep(250);
    result.batch = {
      header: headerText(),
      describeLengths: describeLengths(),
      describeCalls: calls.describe.map((refs) => [...refs]),
      rowCount: rows().length,
      keyTexts: Object.fromEntries(rows().map((row) => {
        const id = row.getAttribute("aria-label").replace(/^路由 /, "");
        return [id, keyTextOf(id)];
      })),
    };
    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

const PARTIAL_PROBE_SOURCE = String.raw`
(async () => {
  try {
    const result = {};
    await sleep(60);
    byAria("展开全部路由").click();
    await sleep(250);
    const lastId = rows().at(-1)?.getAttribute("aria-label").replace(/^路由 /, "");
    result.failed = {
      header: headerText(),
      describeLengths: describeLengths(),
      rowCount: rows().length,
      lastId,
      firstKey: keyTextOf("route-000"),
      lastKey: keyTextOf(lastId),
      warning: byAria("全部路由密钥状态读取失败")?.innerText ?? "",
      dot: dotInfo(lastId),
      firstDot: dotInfo("route-000"),
      unknownRowLabelContrast: (() => {
        const cell = byAria("密钥状态 " + lastId);
        const label = [...cell.querySelectorAll("span")].find((span) => !span.getAttribute("aria-hidden") && span.textContent.trim() !== "");
        return label === undefined ? null : contrast(parseColor(styleOf(label).color), backgroundOf(label));
      })(),
    };
    byAria("重试读取全部路由密钥状态").click();
    await sleep(250);
    result.retried = {
      header: headerText(),
      describeLengths: describeLengths(),
      lastKey: keyTextOf(lastId),
      warningPresent: byAria("全部路由密钥状态读取失败") !== null,
    };
    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

function pageShell(bundleSource, scheme, script, { hideResult = false } = {}) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="zh" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#result { white-space: pre-wrap; font-size: 11px; }\n${hideResult ? "#result { display: none; }" : ""}</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${script}</script>`,
    "</body></html>",
  ].join("\n");
}

/** 场景 → 页面。scenario 见文件头注释。 */
export function buildRouteOverviewHtml(bundleSource, scheme, scenario = "mixed") {
  if (scenario === "mixed") {
    const setup = setupSource({ providers: MIXED_PROVIDERS, store: MIXED_STORE });
    return pageShell(bundleSource, scheme, `${setup}\n${HELPERS_SOURCE}\n${MIXED_PROBE_SOURCE}`);
  }
  if (scenario === "loading") {
    const setup = setupSource({ providers: MIXED_PROVIDERS, store: MIXED_STORE, delayMs: 400 });
    return pageShell(bundleSource, scheme, `${setup}\n${HELPERS_SOURCE}\n${LOADING_PROBE_SOURCE}`);
  }
  if (scenario === "batch65" || scenario === "batch128") {
    const providers = bulkProviders(scenario === "batch65" ? 65 : 128);
    const setup = setupSource({ providers, store: configuredStore(providers) });
    return pageShell(bundleSource, scheme, `${setup}\n${HELPERS_SOURCE}\n${BATCH_PROBE_SOURCE}`);
  }
  if (scenario === "partial") {
    const providers = bulkProviders(65);
    const setup = setupSource({ providers, store: configuredStore(providers), failSecondBatch: true });
    return pageShell(bundleSource, scheme, `${setup}\n${HELPERS_SOURCE}\n${PARTIAL_PROBE_SOURCE}`);
  }
  throw new TypeError(`未知场景：${scenario}`);
}

/**
 * 截图页面：真实打包产物 + 同一份 mixed 夹具，隐藏探针输出。
 * before 基线没有总览展开按钮，expanded 对它是 no-op。
 */
export function buildRouteOverviewScreenshotHtml(bundleSource, scheme, { expanded = false } = {}) {
  const setup = setupSource({ providers: MIXED_PROVIDERS, store: MIXED_STORE });
  const script = `${setup}\n${HELPERS_SOURCE}\n(async () => {
    await sleep(120);
    const expand = byAria("展开全部路由");
    if (${expanded ? "true" : "false"} && expand !== null) {
      expand.click();
      await sleep(350);
    }
    await sleep(150);
  })();`;
  return pageShell(bundleSource, scheme, script, { hideResult: true });
}
