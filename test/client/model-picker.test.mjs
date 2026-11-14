// 工单 #22：拉取模型列表的可搜索、可勾选选择器。
//
// 一部分覆盖 src/core/model-selection.js 的纯逻辑（过滤、标注、批量投影），
// 另一部分用最小 React 桩加载真实打包产物 lib/client.js，覆盖弹窗的
// 搜索、全选、单条回填、批量写入、跳过统计、键盘与路由切换保护。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  classifyModels,
  filterModels,
  planBatchSelection,
} from "../../src/core/model-selection.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const source = readFileSync(join(root, "lib", "client.js"), "utf8");
const LLM_NS = "llm-pi-ai";

/** 跨 vm 边界的对象/数组先转回宿主 realm，assert.deepEqual 才比较值。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

const REMOTE = [
  "jxf/dsv4.1-flash",
  "jxf/dsv4.1-pro",
  "kimi-k3",
  "QoderCom/deepseek-flash",
  "tx/deepseek-v4.1-flash",
];

// ── 纯逻辑 ────────────────────────────────────────────────────────────────

test("filterModels：大小写不敏感的子串匹配，空查询恢复全部", () => {
  const ids = ["JXF/Dsv4.1-flash", "other", "kimi-k3"];
  assert.deepEqual(filterModels(ids, "dsv4"), ["JXF/Dsv4.1-flash"]);
  assert.deepEqual(filterModels(ids, "  KIMI "), ["kimi-k3"]);
  assert.deepEqual(filterModels(ids, ""), ids);
  assert.deepEqual(filterModels(ids, "   "), ids);
  assert.deepEqual(filterModels(ids, "nothing"), []);
});

test("classifyModels：new / exists / casefold 与冲突对象", () => {
  const result = classifyModels(
    ["jxf/a", "kimi-k3", "QoderCom/DeepSeek-Flash"],
    ["kimi-k3", "qodercom/deepseek-flash"],
  );
  assert.deepEqual(result, [
    { id: "jxf/a", status: "new" },
    { id: "kimi-k3", status: "exists" },
    { id: "QoderCom/DeepSeek-Flash", status: "casefold", conflictWith: "qodercom/deepseek-flash" },
  ]);
  // 完全相同的 id 优先算 exists，而不是 casefold。
  assert.deepEqual(classifyModels(["A"], ["A", "a"]), [{ id: "A", status: "exists" }]);
});

test("planBatchSelection：空 models 依次写到 models.0 / 1 / 2", () => {
  const host = { providers: { r: { models: [] } }, catalogModels: new Set() };
  const plan = planBatchSelection(["a", "b", "c"], host, { routeId: "r", template: null });
  assert.deepEqual(plan.written, ["a", "b", "c"]);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(plan.ops.map((op) => op.path), [
    ["providers", "r", "models", "0"],
    ["providers", "r", "models", "1"],
    ["providers", "r", "models", "2"],
  ]);
  assert.deepEqual(plan.ops.map((op) => op.value.id), ["a", "b", "c"]);
  // 内置默认值：只写 id / input / reasoningEfforts，不带空 token 字段。
  assert.deepEqual(plan.ops[0].value.input, ["text"]);
  assert.deepEqual(plan.ops[0].value.reasoningEfforts, {
    off: null,
    low: "low",
    medium: "medium",
    high: "high",
  });
  assert.equal("contextWindow" in plan.ops[0].value, false);
  assert.equal("maxTokens" in plan.ops[0].value, false);
});

test("planBatchSelection：已有 N 条时从 models.N 继续递增", () => {
  const host = { providers: { r: { models: [{ id: "m0" }, { id: "m1" }] } }, catalogModels: new Set() };
  const plan = planBatchSelection(["x", "y"], host, { routeId: "r", template: null });
  assert.deepEqual(plan.ops.map((op) => op.path), [
    ["providers", "r", "models", "2"],
    ["providers", "r", "models", "3"],
  ]);
});

test("planBatchSelection：跳过已存在与仅大小写不同的条目", () => {
  const host = {
    providers: { r: { models: [{ id: "exists-me" }, { id: "Case-Model" }] } },
    catalogModels: new Set(),
  };
  const plan = planBatchSelection(["exists-me", "case-model", "new-one"], host, {
    routeId: "r",
    template: null,
  });
  assert.deepEqual(plan.written, ["new-one"]);
  assert.deepEqual(plan.skipped, [
    { id: "exists-me", reason: "exists" },
    { id: "case-model", reason: "casefold", conflictWith: "Case-Model" },
  ]);
  assert.deepEqual(plan.ops.map((op) => op.path), [["providers", "r", "models", "2"]]);
});

test("planBatchSelection：按默认模板生成字段", () => {
  const host = { providers: { r: { models: [] } }, catalogModels: new Set() };
  const template = {
    contextWindow: "131072",
    maxTokens: "8192",
    inputText: true,
    inputImage: true,
    reasoningLevels: ["high", "off", "bogus"],
  };
  const plan = planBatchSelection(["a"], host, { routeId: "r", template });
  assert.deepEqual(plan.ops[0].value, {
    id: "a",
    name: "a",
    contextWindow: 131072,
    maxTokens: 8192,
    input: ["text", "image"],
    reasoningEfforts: { off: null, high: "high" },
  });
});

test("planBatchSelection：每行显式写 name = 模型 ID 原文（含 / 与大小写）", () => {
  const host = { providers: { r: { models: [] } }, catalogModels: new Set() };
  const ids = ["jxf/dsv4.1-flash", "QoderCom/DeepSeek-Flash"];
  const plan = planBatchSelection(ids, host, { routeId: "r", template: null });
  assert.deepEqual(plan.written, ids);
  assert.deepEqual(plan.ops.map((op) => op.value.name), ids);
  // 不依赖宿主回落链：即使目录基准自带别的 name，写入的别名也严格等于 ID。
  assert.deepEqual(plan.ops.map((op) => op.value.id), ids);
});

test("planBatchSelection：目录路由未确认时不下发 ops，确认后一次写完", () => {
  const host = { providers: { r: {} }, catalogModels: new Set(["cat-a", "cat-b"]) };
  const gated = planBatchSelection(["a", "b"], host, {
    routeId: "r",
    template: null,
    ackedReplacement: false,
  });
  assert.deepEqual(gated.ops, []);
  assert.deepEqual(gated.written, []);
  const warning = gated.warnings.find((entry) => entry.code === "catalog-replacement");
  assert.ok(warning, "catalog-replacement warning is present");
  assert.deepEqual(warning.removedCatalogIds, ["cat-a", "cat-b"]);
  assert.equal(warning.requiresAck, true);

  const acknowledged = planBatchSelection(["a", "b"], host, {
    routeId: "r",
    template: null,
    ackedReplacement: true,
  });
  assert.deepEqual(acknowledged.written, ["a", "b"]);
  assert.deepEqual(acknowledged.ops.map((op) => op.path), [
    ["providers", "r", "models", "0"],
    ["providers", "r", "models", "1"],
  ]);
  assert.ok(acknowledged.warnings.some((entry) => entry.code === "catalog-replacement"));
});

test("planBatchSelection：modelOverrides 路由被投影引擎拒绝", () => {
  const host = {
    providers: { r: { models: [], modelOverrides: { "m1": {} } } },
    catalogModels: new Set(),
  };
  const plan = planBatchSelection(["a"], host, { routeId: "r", template: null });
  assert.deepEqual(plan.ops, []);
  assert.deepEqual(plan.written, []);
  assert.deepEqual(plan.skipped, []);
  assert.ok(plan.warnings.some((entry) => entry.code === "models-overrides-exclusive"));
});

// ── 弹窗（真实打包产物 + React 桩） ──────────────────────────────────────

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

function makeElement(type, props, children) {
  const next = { ...(props ?? {}) };
  if (children.length === 1) next.children = children[0];
  else if (children.length > 1) next.children = children;
  return { type, props: next };
}

function expand(node) {
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (Array.isArray(node)) return node.map(expand).filter((child) => child !== null);
  if (typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props ?? {}));
  if (typeof node.type === "symbol") return expand(node.props?.children);
  return { ...node, props: { ...(node.props ?? {}), children: expand(node.props?.children) } };
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node !== "object") return "";
  return textOf(node.props?.children);
}

function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  findAll(node.props?.children, predicate, out);
  return out;
}

function route(overrides = {}) {
  return { api: "openai-completions", baseURL: "https://x/v1", models: [], ...overrides };
}

function remoteStub(handler) {
  const calls = [];
  return {
    calls,
    llm: {
      discoverModels: async (namespace, request) => {
        calls.push({ namespace, request });
        return handler(namespace, request);
      },
    },
  };
}

/** 单次测试的 React 桩 + 真实打包产物 + 假 configForms/remote。 */
function createHarness({ providers, remote, mutateImpl = async () => true, storage }) {
  let hooks = [];
  let hookIndex = 0;
  let pending = false;
  let effects = [];
  let tree;

  const react = {
    createElement: (type, props, ...children) => makeElement(type, props, children),
    useState(init) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { value: typeof init === "function" ? init() : init };
      const slot = hooks[index];
      return [slot.value, (next) => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          pending = true;
        }
      }];
    },
    useEffect(fn, deps) {
      const index = hookIndex++;
      const previous = hooks[index];
      const changed = !previous || !sameDeps(previous.deps, deps);
      hooks[index] = { deps };
      if (changed) effects.push(fn);
    },
    useMemo(fn) {
      hookIndex++;
      return fn();
    },
    useCallback(fn) {
      hookIndex++;
      return fn;
    },
    useRef(value) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: value };
      return hooks[index];
    },
    Fragment: Symbol.for("react.fragment"),
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const jsxRuntime = { jsx, jsxs: jsx, Fragment: react.Fragment };

  let bundle;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          const require = (spec) => {
            if (spec === "react") return react;
            if (spec === "react/jsx-runtime") return jsxRuntime;
            throw new Error(`unexpected host require: ${spec}`);
          };
          bundle = factory(require);
        },
      },
      setTimeout: () => 0,
      ...(storage === undefined ? {} : { localStorage: storage }),
    },
    console,
  };
  sandbox.window.window = sandbox.window;
  createContext(sandbox);
  new Script(source, { filename: "lib/client.js" }).runInContext(sandbox);

  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const mutations = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: (ops) => {
      mutations.push(ops);
      return mutateImpl(ops);
    },
  };
  const configForms = { get: () => scope };

  let component;
  let spec;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms: {
      get: () => scope,
      whileServed: (_namespaces, register) => register(new Set([LLM_NS])),
    },
    slots: {
      inject: (_name, register) => register(),
      register: (registeredSpec, registered) => {
        spec = registeredSpec;
        component = registered;
        return () => {};
      },
    },
    remote,
  };
  bundle.apply(ctx);
  assert.equal(typeof component, "function");
  const props = spec.inject();
  assert.equal(typeof props.discoverModels, "function");

  function render() {
    let iterations = 0;
    do {
      pending = false;
      hookIndex = 0;
      effects = [];
      tree = expand(component(props));
      for (const effect of effects) effect();
      iterations++;
    } while (pending && iterations < 50);
    return tree;
  }

  const current = () => tree ?? render();

  const harness = {
    render,
    text: () => textOf(current()),
    mutations,
    async flush() {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
    buttonByText(text) {
      return findAll(current(), (node) => node.type === "button" && textOf(node.props?.children).trim() === text)[0];
    },
    buttonStartsWith(prefix) {
      return findAll(current(), (node) => node.type === "button" && textOf(node.props?.children).trim().startsWith(prefix))[0];
    },
    click(node) {
      assert.ok(node, "target node exists");
      node.props.onClick();
      render();
    },
    clickFetch() {
      const button = findAll(current(), (node) => node.type === "button" && ["拉取", "…"].includes(textOf(node.props?.children).trim()))[0];
      harness.click(button);
    },
    openPicker() {
      const button = findAll(current(), (node) => node.type === "button" && textOf(node.props?.children).includes("· 选择"))[0];
      harness.click(button);
    },
    dialog() {
      return findAll(current(), (node) => node.props?.role === "dialog")[0];
    },
    overlay() {
      return findAll(current(), (node) => node.props?.style?.position === "fixed" && typeof node.props?.onClick === "function")[0];
    },
    dialogText() {
      const dialog = harness.dialog();
      return dialog === undefined ? "" : textOf(dialog);
    },
    queryInput() {
      const dialog = harness.dialog();
      if (dialog === undefined) return undefined;
      return findAll(dialog, (node) => node.type === "input" && node.props?.placeholder === "搜索模型 ID…")[0];
    },
    setQuery(value) {
      harness.queryInput().props.onChange({ target: { value } });
      render();
    },
    checkboxes() {
      const dialog = harness.dialog();
      if (dialog === undefined) return [];
      return findAll(dialog, (node) => node.type === "input" && node.props?.type === "checkbox");
    },
    rowCheckbox(id) {
      const dialog = harness.dialog();
      if (dialog === undefined) return undefined;
      return findAll(dialog, (node) => node.type === "input" && node.props?.["aria-label"] === id)[0];
    },
    toggleRow(id) {
      harness.rowCheckbox(id).props.onChange();
      render();
    },
    labelledCheckbox(label) {
      const dialog = harness.dialog();
      if (dialog === undefined) return undefined;
      return findAll(dialog, (node) => node.type === "input" && node.props?.["aria-label"] === label)[0];
    },
    selectAll() {
      harness.checkboxes()[0].props.onChange({ target: { checked: true } });
      render();
    },
    confirmButton() {
      return harness.buttonStartsWith("确定（");
    },
    pendingWriteButton() {
      return harness.buttonByText("写入");
    },
    pendingClearButton() {
      return harness.buttonByText("清空");
    },
    details() {
      return findAll(current(), (node) => node.type === "details");
    },
    summaryTexts() {
      return harness.details().map((node) => {
        const summary = findAll(node, (child) => child.type === "summary")[0];
        return textOf(summary?.props?.children).trim();
      });
    },
    cancelButton() {
      return harness.buttonByText("取消");
    },
    press(key, target = { tagName: "INPUT" }) {
      const dialog = harness.dialog();
      assert.ok(dialog, "dialog exists");
      let prevented = false;
      dialog.props.onKeyDown({ key, target, preventDefault: () => { prevented = true; } });
      render();
      return prevented;
    },
    clickOverlay() {
      const overlay = harness.overlay();
      assert.ok(overlay, "overlay exists");
      overlay.props.onClick({ target: overlay, currentTarget: overlay });
      render();
    },
    modelInput() {
      return findAll(current(), (node) => node.type === "input" && node.props?.id === "modelpilot-model-id")[0];
    },
    displayNameInput() {
      return findAll(current(), (node) => node.type === "input" && node.props?.placeholder === "留空则不写")[0];
    },
    datalistOptions() {
      const list = findAll(current(), (node) => node.props?.id === "modelpilot-remote-models")[0];
      if (list === undefined) return [];
      return findAll(list, (node) => node.type === "option").map((node) => node.props.value);
    },
    switchRoute(value) {
      const select = findAll(current(), (node) => node.type === "select")[0];
      select.props.onChange({ target: { value } });
      render();
    },
    projectionText() {
      const pres = findAll(current(), (node) => node.type === "pre");
      return pres.map((node) => textOf(node.props?.children)).join("\n");
    },
  };
  return harness;
}

