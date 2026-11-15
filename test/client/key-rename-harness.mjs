// 工单 #37 的浏览器夹具：改密钥引用名确认弹窗 + 先删旧密钥再写配置。
//
// 与既有 client 夹具一样：用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，再在 headless Chrome 里做真实点击，读回弹窗文案 / 按钮
// 文字，以及 credentials.describe / unset 与 mutate 的真实调用顺序。
// 这里只放夹具；断言在 key-rename.test.mjs 里。

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
      apiKeyEnv: "PRIMARY_RELAY_API_KEY",
      models: [{ id: "primary/a" }, { id: "primary/b" }],
    }),
    "failing-relay": provider("failing-relay", {
      apiKeyEnv: "FAILING_KEY",
      models: [{ id: "failing/a" }],
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
      models: [{ id: "env/a" }],
    }),
    "unknown-relay": provider("unknown-relay", {
      apiKeyEnv: "UNKNOWN_KEY",
      models: [{ id: "unknown/a" }],
    }),
    "absent-relay": provider("absent-relay", {
      apiKeyEnv: "ABSENT_KEY",
      models: [{ id: "absent/a" }],
    }),
    "empty-relay": provider("empty-relay", {
      apiKeyEnv: "",
      models: [{ id: "empty/a" }],
    }),
    "plain-relay": provider("plain-relay", {
      apiKeyEnv: "PLAIN_API_KEY",
      models: [{ id: "plain/a" }],
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
  // UNKNOWN_KEY 读取失败；FAILING_KEY 删除失败。unset 成功后从已配置表里移除，
  // 模拟宿主凭据库的真实变化（弹窗确认时会再 describe 一次复核）。
  const CONFIGURED = {
    "PRIMARY_RELAY_API_KEY": { configured: true, writable: true },
    "FAILING_KEY": { configured: true, writable: true },
    "SHARED_API_KEY": { configured: true, writable: true },
    "ENV_KEY": { configured: true, writable: false },
    "PLAIN_API_KEY": { configured: true, writable: true },
  };
  const DESCRIBE_FAILS = new Set(["UNKNOWN_KEY"]);
  const UNSET_FAILS = new Set(["FAILING_KEY"]);

  const events = [];
  const mutations = [];
  const credentialOps = {
    describe: async (refs) => {
      events.push({ kind: "describe", refs: [...refs] });
      if (refs.some((ref) => DESCRIBE_FAILS.has(ref))) {
        return { ok: false, error: { message: "凭据服务不可用" } };
      }
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
      delete CONFIGURED[ref];
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
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const setSelect = (select, value) => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const routeSummary = () => document.querySelector('[aria-label="展开路由设置"], [aria-label="收起路由设置"]');
  const routeSelect = () => document.querySelector("select");
  const renameDialog = () => byAria("修改密钥引用名确认");
  const renameConfirmButton = () => byAria("确认修改密钥引用名");
  const readRenameDialog = () => {
    const root = renameDialog();
    const button = renameConfirmButton();
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
        text.startsWith("已保存路由设置") ||
        text.startsWith("删除旧密钥失败") ||
        text.startsWith("无法确认旧密钥") ||
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
  const unsetRefs = () => events.filter((event) => event.kind === "unset").map((event) => event.ref);
  const openCard = async () => {
    if (routeSummary()?.getAttribute("aria-expanded") !== "true") {
      routeSummary().click();
      await sleep(20);
    }
  };
  const pickRoute = async (id) => {
    setSelect(routeSelect(), id);
    await sleep(20);
    await openCard();
  };
  const renameTo = async (nextRef) => {
    setValue(byAria("路由密钥引用"), nextRef);
    await sleep(30);
  };
  const save = async (waitMs = 60) => {
    byAria("保存路由设置").click();
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

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };

  // ── 1. 旧密钥已配置：保存先弹二次确认，此时一条配置都不写、不发 unset ──
  step = "configured-dialog";
  await openCard();
  await renameTo("PRIMARY_RELAY_KEY_V2");
  let stepMark = mark();
  await save();
  result.dialog = readRenameDialog();
  result.dialog.events = eventsSince(stepMark);
  result.dialog.mutations = mutations.length;
  result.dialog.unset = unsetRefs();

  // ── 2. 取消：弹窗关闭，配置未写，旧密钥未删（unset 调用数仍为 0） ──
  step = "cancel";
  byAria("取消修改密钥引用名").click();
  await sleep(20);
  result.cancelled = {
    open: renameDialog() !== null,
    mutations: mutations.length,
    unset: unsetRefs(),
    provider: JSON.parse(JSON.stringify(providers["primary-relay"])),
  };

  // ── 3. 确认：重新 describe → unset 旧密钥 → 一条 set 写新引用名 ──
  step = "confirm";
  stepMark = mark();
  await save();
  const dialogBeforeConfirm = readRenameDialog();
  byAria("确认修改密钥引用名").click();
  await sleep(60);
  result.confirmed = {
    dialogBeforeConfirm,
    open: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutations: mutations.length,
    lastOps: mutations[mutations.length - 1],
    toast: toastText(),
    provider: JSON.parse(JSON.stringify(providers["primary-relay"])),
  };

  // ── 4. 旧密钥被别的路由共用：不弹窗、不 unset，toast 说明保留原因 ──
  step = "shared";
  await pickRoute("shared-relay");
  await renameTo("SHARED_KEY_V2");
  stepMark = mark();
  const beforeSharedMutations = mutations.length;
  await save();
  result.shared = {
    dialogOpen: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutationsDelta: mutations.length - beforeSharedMutations,
    lastOps: mutations[mutations.length - 1],
    toast: toastText(),
    provider: JSON.parse(JSON.stringify(providers["shared-relay"])),
    otherProvider: JSON.parse(JSON.stringify(providers["shared-other"])),
  };

  // ── 5. 旧引用由环境变量提供（writable: false）：不弹窗、不 unset，toast 说明 ──
  step = "readonly";
  await pickRoute("env-relay");
  await renameTo("ENV_KEY_V2");
  stepMark = mark();
  const beforeReadonlyMutations = mutations.length;
  await save();
  result.readonly = {
    dialogOpen: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutationsDelta: mutations.length - beforeReadonlyMutations,
    toast: toastText(),
  };

  // ── 6. 旧引用读不到：不弹窗、不 unset，照常保存并提示可能残留 ──
  step = "unknown";
  await pickRoute("unknown-relay");
  await renameTo("UNKNOWN_KEY_V2");
  stepMark = mark();
  const beforeUnknownMutations = mutations.length;
  await save();
  result.unknown = {
    dialogOpen: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutationsDelta: mutations.length - beforeUnknownMutations,
    toast: toastText(),
  };

  // ── 7. 旧引用没有存储的密钥：不弹窗、不 unset，照常保存且不加提示 ──
  step = "absent";
  await pickRoute("absent-relay");
  await renameTo("ABSENT_KEY_V2");
  stepMark = mark();
  const beforeAbsentMutations = mutations.length;
  await save();
  result.absent = {
    dialogOpen: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutationsDelta: mutations.length - beforeAbsentMutations,
    toast: toastText(),
  };

  // ── 8. 旧引用为空（首次设置密钥）：不是改名，不弹窗、不 unset ──
  step = "first-setup";
  await pickRoute("empty-relay");
  result.firstSetupInitialRef = byAria("路由密钥引用").value;
  await renameTo("EMPTY_KEY_V2");
  stepMark = mark();
  const beforeFirstSetupMutations = mutations.length;
  await save();
  result.firstSetup = {
    dialogOpen: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutationsDelta: mutations.length - beforeFirstSetupMutations,
    toast: toastText(),
  };

  // ── 9. 引用名没变（只改别的字段）：不弹窗、不碰凭据 ──
  step = "unchanged";
  await pickRoute("plain-relay");
  setValue(byAria("路由显示名"), "Plain Relay");
  await sleep(20);
  stepMark = mark();
  const beforeUnchangedMutations = mutations.length;
  await save();
  result.unchanged = {
    dialogOpen: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutationsDelta: mutations.length - beforeUnchangedMutations,
    lastOps: mutations[mutations.length - 1],
    toast: toastText(),
  };

  // ── 10. unset 失败：中止保存，mutate 未被调用，toast 是错误 ──
  step = "unset-failed";
  await pickRoute("failing-relay");
  await renameTo("FAILING_KEY_V2");
  stepMark = mark();
  const beforeFailingMutations = mutations.length;
  await save();
  const failingDialog = readRenameDialog();
  byAria("确认修改密钥引用名").click();
  await sleep(60);
  result.failing = {
    dialogBeforeConfirm: failingDialog,
    open: renameDialog() !== null,
    events: eventsSince(stepMark),
    unset: unsetRefs(),
    mutationsDelta: mutations.length - beforeFailingMutations,
    toast: toastText(),
    provider: JSON.parse(JSON.stringify(providers["failing-relay"])),
  };

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

/** 以指定主题组装改密钥引用名页。 */
export function buildKeyRenameHtml(bundleSource, scheme) {
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
