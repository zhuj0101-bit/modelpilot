// 工单 #18：模型拉取改走宿主 remote.llm.discoverModels。
//
// 用 React 桩加载真实打包产物 lib/client.js，注入假的 remote，覆盖：
// 成功、namespace、被拒、空列表、去重、过滤空 id、无 baseURL、抛异常、
// 路由切换清空，以及加载中与显示名联动的界面行为。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const source = readFileSync(join(root, "lib", "client.js"), "utf8");
const LLM_NS = "llm-pi-ai";

/** 比较 effect 依赖：逐项 Object.is，而不是比较数组身份。 */
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

/** 把函数组件展开成宿主元素树；Fragment 直接展开 children。 */
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

function byId(tree, id) {
  return findAll(tree, (node) => node.type !== "function" && node.props?.id === id)[0];
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
function createHarness({ providers, remote }) {
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
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async () => true,
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

  function current() {
    return tree ?? render();
  }

  const harness = {
    render,
    text: () => textOf(current()),
    async flush() {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
    clickFetch() {
      const button = findAll(current(), (node) => node.type === "button" && ["拉取", "…"].includes(textOf(node.props?.children).trim()))[0];
      assert.ok(button, "fetch button exists");
      button.props.onClick();
      render();
      return button;
    },
    button() {
      return findAll(current(), (node) => node.type === "button" && ["拉取", "…"].includes(textOf(node.props?.children).trim()))[0];
    },
    datalistOptions() {
      const list = byId(current(), "modelpilot-remote-models");
      if (list === undefined) return [];
      return findAll(list, (node) => node.type === "option").map((node) => node.props.value);
    },
    modelInput() {
      return byId(current(), "modelpilot-model-id");
    },
    displayNameInput() {
      return findAll(current(), (node) => node.type === "input" && node.props?.placeholder === "留空则不写")[0];
    },
    setModelId(value) {
      const input = harness.modelInput();
      assert.ok(input, "model ID input exists");
      input.props.onChange({ target: { value } });
      render();
    },
    switchRoute(value) {
      const select = findAll(current(), (node) => node.type === "select")[0];
      assert.ok(select, "route select exists");
      select.props.onChange({ target: { value } });
      render();
    },
  };
  return harness;
}

test("成功：走 remote.llm.discoverModels，请求不含 apiKey", async () => {
  const remote = remoteStub(() => ({ ok: true, value: [{ id: "jxf/dsv4.1-flash" }, { id: "other" }] }));
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  assert.equal(remote.calls.length, 1);
  assert.equal(remote.calls[0].namespace, "llm-pi-ai");
  const request = remote.calls[0].request;
  assert.equal(request.provider, "newapi-chat");
  assert.equal(request.baseURL, "https://x/v1");
  assert.equal(request.api, "openai-completions");
  assert.equal("apiKey" in request, false);
  assert.deepEqual(harness.datalistOptions(), ["jxf/dsv4.1-flash", "other"]);
  assert.match(harness.text(), /已拉取 2 个模型：jxf\/dsv4\.1-flash、other/);
  assert.equal(harness.button().props.children, "拉取");
});

test("被拒：显示宿主返回的错误消息", async () => {
  const remote = remoteStub(() => ({ ok: false, error: { message: "Invalid token" } }));
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  assert.match(harness.text(), /拉取失败：Invalid token/);
  assert.deepEqual(harness.datalistOptions(), []);
});

test("空列表：显示端点返回了空的模型列表", async () => {
  const remote = remoteStub(() => ({ ok: true, value: [] }));
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  assert.match(harness.text(), /拉取失败：端点返回了空的模型列表/);
});

test("去重：重复 id 只保留一次", async () => {
  const remote = remoteStub(() => ({ ok: true, value: [{ id: "a" }, { id: "a" }, { id: "b" }] }));
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  assert.deepEqual(harness.datalistOptions(), ["a", "b"]);
});

test("过滤空 id：空字符串与 null 被跳过", async () => {
  const remote = remoteStub(() => ({ ok: true, value: [{ id: "" }, { id: "b" }, { id: null }] }));
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  assert.deepEqual(harness.datalistOptions(), ["b"]);
});

test("无 baseURL：不调用 discoverModels，显示当前路由未配置 baseURL", async () => {
  const remote = remoteStub(() => ({ ok: true, value: [{ id: "a" }] }));
  const harness = createHarness({ providers: { "no-base": route({ baseURL: undefined }) }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  assert.equal(remote.calls.length, 0);
  assert.match(harness.text(), /拉取失败：当前路由未配置 baseURL/);
});

test("抛异常：显示异常消息，页面不崩", async () => {
  const remote = remoteStub(() => {
    throw new Error("boom");
  });
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  assert.match(harness.text(), /拉取失败：boom/);
});

test("加载中：按钮变 … 且 disabled，完成后恢复", async () => {
  let resolve;
  const remote = remoteStub(() => new Promise((done) => {
    resolve = done;
  }));
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();

  assert.equal(harness.button().props.children, "…");
  assert.equal(harness.button().props.disabled, true);
  resolve({ ok: true, value: [{ id: "a" }] });
  await harness.flush();
  harness.render();

  assert.equal(harness.button().props.children, "拉取");
  assert.equal(harness.button().props.disabled, false);
  assert.match(harness.text(), /已拉取 1 个模型：a/);
});

test("路由切换：清空上一次的候选与提示", async () => {
  const remote = remoteStub(() => ({ ok: true, value: [{ id: "a" }] }));
  const harness = createHarness({
    providers: { first: route(), second: route({ baseURL: "https://y/v1" }) },
    remote,
  });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();
  assert.deepEqual(harness.datalistOptions(), ["a"]);
  assert.match(harness.text(), /已拉取 1 个模型：a/);

  harness.switchRoute("second");
  harness.render();
  assert.deepEqual(harness.datalistOptions(), []);
  assert.doesNotMatch(harness.text(), /已拉取/);
  assert.doesNotMatch(harness.text(), /拉取失败/);
});

test("成功后手动改模型 ID：显示名继续联动", async () => {
  const remote = remoteStub(() => ({ ok: true, value: [{ id: "jxf/dsv4.1-flash" }] }));
  const harness = createHarness({ providers: { "newapi-chat": route() }, remote });
  harness.render();
  harness.clickFetch();
  await harness.flush();
  harness.render();

  harness.setModelId("jxf/dsv4.1-flash");
  assert.equal(harness.modelInput().props.value, "jxf/dsv4.1-flash");
  assert.equal(harness.displayNameInput().props.value, "dsv4.1-flash");
});
