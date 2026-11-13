// Verify the PACKED artifact (not the repo): bundle contract + host half load.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";

const dir = process.argv[2];
const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
const src = readFileSync(`${dir}/lib/client.js`, "utf8");

const checks = {
  "1 package name": pkg.name === "dsh-model-assistant",
  "2 exports . -> lib/index.js": pkg.exports["."] === "./lib/index.js",
  "3 exports ./client -> lib/client.js": pkg.exports["./client"] === "./lib/client.js",
  "4 bundle.patch declared": pkg.dsh.bundle.patch === "./cordis.patch.yml",
  "5 client platform web": pkg.dsh.client.platform === "web",
  "6 ModuleLoader wrapper": /window\.__ModuleLoader__\.load\(\{/.test(src),
  "7 module id": /id: "dsh-model-assistant"/.test(src),
  "8 factory signature": /factory: \(require\) =>/.test(src),
  "9 react stays external": /require\("react"\)/.test(src),
  "10 engine inlined (gate+R1-R7)": src.includes("catalog-replacement") && src.includes("efforts-only-off"),
  "11 bundle not a stub": src.length > 5000,
  "12 no node builtins": !src.includes('require("node:'),
};
for (const [k, v] of Object.entries(checks)) console.log(v ? "PASS" : "FAIL", k);

// Load the packed bundle through the ModuleLoader contract.
let registered;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        const require = (spec) => {
          if (spec === "react") return { createElement: () => null, useState: (i) => [typeof i === "function" ? i() : i, () => {}], useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }), Fragment: "Fragment" };
          if (spec === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: "Fragment" };
          throw new Error(`unexpected require: ${spec}`);
        };
        registered = { id, exports: factory(require) };
      },
    },
    setTimeout: () => 0,
  },
  console,
};
sandbox.window.window = sandbox.window;
createContext(sandbox);
new Script(src, { filename: "client.js" }).runInContext(sandbox);
console.log(registered?.id === "dsh-model-assistant" ? "PASS" : "FAIL", "13 ModuleLoader.load executed");
console.log(typeof registered?.exports?.apply === "function" ? "PASS" : "FAIL", "14 exports.apply is a function");
console.log(registered?.exports?.inject?.join(",") === "slots,configForms" ? "PASS" : "FAIL", "15 inject list");

// Host half loads as plain ESM. Its `@deepseek-ai/*` imports are supplied by
// the DSH installation anchor at runtime (dsh-app-boot's
// collectInstallationScopePackages), so link those packages in before loading —
// exactly what the profile resolver does.
import { mkdirSync, symlinkSync, existsSync as exists } from "node:fs";
const anchorModules = "F:/AiTools/DSH/resources/app/dsh/node_modules";
const needed = ["@deepseek-ai/schemastery", "@deepseek-ai/dsh-typert-protocol", "@deepseek-ai/cordis"];
const nm = `${dir}/node_modules`;
if (!exists(nm)) mkdirSync(nm, { recursive: true });
for (const spec of needed) {
  const target = `${nm}/${spec}`;
  if (exists(target)) continue;
  const parent = spec.slice(0, spec.lastIndexOf("/"));
  mkdirSync(`${nm}/${parent}`, { recursive: true });
  try { symlinkSync(`${anchorModules}/${spec}`, target, "junction"); } catch { /* already linked or unsupported */ }
}
const host = await import(pathToFileURL(`${dir}/lib/index.js`).href);
console.log(host.SETTINGS_NS === "modelpilot" ? "PASS" : "FAIL", "16 host SETTINGS_NS");
console.log(typeof host.apply === "function" ? "PASS" : "FAIL", "17 host apply");
console.log(typeof host.Config === "function" ? "PASS" : "FAIL", "18 host Config schema");
