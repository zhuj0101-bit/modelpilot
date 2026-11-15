// 工单 #26 的浏览器夹具：删除路由确认弹窗 + 先删密钥再删配置。
//
// 与既有 client 夹具一样：用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，再在 headless Chrome 里做真实点击，读回弹窗文案、按钮
// 文字 / 禁用状态，以及 credentials.describe / unset 与 mutate 的真实调用顺序。
// 这里只放夹具；断言在 route-delete.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

const FIXTURE_SOURCE = String.raw`
  const provider = (id, extra) => ({
    id,
    baseURL: "https://" + id + ".invalid/v1",
    api: "openai-completions",
    ...extra,
  });
  const providers = {
    "primary-relay": provider("primary-relay", {
      displayName: "Primary Relay",
      apiKeyEnv: "PRIMARY_RELAY_API_KEY",
      models: [{ id: "primary/a" }, { id: "primary/b" }, { id: "primary/c" }],
    }),
    "beta-relay": provider("beta-relay", {
      apiKeyEnv: "",
      models: [{ id: "beta/a" }, { id: "beta/b" }],
    }),
    "gamma-relay": provider("gamma-relay", {
      models: [{ id: "gamma/a" }],
    }),
    "shared-relay": provider("shared-relay", {
      apiKeyEnv: "SHARED_API_KEY",
      models: [{ id: "shared/a" }],
    }),
    "shared-other": provider("shared-other", {
      apiKeyEnv: "SHARED_API_KEY",
      models: [{ id: "shared/b" }],
    }),
    "env-relay": provider("env-relay", {
      apiKeyEnv: "ENV_KEY",
      models: [{ id: "env/a" }, { id: "env/b" }],
    }),
    "failing-relay": provider("failing-relay", {
      apiKeyEnv: "FAILING_KEY",
      models: [{ id: "failing/a" }, { id: "failing/b" }],
    }),
    "slow-relay": provider("slow-relay", {
      apiKeyEnv: "SLOW_RELAY_API_KEY",
      models: [{ id: "slow/a" }],
    }),
    "stale-relay": provider("stale-relay", {
      apiKeyEnv: "STALE_RELAY_API_KEY",
      models: [{ id: "stale/a" }],
    }),
    "spare-relay": provider("spare-relay", {
      apiKeyEnv: "SPARE_RELAY_API_KEY",
      models: [{ id: "spare/a" }],
    }),
  };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };

  // 凭据夹具：只有列出的引用名已配置；ENV_KEY 只读（环境变量提供）；
  // GAMMA_RELAY_API_KEY 读取失败；FAILING_KEY 删除失败；SLOW 延迟 150ms。
  const CONFIGURED = {
    "PRIMARY_RELAY_API_KEY": { configured: true, writable: true },
    "SHARED_API_KEY": { configured: true, writable: true },
    "ENV_KEY": { configured: true, writable: false },
    "FAILING_KEY": { configured: true, writable: true },
    "SLOW_RELAY_API_KEY": { configured: true, writable: true },
    "STALE_RELAY_API_KEY": { configured: true, writable: true },
    "SPARE_RELAY_API_KEY": { configured: true, writable: true },
  };
  const DESCRIBE_FAILS = new Set(["GAMMA_RELAY_API_KEY"]);
  const UNSET_FAILS = new Set(["FAILING_KEY"]);
  const DESCRIBE_DELAY_MS = { "SLOW_RELAY_API_KEY": 150 };

  const events = [];
  const mutations = [];
  const credentialOps = {
    describe: async (refs) => {
      events.push({ kind: "describe", refs: [...refs] });
      if (refs.some((ref) => DESCRIBE_FAILS.has(ref))) {
        return { ok: false, error: { message: "凭据服务不可用" } };
      }
      const delay = Math.max(0, ...refs.map((ref) => DESCRIBE_DELAY_MS[ref] ?? 0));
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return {
        ok: true,
        value: Object.fromEntries(
          refs.map((ref) => [ref, CONFIGURED[ref] ? { ...CONFIGURED[ref] } : { configured: false, writable: true }]),
        ),
      };
    },
    set: async () => ({ ok: true, value: undefined }),
    unset: async (ref) => {
      events.push({ kind: "unset", ref });
      if (UNSET_FAILS.has(ref)) return { ok: false, error: { message: "宿主拒绝删除（只读凭据）" } };
      return { ok: true, value: undefined };
    },
  };
`;