async function fetchedHarness(options = {}) {
  const remote = options.remote ?? remoteStub(() => ({ ok: true, value: REMOTE.map((id) => ({ id })) }));
  const harness = createHarness({ ...options, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();
  return harness;
}

const ROUTE_WITH_EXISTING = route({
  models: [{ id: "kimi-k3" }, { id: "qodercom/deepseek-flash" }],
});

test("拉取成功自动打开弹窗，标题显示已拉取数量并标注冲突状态", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  assert.ok(harness.dialog(), "picker opened after successful fetch");
  assert.match(harness.dialogText(), /选择模型/);
  assert.match(harness.dialogText(), /已拉取 5 个/);
  assert.match(harness.dialogText(), /已存在/);
  assert.match(harness.dialogText(), /仅大小写不同/);
  assert.equal(harness.rowCheckbox("kimi-k3").props.disabled, true);
  assert.equal(harness.rowCheckbox("QoderCom/deepseek-flash").props.disabled, false);
  assert.equal(harness.rowCheckbox("QoderCom/deepseek-flash").props.checked, false);
  // <datalist> 与「已拉取」按钮都保留。
  assert.deepEqual(harness.datalistOptions(), REMOTE);
  assert.ok(harness.buttonByText("已拉取 5 个 · 选择"));
});

test("搜索即时过滤，清空恢复全部，无匹配显示提示", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.setQuery("dsv4");
  assert.match(harness.dialogText(), /jxf\/dsv4\.1-flash/);
  assert.match(harness.dialogText(), /jxf\/dsv4\.1-pro/);
  assert.doesNotMatch(harness.dialogText(), /tx\/deepseek-v4\.1-flash/);
  assert.doesNotMatch(harness.dialogText(), /kimi-k3/);

  harness.setQuery("");
  assert.match(harness.dialogText(), /kimi-k3/);
  assert.match(harness.dialogText(), /tx\/deepseek-v4\.1-flash/);

  harness.setQuery("no-such-model");
  assert.match(harness.dialogText(), /没有匹配的模型/);
});

