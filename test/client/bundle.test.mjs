// P1-07 打包产物契约测试（不使用浏览器）：完全按 dsh-client-modules 的方式加载
// lib/client.js —— 一个全局的 __ModuleLoader__.load({id, factory})，其 factory
// 收到 `require` —— 然后断言注册确实发生：inject 列表、
// apply(ctx) → slots.inject("settings.section") → slots.register。
//
// React 保持外部化，因此 `require("react")` 被打桩：工作台组件在这里从不
// 渲染（只验证注册），这正是重点 —— 本测试证明模块图与 slot 接线，而不是像素。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext, Script } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const source = readFileSync(join(root, "lib", "client.js"), "utf8");

/** 最小 React 打桩：足够完成模块求值（不渲染）。 */
const reactStub = {
  createElement: () => null,
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
  Fragment: "Fragment",
};

/** 按宿主的 ModuleLoader 契约加载打包产物。 */
function loadBundle() {
  const registered = [];
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => {
          const require = (spec) => {
            if (spec === "react") return reactStub;
            if (spec === "react/jsx-runtime") {
              return { jsx: () => null, jsxs: () => null, Fragment: "Fragment" };
            }
            throw new Error(`unexpected host require: ${spec}`);
          };
          registered.push({ id, exports: factory(require) });
        },
      },
      setTimeout: () => 0,
    },
    console,
  };
  sandbox.window.window = sandbox.window;
  createContext(sandbox);
  new Script(source, { filename: "lib/client.js" }).runInContext(sandbox);
  assert.equal(registered.length, 1, "exactly one ModuleLoader.load call");
  return registered[0];
}

test("打包产物以包 id 注册并导出插件契约", () => {
  const { id, exports } = loadBundle();
  assert.equal(id, "dsh-model-assistant");
  assert.equal(typeof exports.apply, "function");
  assert.equal(exports.inject.join(","), "slots,configForms,remote,remote.llm"); // 跨模块域安全
  assert.equal(exports.name, "model-assistant-client");
  assert.equal(exports.default.apply, exports.apply);
});

test("apply() 通过 configForms.whileServed 接线 settings.section", () => {
  const { exports } = loadBundle();
  const calls = { effects: [], inject: [], register: [], whileServed: [] };

  const ctx = {
    effect: (fn, label) => {
      calls.effects.push(label);
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    remote: { llm: { discoverModels: async () => ({ ok: true, value: [] }) } },
    configForms: {
      get: () => ({ getSnapshot: () => ({ value: {}, writable: true }), subscribe: () => () => {} }),
      whileServed: (namespaces, register) => {
        calls.whileServed.push(namespaces);
        return register(new Set(namespaces));
      },
    },
    slots: {
      inject: (name, register) => {
        calls.inject.push(name);
        return register();
      },
      register: (spec, component) => {
        calls.register.push({ spec, component });
        return () => {};
      },
    },
  };

  exports.apply(ctx);

  assert.equal(calls.effects.join("|"), "model-assistant: workbench settings page");
  assert.equal(calls.whileServed.length, 1);
  assert.equal(calls.whileServed[0].join(","), "llm-pi-ai");
  assert.equal(calls.inject.join(","), "settings.section");
  assert.equal(calls.register.length, 1);

  const { spec, component } = calls.register[0];
  assert.equal(spec.name, "settings.section");
  assert.equal(spec.id, "modelpilot.workbench");
  assert.equal(typeof spec.label, "function");
  assert.equal(spec.label(), "ModelPilot");
  assert.equal(typeof spec.order, "number");
  // inject() 把组件恰好需要的服务交给它
  const injected = spec.inject();
  assert.ok(injected.configForms, "component receives configForms");
  assert.equal(typeof injected.discoverModels, "function", "component receives a bound discoverModels callback");
  assert.equal(typeof component, "function");
});

test("打包产物内联投影引擎（与宿主测试无逻辑漂移）", () => {
  // R1–R7 拒绝码与替换闸门必须存在于打包产物内部：
  // 浏览器运行的就是宿主单元测试覆盖的同一份代码。
  for (const marker of ["catalog-replacement", "efforts-only-off", "duplicate-model-id", "max-tokens-dual-identity"]) {
    assert.ok(source.includes(marker), `bundle contains ${marker}`);
  }
  // ……并且绝不能把 React 重新打包进去（宿主负责提供）。
  assert.ok(/require\("react"\)/.test(source));
  assert.ok(!/react-dom\/client/.test(source.replace(/^\s*\/\/.*$/gm, "")), "react-dom not bundled");
});

test("打包产物包含自定义候选下拉与 K/M 提示逻辑", () => {
  for (const marker of ["TokenCountField", "comboPanel", "hintLine"]) {
    assert.ok(source.includes(marker), `bundle contains ${marker}`);
  }
  // 工单 #12 的 token 字段不再使用 datalist；工单 #18 只给模型 ID 保留
  // 候选下拉，所以这里检查旧 id 消失、新 id 存在，而不是禁止所有 datalist。
  assert.ok(!source.includes("modelpilot-context-window-candidates"), "old token list id removed");
  assert.ok(!source.includes("modelpilot-max-tokens-candidates"), "old max-tokens list id removed");
  assert.ok(source.includes("modelpilot-remote-models"), "model ID datalist present");
  // esbuild 会把 1_000_000 规范化为 1e6；两者都证明 M 分支进入了产物。
  assert.ok(source.includes("1e6") || source.includes("1_000_000"), "bundle contains the million threshold");
});

test("无双宿主敌意的全局量：打包产物从不触碰 node 内置模块", () => {
  for (const banned of ["require(\"node:", "process.env", "import(\"node:"]) {
    assert.ok(!source.includes(banned), `bundle must not reference ${banned}`);
  }
});