const PROBE_SOURCE = String.raw`
(async () => {
  let step = "init";
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
${FIXTURE_SOURCE}

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
  const routeSummary = () => document.querySelector('[aria-label="展开路由设置"], [aria-label="收起路由设置"]');
  const routeSelect = () => document.querySelector("select");
  const setSelect = (select, value) => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
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
  const dialog = () => byAria("删除路由确认");
  const dialogText = () => dialog()?.innerText ?? "";
  const confirmButton = () => byAria("确认删除路由");
  const readDialog = () => {
    const root = dialog();
    const button = confirmButton();
    return {
      open: root !== null,
      text: root?.innerText ?? "",
      confirmLabel: button?.innerText.trim() ?? "",
      confirmDisabled: button === null ? null : button.disabled,
    };
  };
  const toastText = () => {
    const match = [...document.querySelectorAll("div")]
      .filter((element) => element.children.length === 0)
      .map((element) => element.textContent.trim())
      .filter((text) =>
        text.startsWith("已删除路由") ||
        text.startsWith("删除密钥失败") ||
        text.startsWith("无法确认密钥") ||
        text.startsWith("stale-route"),
      );
    return match[match.length - 1] ?? "";
  };
  const mark = () => events.length;
  const eventsSince = (from) => events.slice(from).map((event) => {
    if (event.kind === "describe") return "describe:" + event.refs.join(",");
    if (event.kind === "unset") return "unset:" + event.ref;
    return "mutate";
  });
  const openCard = async () => {
    if (routeSummary()?.getAttribute("aria-expanded") !== "true") {
      routeSummary().click();
      await sleep(20);
    }
  };
  const pickRoute = async (id) => {
    setSelect(routeSelect(), id);
    await sleep(20);
  };
  const openDeleteDialog = async () => {
    await openCard();
    byAria("删除路由").click();
    await sleep(30);
  };
  const confirmDelete = async (waitMs = 120) => {
    confirmButton().click();
    await sleep(waitMs);
  };

  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => {
      const copy = JSON.parse(JSON.stringify(ops));
      events.push({ kind: "mutate" });
      mutations.push(copy);
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
      for (const op of copy) {
        if (op.op === "set") setPath(snapshot.value, op.path, op.value);
        else if (op.op === "unset") unsetPath(snapshot.value, op.path);
      }
      return true;
    },
  };
  const configForms = { get: () => scope, whileServed: (namespaces, register) => register(new Set(namespaces)) };
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
      llm: { discoverModels: async () => ({ ok: true, value: [] }) },
      credentials: credentialOps,
    },
  };
  client.apply(ctx);
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, spec.inject());

  const result = { scheme: styleOf(document.documentElement).colorScheme, initialRoute: routeSelect().value };

  // ── 1. 有密钥：弹窗写明一并删除 REF，按钮「删除路由和密钥」；取消不写 ──
  step = "configured";
  await openCard();
  const configuredMark = mark();
  byAria("删除路由").click();
  await sleep(40);
  result.configured = readDialog();
  result.configured.dialogBackground = styleOf(dialog()).backgroundColor;
  result.configured.dialogColor = styleOf(dialog()).color;
  result.configured.danger = (() => {
    const button = confirmButton();
    return {
      color: styleOf(button).color,
      background: styleOf(button).backgroundColor,
      ratio: contrast(parseColor(styleOf(button).color), effectiveBackground(button)),
    };
  })();
  byAria("取消删除路由").click();
  await sleep(20);
  result.cancelled = {
    open: dialog() !== null,
    unset: events.filter((event) => event.kind === "unset").map((event) => event.ref),
    mutations: mutations.length,
  };

  // ── 2. 确认：describe（确认仍然存在）→ unset 密钥 → 一条 unset 配置 ──
  step = "confirmed";
  byAria("删除路由").click();
  await sleep(40);
  await confirmDelete();
  result.confirmed = {
    events: eventsSince(configuredMark),
    toast: toastText(),
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    routes: Object.keys(providers),
    routeAfter: routeSelect().value,
  };

  // ── 3. 没有密钥：不做 unset，只删配置；按钮仍是「删除路由」 ──
  step = "absent";
  await pickRoute("beta-relay");
  await openCard();
  let stepMark = mark();
  byAria("删除路由").click();
  await sleep(40);
  result.absent = readDialog();
  await confirmDelete();
  result.absentAfter = {
    events: eventsSince(stepMark),
    toast: toastText(),
    mutations: mutations.length,
    routes: Object.keys(providers),
  };

  // ── 4. 读不到：正文说无法确认，只删配置并说明密钥可能残留 ──
  step = "unknown";
  await pickRoute("gamma-relay");
  await openCard();
  stepMark = mark();
  byAria("删除路由").click();
  await sleep(40);
  result.unknown = readDialog();
  await confirmDelete();
  result.unknownAfter = {
    events: eventsSince(stepMark),
    toast: toastText(),
    mutations: mutations.length,
  };

  // ── 5. 共用密钥：保留密钥，配置照删；正文点名共用者 ──
  step = "shared";
  await pickRoute("shared-relay");
  await openCard();
  stepMark = mark();
  byAria("删除路由").click();
  await sleep(40);
  result.shared = readDialog();
  await confirmDelete();
  result.sharedAfter = {
    events: eventsSince(stepMark),
    toast: toastText(),
    routes: Object.keys(providers),
  };

  // ── 6. 环境变量提供的密钥（writable: false）：不尝试 unset ──
  step = "readonly";
  await pickRoute("env-relay");
  await openCard();
  stepMark = mark();
  byAria("删除路由").click();
  await sleep(40);
  result.readonly = readDialog();
  await confirmDelete();
  result.readonlyAfter = {
    events: eventsSince(stepMark),
    routes: Object.keys(providers),
  };

  // ── 7. unset 失败：配置一条都不动，路由仍在，弹窗关闭并报错 ──
  step = "failing";
  await pickRoute("failing-relay");
  await openCard();
  stepMark = mark();
  byAria("删除路由").click();
  await sleep(40);
  result.failingPlan = readDialog();
  const mutationsBeforeFailure = mutations.length;
  await confirmDelete();
  result.failing = {
    events: eventsSince(stepMark),
    toast: toastText(),
    dialogClosed: dialog() === null,
    mutationsDelta: mutations.length - mutationsBeforeFailure,
    routes: Object.keys(providers),
    routeStillThere: providers["failing-relay"] !== undefined,
  };

  // ── 8. 正在读取：正文显示「正在检查…」，确认按钮禁用；读完后恢复 ──
  step = "checking";
  await pickRoute("slow-relay");
  await openCard();
  stepMark = mark();
  byAria("删除路由").click();
  result.checking = readDialog();
  await sleep(250);
  result.checked = readDialog();
  await confirmDelete(400);
  result.slowAfter = {
    events: eventsSince(stepMark),
    toast: toastText(),
    routes: Object.keys(providers),
  };

  // ── 9. stale-route 守卫不变：弹窗打开后路由被别处删掉，确认必须拒绝写入 ──
  step = "stale";
  await pickRoute("stale-relay");
  await openCard();
  byAria("删除路由").click();
  await sleep(40);
  const staleMark = mark();
  const mutationsBeforeStale = mutations.length;
  delete providers["stale-relay"];
  await confirmDelete();
  result.stale = {
    events: eventsSince(staleMark),
    toast: toastText(),
    mutationsDelta: mutations.length - mutationsBeforeStale,
    routes: Object.keys(providers),
  };

  result.finalRoutes = Object.keys(providers);
  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({
      __error: String(error),
      step,
      stack: error.stack,
    });
  }
})();
`;

/** 以指定主题组装删除路由页。 */
export function buildRouteDeleteHtml(bundleSource, scheme) {
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
    `<script>${PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