test("空列表或拉取失败：不开弹窗，保持现有错误提示", async () => {
  const empty = await fetchedHarness({
    providers: { "newapi-chat": ROUTE_WITH_EXISTING },
    remote: remoteStub(() => ({ ok: true, value: [] })),
  });
  assert.equal(empty.dialog(), undefined);
  assert.match(empty.text(), /拉取失败：端点返回了空的模型列表/);

  const failed = await fetchedHarness({
    providers: { "newapi-chat": ROUTE_WITH_EXISTING },
    remote: remoteStub(() => ({ ok: false, error: { message: "Invalid token" } })),
  });
  assert.equal(failed.dialog(), undefined);
  assert.match(failed.text(), /拉取失败：Invalid token/);
});

test("全选只勾 status:new；已存在禁用、仅大小写不同保持默认不勾", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.selectAll();
  assert.match(harness.dialogText(), /确定（3）/);
  for (const id of ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash"]) {
    assert.equal(harness.rowCheckbox(id).props.checked, true, `${id} should be checked`);
  }
  assert.equal(harness.rowCheckbox("kimi-k3").props.checked, false);
  assert.equal(harness.rowCheckbox("QoderCom/deepseek-flash").props.checked, false);
});

test("勾选后改搜索词不丢勾选", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.setQuery("kimi");
  assert.match(harness.dialogText(), /确定（1）/);
  harness.setQuery("");
  assert.equal(harness.rowCheckbox("jxf/dsv4.1-flash").props.checked, true);
});

