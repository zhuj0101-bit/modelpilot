// 工单 #18 的浏览器夹具：路由设置卡片里的「密钥」区块。
//
// 和 route-edit-harness 一样，用最小的 React 兼容渲染器把打包后的 Workbench
// 渲染成真实 DOM，在 headless Chrome 里做真实点击、读回 describe / set / unset
// 的调用参数、状态行文案与计算样式。断言在 test/client/api-key.test.mjs 里。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

const ROUTES_SOURCE = String.raw`
  const routeOf = (id, apiKeyEnv) => ({
    id,
    baseURL: "https://" + id + ".invalid/v1",
    api: "openai-completions",
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    models: [],
  });
  const providers = {
    "preview-chat": routeOf("preview-chat"),
    "configured-route": routeOf("configured-route", "CONFIGURED_API_KEY"),
    "missing-route": routeOf("missing-route", "MISSING_API_KEY"),
    "readonly-route": routeOf("readonly-route", "ENV_ONLY_API_KEY"),
    "readonly-missing-route": routeOf("readonly-missing-route", "ENV_ONLY_MISSING_API_KEY"),
    "failing-route": routeOf("failing-route", "FAILING_API_KEY"),
    "echoing-route": routeOf("echoing-route", "ECHOING_API_KEY"),
    "error-route": routeOf("error-route", "READ_FAIL_API_KEY"),
  };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
`;

const PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");
${ROUTES_SOURCE}

  const credentialStore = {
    "PREVIEW_CHAT_API_KEY": { configured: true, writable: true },
    "CONFIGURED_API_KEY": { configured: true, writable: true },
    "MISSING_API_KEY": { configured: false, writable: true },
    "ENV_ONLY_API_KEY": { configured: true, writable: false, source: "env" },
    "ENV_ONLY_MISSING_API_KEY": { configured: false, writable: false, source: "env" },
    "FAILING_API_KEY": { configured: false, writable: true },
    "ECHOING_API_KEY": { configured: false, writable: true },
  };
  const calls = { describe: [], set: [], unset: [] };

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
      llm: { discoverModels: async () => ({ ok: true, value: [] }) },
      credentials: {
        describe: async (refs) => {
          calls.describe.push([...refs]);
          if (refs.length === 1 && refs[0] === "READ_FAIL_API_KEY") {
            return { ok: false, error: { code: "gateway/internal", message: "凭据服务不可用" } };
          }
          return {
            ok: true,
            value: Object.fromEntries(refs.map((ref) => [
              ref,
              credentialStore[ref] === undefined ? { configured: false, writable: true } : { ...credentialStore[ref] },
            ])),
          };
        },
        set: async (ref, value) => {
          calls.set.push([ref, value]);
          if (ref === "FAILING_API_KEY") {
            return { ok: false, error: { code: "credential/rejected", message: "凭据存储拒绝写入" } };
          }
          if (ref === "ECHOING_API_KEY") {
            // 模拟一个会把参数回显进消息的宿主；客户端必须抹掉明文。
            return { ok: false, error: { code: "credential/rejected", message: "rejected value=" + value } };
          }
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
  const routeSummary = () => byAria("展开路由设置") ?? byAria("收起路由设置");
  const routeSelect = () => document.querySelector("select");
  const statusText = () => (byAria("密钥状态")?.innerText ?? "").replace(/\s+/g, " ").trim();
  const dotInfo = () => {
    const row = byAria("密钥状态");
    if (row === null) return null;
    const element = [...row.querySelectorAll("span")]
      .find((candidate) => candidate.textContent === "●" || candidate.textContent === "○");
    if (element === undefined) return null;
    const style = getComputedStyle(element);
    return {
      glyph: element.textContent,
      color: style.color,
      background: style.backgroundColor,
      borderColor: style.borderTopColor,
    };
  };
  const secretInput = () => byAria("密钥值");
  const openCard = async () => {
    const summary = routeSummary();
    if (summary !== null && summary.getAttribute("aria-expanded") === "false") summary.click();
    await sleep(80);
  };
  const switchRoute = async (id) => {
    setSelect(routeSelect(), id);
    await sleep(40);
    await openCard();
  };
  const serializedStorage = () => {
    try {
      return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } });
    } catch {
      return "";
    }
  };

  await sleep(40);
  const result = {};
  await openCard();

  // ── 1. apiKeyEnv 为空：状态行说明「无法管理密钥」，只有建议、没有按钮 ──
  result.empty = {
    status: statusText(),
    inputValue: byAria("路由密钥引用").value,
    placeholder: byAria("路由密钥引用").placeholder,
    suggestion: byAria("密钥引用建议")?.innerText ?? "",
    hasSet: buttonByAria("设置密钥") !== undefined,
    hasReplace: buttonByAria("更换密钥") !== undefined,
    hasClear: buttonByAria("清除密钥") !== undefined,
    hasPassword: secretInput() !== null,
    describes: calls.describe.length,
  };

  // ── 2. 点「采用」才填入派生建议；随后按新引用重新 describe ──
  buttonByAria("采用引用名建议").click();
  await sleep(80);
  result.adopted = {
    value: byAria("路由密钥引用").value,
    status: statusText(),
    dot: dotInfo(),
    hasReplace: buttonByAria("更换密钥") !== undefined,
    hasClear: buttonByAria("清除密钥") !== undefined,
    hasSet: buttonByAria("设置密钥") !== undefined,
    lastDescribe: calls.describe[calls.describe.length - 1],
  };

  // ── 3. 「更换」展开 password 输入；空值不能保存 ──
  buttonByAria("更换密钥").click();
  await sleep(20);
  result.editor = {
    type: secretInput()?.type,
    ariaLabel: secretInput()?.getAttribute("aria-label"),
    saveDisabledWhenEmpty: buttonByAria("保存密钥")?.disabled,
    hint: byAria("密钥")?.innerText.includes("密钥只写入宿主的凭据存储，不会出现在配置文件中。") ?? false,
  };

  // ── 4. 保存：set 收到逐字节一致的输入（含首尾空格），保存后立即变「已配置」 ──
  const FIRST_SECRET = "  sk-live-Exact  ";
  setValue(secretInput(), FIRST_SECRET);
  buttonByAria("保存密钥").click();
  await sleep(120);
  result.saved = {
    setCalls: calls.set.map(([ref, value]) => ({ ref, value })),
    valueExact: calls.set[calls.set.length - 1]?.[1] === FIRST_SECRET,
    status: statusText(),
    dot: dotInfo(),
    hasReplace: buttonByAria("更换密钥") !== undefined,
    hasClear: buttonByAria("清除密钥") !== undefined,
    editorClosed: secretInput() === null,
    secretInBodyText: document.body.innerText.includes(FIRST_SECRET.trim()),
    secretInStorage: serializedStorage().includes(FIRST_SECRET.trim()),
    lastDescribe: calls.describe[calls.describe.length - 1],
  };

  // ── 5. 密钥不进入 settingsOps：改一个路由字段并保存，检查所有 mutate 参数 ──
  setValue(byAria("路由接口地址"), "https://preview.invalid/v2");
  await sleep(20);
  const opsPreview = (() => {
    const label = [...document.querySelectorAll("summary")]
      .find((element) => element.textContent.includes("保存将写入的 settingsOps"));
    return label?.parentElement.querySelector("pre")?.textContent ?? "";
  })();
  buttonByAria("保存路由设置").click();
  await sleep(80);
  result.ops = {
    mutations: JSON.stringify(mutations),
    containsSecret: JSON.stringify(mutations).includes(FIRST_SECRET.trim()),
    previewContainsSecret: opsPreview.includes(FIRST_SECRET.trim()),
    lastOps: mutations[mutations.length - 1],
  };

  // ── 6. 改 apiKeyEnv → 状态行跟着换成新引用的状态 ──
  setValue(byAria("路由密钥引用"), "MISSING_API_KEY");
  await sleep(100);
  result.changedRef = {
    status: statusText(),
    dot: dotInfo(),
    lastDescribe: calls.describe[calls.describe.length - 1],
    hasSet: buttonByAria("设置密钥") !== undefined,
    hasReplace: buttonByAria("更换密钥") !== undefined,
    hasClear: buttonByAria("清除密钥") !== undefined,
  };

  // ── 7. 设置 → 取消：不调用 set，输入被丢弃 ──
  buttonByAria("设置密钥").click();
  await sleep(20);
  setValue(secretInput(), "  should-be-discarded  ");
  buttonByAria("取消密钥编辑").click();
  await sleep(20);
  result.cancelled = {
    setCalls: calls.set.length,
    editorClosed: secretInput() === null,
  };

  // ── 8. 再设置并保存：未配置 → 已配置 ──
  const SECOND_SECRET = "  key-two  ";
  buttonByAria("设置密钥").click();
  await sleep(20);
  setValue(secretInput(), SECOND_SECRET);
  buttonByAria("保存密钥").click();
  await sleep(120);
  result.secondSave = {
    lastSet: calls.set[calls.set.length - 1],
    valueExact: calls.set[calls.set.length - 1]?.[1] === SECOND_SECRET,
    status: statusText(),
    hasClear: buttonByAria("清除密钥") !== undefined,
  };

  // ── 9. 清除：自绘确认弹窗；取消不调用 unset，确认后才调用 ──
  buttonByAria("清除密钥").click();
  await sleep(20);
  result.clearDialog = {
    open: byAria("清除密钥确认") !== null,
    text: byAria("清除密钥确认")?.innerText ?? "",
    confirmLabel: buttonByAria("确认清除密钥")?.textContent.trim(),
    cancelLabel: buttonByAria("取消清除密钥")?.textContent.trim(),
  };
  buttonByAria("取消清除密钥").click();
  await sleep(20);
  result.clearDialog.cancelled = byAria("清除密钥确认") === null;
  result.clearDialog.unsetAfterCancel = calls.unset.length;
  buttonByAria("清除密钥").click();
  await sleep(20);
  buttonByAria("确认清除密钥").click();
  await sleep(120);
  result.cleared = {
    unsetCalls: [...calls.unset],
    status: statusText(),
    hasSet: buttonByAria("设置密钥") !== undefined,
    hasClear: buttonByAria("清除密钥") !== undefined,
    dialogClosed: byAria("清除密钥确认") === null,
  };

  // ── 10. 只读部署：按钮全部禁用，文案写明由环境变量提供 ──
  await switchRoute("readonly-route");
  result.readOnly = {
    status: statusText(),
    hasReplace: buttonByAria("更换密钥") !== undefined,
    replaceDisabled: buttonByAria("更换密钥")?.disabled,
    hasClear: buttonByAria("清除密钥") !== undefined,
    clearDisabled: buttonByAria("清除密钥")?.disabled,
    hasSet: buttonByAria("设置密钥") !== undefined,
    hasPassword: secretInput() !== null,
  };

  // ── 10b. 只读且未配置：设置按钮同样禁用，文案同样说明来源 ──
  await switchRoute("readonly-missing-route");
  result.readOnlyMissing = {
    status: statusText(),
    hasSet: buttonByAria("设置密钥") !== undefined,
    setDisabled: buttonByAria("设置密钥")?.disabled,
    hasReplace: buttonByAria("更换密钥") !== undefined,
    hasClear: buttonByAria("清除密钥") !== undefined,
  };

  // ── 11. 写入失败：错误可见、状态不变、输入保留 ──
  await switchRoute("failing-route");
  buttonByAria("设置密钥").click();
  await sleep(20);
  setValue(secretInput(), "sk-fail-value");
  buttonByAria("保存密钥").click();
  await sleep(120);
  result.failed = {
    status: statusText(),
    error: byAria("密钥错误")?.innerText ?? "",
    inputValue: secretInput()?.value,
    editorStillOpen: secretInput() !== null,
    hasReplace: buttonByAria("更换密钥") !== undefined,
    setCalls: calls.set.map(([ref]) => ref),
  };

  // ── 11b. 宿主错误消息回显输入 → 客户端也必须抹掉明文 ──
  await switchRoute("echoing-route");
  buttonByAria("设置密钥").click();
  await sleep(20);
  setValue(secretInput(), "sk-echo-secret");
  buttonByAria("保存密钥").click();
  await sleep(120);
  result.echoedError = {
    status: statusText(),
    error: byAria("密钥错误")?.innerText ?? "",
    inputValue: secretInput()?.value,
    bodyHasSecret: document.body.innerText.includes("sk-echo-secret"),
  };

  // ── 12. describe 失败：显示错误且不暴露写按钮 ──
  await switchRoute("error-route");
  result.describeError = {
    status: statusText(),
    error: byAria("密钥错误")?.innerText ?? "",
    hasSet: buttonByAria("设置密钥") !== undefined,
    hasReplace: buttonByAria("更换密钥") !== undefined,
    hasClear: buttonByAria("清除密钥") !== undefined,
  };

  result.calls = { describe: calls.describe, set: calls.set, unset: calls.unset };
  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定主题组装密钥管理页。 */
export function buildApiKeyHtml(bundleSource, scheme) {
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
