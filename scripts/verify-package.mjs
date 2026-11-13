// 校验打包后的产物（而不是仓库）：打包产物契约 + 宿主侧加载。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";

const dir = process.argv[2];
const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
const src = readFileSync(`${dir}/lib/client.js`, "utf8");

const checks = {
  "1 包名": pkg.name === "dsh-model-assistant",
  "2 exports . -> lib/index.js": pkg.exports["."] === "./lib/index.js",
  "3 exports ./client -> lib/client.js": pkg.exports["./client"] === "./lib/client.js",
  "4 已声明 bundle.patch": pkg.dsh.bundle.patch === "./cordis.patch.yml",
  "5 客户端平台 web": pkg.dsh.client.platform === "web",
  "6 ModuleLoader 外壳": /window\.__ModuleLoader__\.load\(\{/.test(src),
  "7 模块 id": /id: "dsh-model-assistant"/.test(src),
  "8 factory 签名": /factory: \(require\) =>/.test(src),
  "9 react 保持外部化": /require\("react"\)/.test(src),
  "10 引擎已内联（闸门+R1-R7）": src.includes("catalog-replacement") && src.includes("efforts-only-off"),
  "11 打包产物不是桩": src.length > 5000,
  "12 无 node 内置模块": !src.includes('require("node:'),
};
for (const [k, v] of Object.entries(checks)) console.log(v ? "PASS" : "FAIL", k);

// 按 ModuleLoader 契约加载打包后的产物。
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
console.log(registered?.id === "dsh-model-assistant" ? "PASS" : "FAIL", "13 ModuleLoader.load 已执行");
console.log(typeof registered?.exports?.apply === "function" ? "PASS" : "FAIL", "14 exports.apply 是函数");
console.log(registered?.exports?.inject?.join(",") === "slots,configForms" ? "PASS" : "FAIL", "15 inject 列表");

// 宿主侧以纯 ESM 加载。它的 `@deepseek-ai/*` 导入由 DSH 安装锚点在运行时提供
// （dsh-app-boot 的 collectInstallationScopePackages），因此在加载前先把这些包
// 链接进来 —— 正是档案解析器所做的事。
import { mkdirSync, symlinkSync, existsSync as exists } from "node:fs";
import { hostModulesRoot } from "./host-anchor.mjs";
const anchorModules = hostModulesRoot();
const needed = ["@deepseek-ai/schemastery", "@deepseek-ai/dsh-typert-protocol", "@deepseek-ai/cordis"];
const nm = `${dir}/node_modules`;
if (!exists(nm)) mkdirSync(nm, { recursive: true });
for (const spec of needed) {
  const target = `${nm}/${spec}`;
  if (exists(target)) continue;
  const parent = spec.slice(0, spec.lastIndexOf("/"));
  mkdirSync(`${nm}/${parent}`, { recursive: true });
  try { symlinkSync(`${anchorModules}/${spec}`, target, "junction"); } catch { /* 已链接或不受支持 */ }
}
const host = await import(pathToFileURL(`${dir}/lib/index.js`).href);
console.log(host.SETTINGS_NS === "modelpilot" ? "PASS" : "FAIL", "16 宿主 SETTINGS_NS");
console.log(typeof host.apply === "function" ? "PASS" : "FAIL", "17 宿主 apply");
console.log(typeof host.Config === "function" ? "PASS" : "FAIL", "18 宿主 Config 模式");