test("关窗再打开：搜索词与勾选状态重置", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.setQuery("dsv4");
  harness.click(harness.cancelButton());
  assert.equal(harness.dialog(), undefined);

  harness.openPicker();
  assert.equal(harness.queryInput().props.value, "");
  assert.match(harness.dialogText(), /确定（0）/);
  assert.equal(harness.rowCheckbox("jxf/dsv4.1-flash").props.checked, false);
});

test("勾 1 个：确认后关闭弹窗并把完整 id 填进模型输入框，显示名联动", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.click(harness.confirmButton());

  assert.equal(harness.dialog(), undefined);
  assert.equal(harness.modelInput().props.value, "jxf/dsv4.1-flash");
  assert.equal(harness.displayNameInput().props.value, "jxf/dsv4.1-flash");
  assert.equal(harness.mutations.length, 0, "single selection does not write");
  assert.doesNotMatch(harness.text(), /待写入/);
  assert.deepEqual(harness.summaryTexts(), ["settingsOps（1 条）· 点击展开"]);
  assert.equal(harness.details()[0].props.open, undefined, "single projection JSON default closed");
});

test("勾 3 个：确认只生成待写入区块，点「写入」才一次 mutate 3 条 op", async () => {
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const harness = await fetchedHarness({
    providers: { "newapi-chat": ROUTE_WITH_EXISTING },
    mutateImpl: () => deferred,
  });
  harness.selectAll();
  harness.click(harness.confirmButton());

  // ① 确认只关窗并展示计划：配置没有任何变化。
  assert.equal(harness.dialog(), undefined);
  assert.equal(harness.mutations.length, 0, "confirm must not write");
  assert.match(harness.text(), /待写入 3 条模型/);
  for (const id of ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro", "tx/deepseek-v4.1-flash"]) {
    assert.match(harness.text(), new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(harness.text(), /contextWindow 未设置/);
  assert.match(harness.text(), /maxTokens 未设置/);
  assert.match(harness.text(), /input text/);
  assert.match(harness.text(), /reasoningEfforts off \/ low \/ medium \/ high/);
  // ② 原始 JSON 在默认关闭的 details 中，摘要显示条数。
  assert.deepEqual(harness.summaryTexts(), ["settingsOps（3 条）· 点击展开"]);
  assert.equal(harness.details()[0].props.open, undefined, "details default closed");
  assert.match(harness.projectionText(), /"models"/);
  assert.equal((harness.projectionText().match(/"op": "set"/g) ?? []).length, 3);
  assert.match(harness.text(), /providers\.newapi-chat\.models\.2 ← jxf\/dsv4\.1-flash/);
  assert.match(harness.text(), /providers\.newapi-chat\.models\.4 ← tx\/deepseek-v4\.1-flash/);

  // ③ 点「写入」：一次 mutate 覆盖整批，写入期间按钮禁用并显示「写入中…」。
  harness.click(harness.pendingWriteButton());
  assert.equal(harness.mutations.length, 1, "one scope.mutate for the whole batch");
  assert.equal(harness.mutations[0].length, 3);
  assert.deepEqual(plain(harness.mutations[0].map((op) => op.path)), [
    ["providers", "newapi-chat", "models", "2"],
    ["providers", "newapi-chat", "models", "3"],
    ["providers", "newapi-chat", "models", "4"],
  ]);
  assert.equal(harness.buttonByText("写入中…").props.disabled, true, "write button disabled while writing");
  assert.match(harness.text(), /待写入 3 条模型/, "block stays until the write resolves");

  release(true);
  await harness.flush();
  harness.render();
  assert.match(harness.text(), /已写入 newapi-chat \/ 3 个模型/);
  assert.doesNotMatch(harness.text(), /待写入/);
  assert.deepEqual(harness.summaryTexts(), []);
});

test("待写入区块：「清空」丢弃计划且不写入", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.selectAll();
  harness.click(harness.confirmButton());
  assert.match(harness.text(), /待写入 3 条模型/);

  harness.click(harness.pendingClearButton());
  assert.equal(harness.mutations.length, 0);
  assert.doesNotMatch(harness.text(), /待写入/);
});

test("待写入区块：写入失败保留，可再次点「写入」重试", async () => {
  let attempt = 0;
  const harness = await fetchedHarness({
    providers: { "newapi-chat": ROUTE_WITH_EXISTING },
    mutateImpl: async () => {
      attempt += 1;
      return attempt > 1;
    },
  });
  harness.selectAll();
  harness.click(harness.confirmButton());

  harness.click(harness.pendingWriteButton());
  await harness.flush();
  harness.render();
  assert.equal(attempt, 1);
  assert.match(harness.text(), /写入被宿主拒绝/);
  assert.match(harness.text(), /待写入 3 条模型/, "failure keeps the plan for retry");

  harness.click(harness.pendingWriteButton());
  await harness.flush();
  harness.render();
  assert.equal(attempt, 2);
  assert.match(harness.text(), /已写入 newapi-chat \/ 3 个模型/);
  assert.doesNotMatch(harness.text(), /待写入/);
});

test("待写入区块存在时再选一批：替换而不是累加", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.selectAll();
  harness.click(harness.confirmButton());
  assert.match(harness.text(), /待写入 3 条模型/);

  harness.openPicker();
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.toggleRow("jxf/dsv4.1-pro");
  harness.click(harness.confirmButton());
  assert.match(harness.text(), /待写入 2 条模型/);
  assert.doesNotMatch(harness.text(), /待写入 3 条模型/);
  assert.equal(harness.mutations.length, 0);
});

