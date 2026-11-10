// P1-07 bundle contract test (no browser): load lib/client.js exactly the way
// dsh-client-modules does — a global __ModuleLoader__.load({id, factory}) whose
// factory receives a `require` — then assert the registration actually happens:
// inject list, apply(ctx) → slots.inject("settings.section") → slots.register.
//
// React stays external, so `require("react")` is stubbed: the Workbench
// component is never rendered here (registration only), which is the point —
// this test proves the module graph and slot wiring, not the pixels.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext, Script } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const source = readFileSync(join(root, "lib", "client.js"), "utf8");

/** Minimal React stub: enough for module evaluation (no render). */
const reactStub = {
  createElement: () => null,
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
  Fragment: "Fragment",
};

/** Load the bundle through the host's ModuleLoader contract. */
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

test("bundle registers under the package id and exports the plugin contract", () => {
  const { id, exports } = loadBundle();
  assert.equal(id, "dsh-model-assistant");
  assert.equal(typeof exports.apply, "function");
  assert.equal(exports.inject.join(","), "slots,configForms"); // cross-realm safe
  assert.equal(exports.name, "model-assistant-client");
  assert.equal(exports.default.apply, exports.apply);
});

test("apply() wires settings.section through configForms.whileServed", () => {
  const { exports } = loadBundle();
  const calls = { effects: [], inject: [], register: [], whileServed: [] };

  const ctx = {
    effect: (fn, label) => {
      calls.effects.push(label);
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
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
  // inject() hands the component exactly the service it needs
  const injected = spec.inject();
  assert.ok(injected.configForms, "component receives configForms");
  assert.equal(typeof component, "function");
});

test("bundle inlines the projection engine (no logic drift from Host tests)", () => {
  // The R1–R7 refusal codes and the replacement gate must exist INSIDE the
  // bundle: the browser runs the same code the Host unit tests cover.
  for (const marker of ["catalog-replacement", "efforts-only-off", "duplicate-model-id", "max-tokens-dual-identity"]) {
    assert.ok(source.includes(marker), `bundle contains ${marker}`);
  }
  // ...and it must not re-bundle React (host provides it).
  assert.ok(/require\("react"\)/.test(source));
  assert.ok(!/react-dom\/client/.test(source.replace(/^\s*\/\/.*$/gm, "")), "react-dom not bundled");
});

test("no host-hostile globals: bundle never touches node builtins", () => {
  for (const banned of ["require(\"node:", "process.env", "import(\"node:"]) {
    assert.ok(!source.includes(banned), `bundle must not reference ${banned}`);
  }
});