test("待写入区块展示模板里的实际字段值", async () => {
  const storage = {
    getItem: (key) =>
      key === "modelpilot.default-template.v1"
        ? JSON.stringify({
            version: 1,
            contextWindow: "131072",
            maxTokens: "8192",
            inputText: true,
            inputImage: true,
            reasoningLevels: ["off", "high"],
          })
        : null,
    setItem: () => {},
    removeItem: () => {},
  };
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING }, storage });
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.toggleRow("jxf/dsv4.1-pro");
  harness.click(harness.confirmButton());

  assert.match(harness.text(), /contextWindow 131072/);
  assert.match(harness.text(), /maxTokens 8192/);
  assert.match(harness.text(), /input text \/ image/);
  assert.match(harness.text(), /reasoningEfforts off \/ high/);
});

test("仅大小写不同的条目默认不勾；勾上后批量写入跳过并计数", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.toggleRow("QoderCom/deepseek-flash");
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.toggleRow("jxf/dsv4.1-pro");
  assert.match(harness.dialogText(), /已跳过 1 条已存在、1 条仅大小写不同/);
  harness.click(harness.confirmButton());
  assert.match(harness.text(), /待写入 2 条模型/);
  assert.match(harness.text(), /已跳过 1 条已存在、1 条仅大小写不同/);

  harness.click(harness.pendingWriteButton());
  await harness.flush();
  harness.render();
  assert.equal(harness.mutations.length, 1);
  assert.equal(harness.mutations[0].length, 2);
  assert.deepEqual(plain(harness.mutations[0].map((op) => op.value.id)), ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro"]);
  assert.deepEqual(plain(harness.mutations[0].map((op) => op.value.name)), ["jxf/dsv4.1-flash", "jxf/dsv4.1-pro"]);
});

test("没有默认模板：提示使用内置默认值，勾 3 个仍能写入", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  assert.match(harness.dialogText(), /未设置默认模板，将使用内置默认值/);
  harness.selectAll();
  harness.click(harness.confirmButton());
  assert.match(harness.text(), /待写入 3 条模型/);
  harness.click(harness.pendingWriteButton());
  await harness.flush();
  harness.render();
  assert.equal(harness.mutations.length, 1);
  assert.equal(harness.mutations[0].length, 3);
  assert.deepEqual(plain(harness.mutations[0][0].value.input), ["text"]);
});

test("目录路由：批量写入先显示 catalog-replacement 告警，确认后才允许确定", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": route({ models: undefined }) } });
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.toggleRow("jxf/dsv4.1-pro");
  assert.match(harness.dialogText(), /catalog-replacement/);
  assert.match(harness.dialogText(), /目录路由/);
  assert.match(harness.dialogText(), /整体替换/);
  assert.equal(harness.confirmButton().props.disabled, true, "unacknowledged replacement blocks confirm");

  harness.labelledCheckbox("确认目录替换").props.onChange({ target: { checked: true } });
  harness.render();
  assert.equal(harness.confirmButton().props.disabled, false);
  harness.click(harness.confirmButton());
  assert.match(harness.text(), /待写入 2 条模型/);
  harness.click(harness.pendingWriteButton());
  await harness.flush();
  harness.render();
  assert.equal(harness.mutations.length, 1);
  assert.deepEqual(plain(harness.mutations[0].map((op) => op.path)), [
    ["providers", "newapi-chat", "models", "0"],
    ["providers", "newapi-chat", "models", "1"],
  ]);
});

test("modelOverrides 路由：确定按钮禁用并说明原因", async () => {
  const providers = {
    "newapi-chat": route({
      models: [{ id: "kimi-k3" }],
      modelOverrides: { "kimi-k3": { maxTokens: 4096 } },
    }),
  };
  const harness = await fetchedHarness({ providers });
  harness.toggleRow("jxf/dsv4.1-flash");
  assert.match(harness.dialogText(), /modelOverrides/);
  assert.equal(harness.confirmButton().props.disabled, true);
});

test("一个都没勾：确定按钮禁用", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  assert.equal(harness.confirmButton().props.disabled, true);
  assert.match(harness.dialogText(), /确定（0）/);
});

test("Esc 关闭、点遮罩关闭、Enter 确认", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  harness.press("Escape");
  assert.equal(harness.dialog(), undefined, "Esc closes");

  harness.openPicker();
  harness.clickOverlay();
  assert.equal(harness.dialog(), undefined, "overlay click closes");

  harness.openPicker();
  harness.toggleRow("jxf/dsv4.1-flash");
  harness.press("Enter");
  assert.equal(harness.dialog(), undefined, "Enter confirms");
  assert.equal(harness.modelInput().props.value, "jxf/dsv4.1-flash");
});

test("拉取期间切路由：旧请求作废，弹窗不能带着旧路由结果打开", async () => {
  let release;
  const remote = remoteStub(() => new Promise((resolve) => { release = resolve; }));
  const harness = createHarness({
    providers: {
      first: route(),
      second: route({ baseURL: "https://y/v1", models: [{ id: "second-model" }] }),
    },
    remote,
  });
  harness.render();
  harness.clickFetch();
  harness.switchRoute("second");
  release({ ok: true, value: [{ id: "stale-model" }] });
  await harness.flush();
  harness.render();

  assert.equal(harness.dialog(), undefined);
  assert.doesNotMatch(harness.text(), /已拉取/);
});

test("弹窗样式使用 --dsw-* token（带 fallback），overlay 用 fixed", async () => {
  const harness = await fetchedHarness({ providers: { "newapi-chat": ROUTE_WITH_EXISTING } });
  const overlay = harness.overlay();
  const dialog = harness.dialog();
  assert.equal(overlay.props.style.position, "fixed");
  assert.equal(dialog.props.style.background, "var(--dsw-alias-bg-layer-1, Canvas)");
  assert.match(dialog.props.style.border, /var\(--dsw-alias-border-l2,/);
  assert.match(dialog.props.style.color, /var\(--dsw-alias-label-primary,/);
  assert.equal(dialog.props.style.colorScheme, "inherit");
});
