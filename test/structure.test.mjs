// P0-01 结构校验。
// 对照宿主实际的加载预期验证包形态：package.json 字段、cordis.patch.yml 的单条
// 插入形式、Config 的 volatile 标记，以及 docs/p0-evidence-notes.md N7 中
// 实测的 peer 范围矩阵。
// 工单 #36 起同时守护 src/core 的未接线白名单（见文件下方的
// 「零引用核心模块必须与未接线白名单一致」）。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, extname, join, resolve } from "node:path";
import { hostRequire } from "../scripts/host-anchor.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const importLocal = (p) => import(pathToFileURL(p).href);

// ── 未接线核心模块守护（工单 #36） ─────────────────────────────────────────
//
// src/core 下有些 P1 预置件已实现、有单测，但 src/ 内没有任何运行路径引用
// 它们。读代码的人只看文件名和 P1 编号，会以为它们在生产路径上；接线后若
// 忘记更新文档 / 白名单，也会让状态继续失真。本用例把「零引用」这件事变成
// 显式白名单：实际零引用集合必须与白名单完全相等。
//
// 未接线白名单：每条都写明等哪个工单接线。
const UNWIRED_CORE_MODULES = Object.freeze([
  // 等 P1-07（工作台屏 A 骨架 + 双入口）接线：身份解析器五级链（P1-01）。
  "identity.js",
  // 等 P1-07 接线：候选引擎八级字段合成（P1-02）。
  "candidates.js",
  // 等 P1-07 接线：应用服务 prepare/commit 与指纹撤销（P1-04/P1-05）。
  "apply-service.js",
  // 等 P1-07 接线：三态用户档案仓库（P1-06）。
  "profile-repository.js",
]);

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs"]);

/** 递归列出 src/ 下所有 JS 源码。 */
function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(full);
  }
  return files;
}

/** 去掉注释，避免把注释里的 import 当成真实引用。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/** 提取 import / export-from / 动态 import / require 的模块说明符。 */
function importSpecifiers(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g;
  return [...stripComments(source).matchAll(pattern)].map((match) => match[1]);
}

test("package.json 结构", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.exports["."], "./lib/index.js");
  assert.equal(pkg.exports["./client"], "./lib/client.js");
  assert.ok(pkg.exports["./package.json"]);
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  // `slots` 来自渲染器包，`configForms` 来自 ui-settings，
  // `remote` 来自 api-remotes。三者都是包名（宿主约定），不是服务名。
  assert.deepEqual(pkg.dsh.client.inject, [
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-api-remotes",
  ]);
  assert.equal(pkg.dsh.client.platform, "web");
  // 依赖：真正的 dependency 只有官方 schemastery 模式库；
  // 每个宿主包都是 peer，由安装锚点提供。
  assert.deepEqual(Object.keys(pkg.dependencies), ["@deepseek-ai/schemastery"]);
});

test("peerDependencies 范围满足宿主矩阵", async () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const range = pkg.peerDependencies["@deepseek-ai/dsh"];
  // 为 0.2.2（正在运行的宿主）放宽，而在其表面差异被核对前仍拒绝 0.2.3+：
  // 本插件触及的每个 DSH API 在 0.2.0 / 0.2.1 / 0.2.2 上逐字节一致
  // （docs/p0-evidence-notes.md N9）。
  assert.equal(range, ">=0.2.0-rc.2 <0.2.3-0");
  // Typert 协议与宿主发行版同步推进。
  assert.equal(pkg.peerDependencies["@deepseek-ai/dsh-typert-protocol"], ">=0.2.0-rc.2 <0.2.3-0");
  assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "~4.1.0");
  // schemastery 版本必须与宿主一致，否则 volatile 标记与设置表单投影
  // 会相互矛盾（0.2.2 附带 3.19.0）。
  assert.equal(pkg.dependencies["@deepseek-ai/schemastery"], "~3.19.0");

  const semver = hostRequire()("semver");
  const matrix = {
    "0.2.0-rc.2": true,
    "0.2.1-rc.2": true,
    "0.2.2-rc.2": true,   // 当前正在运行的宿主
    "0.2.2": true,
    "0.2.3-rc.1": false,  // 未核对的表面 —— 在核对前拒绝
  };
  for (const [version, expected] of Object.entries(matrix)) {
    assert.equal(
      semver.satisfies(version, range, { includePrerelease: true }),
      expected,
      `range vs ${version}`,
    );
  }
});

test("cordis.patch.yml 单条插入，id=modelpilot", () => {
  const yml = readFileSync(join(root, "cordis.patch.yml"), "utf8");
  const inserts = [...yml.matchAll(/- id: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ["modelpilot"], "exactly one insert, id=modelpilot");
  assert.match(yml, /name: dsh-model-assistant/);
});

test("宿主侧导出面向设置的契约", async () => {
  const mod = await importLocal(join(root, "lib", "index.js"));
  assert.equal(mod.SETTINGS_NS, "modelpilot");
  assert.equal(mod.name, "model-assistant");
  assert.deepEqual(mod.inject, []);
  assert.equal(typeof mod.apply, "function");
  assert.equal(typeof mod.Config, "function"); // schemastery 模式可调用
  // volatile：每条顶层数据线必须是 volatile，这样设置写入才能通过
  // isVolatilePath（audit 02-S1）。Schemastery 对象模式通过 .dict 暴露字段；
  // volatile 元数据挂在每个字段节点上。
  const shape = mod.Config;
  assert.ok(shape.dict, "Config is a schemastery object schema with .dict");
  for (const key of ["profiles", "rules", "locks", "ledger"]) {
    const field = shape.dict[key];
    assert.ok(field, `Config.${key} exists`);
    assert.equal(field.meta?.volatile === true || field.volatile === true, true, `Config.${key} is volatile`);
  }
});

test("客户端侧是打包后的 ModuleLoader 注册（不是裸 ESM）", () => {
  // lib/client.js 是构建产物：浏览器侧通过 window.__ModuleLoader__.load 注册，
  // 因此这里绝不能把它当作 ES 模块导入。它的契约由 test/client/bundle.test.mjs
  // 覆盖（通过真实的 ModuleLoader 垫片加载并断言 slot 接线）。
  const source = readFileSync(join(root, "lib", "client.js"), "utf8");
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(source, /id: "dsh-model-assistant"/);
  assert.match(source, /factory: \(require\) =>/);
  assert.ok(source.length > 5_000, "bundle carries the real client, not a stub");
  // 宿主侧保持纯 ESM 并在别处直接导入。
  assert.ok(!source.includes("export const name = \"model-assistant-client\""));
});

test("宿主侧在 apply 内不声明动态导入（生命周期安全）", () => {
  const source = readFileSync(join(root, "lib", "index.js"), "utf8");
  const applyStart = source.indexOf("function apply(ctx)");
  assert.ok(applyStart >= 0, "apply exists");
  const body = source.slice(applyStart);
  // apply() 内的动态导入会返回一个 promise，而加载器并非在每条入口路径上
  // 都等待它；服务模块是静态导入的。
  assert.ok(!/await import\(/.test(body), "no await import inside apply");
  assert.ok(/import \{ ModelAssistantService \}/.test(source), "service imported statically");
  // Config 必须满足 0.2.2 的 volatileForm()：至少 1 个 volatile 顶层字段。
  const volatileCount = (source.match(/\.volatile\(\)/g) || []).length;
  assert.ok(volatileCount >= 4, `expected >=4 volatile data lines, saw ${volatileCount}`);
});

test("零引用核心模块必须与未接线白名单一致", () => {
  const coreDir = join(root, "src", "core");
  const coreModules = readdirSync(coreDir).filter((name) => name.endsWith(".js")).sort();
  const referencedBy = new Map(coreModules.map((name) => [name, new Set()]));

  for (const file of listSourceFiles(join(root, "src"))) {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier);
      // 只统计 src/core/*.js 的直接引用；模块引用自身不算。
      if (dirname(target) !== coreDir || target === file) continue;
      referencedBy.get(basename(target))?.add(file);
    }
  }

  const zeroReference = coreModules.filter((name) => referencedBy.get(name).size === 0);
  const whitelist = [...UNWIRED_CORE_MODULES].sort();
  assert.deepEqual(
    zeroReference,
    whitelist,
    [
      "零引用核心模块必须与未接线白名单一致。",
      `实际零引用：${zeroReference.join(", ") || "（无）"}`,
      `白名单：${whitelist.join(", ") || "（空）"}`,
      "新增未接线模块请登记到 UNWIRED_CORE_MODULES 并注明等哪个工单；",
      "接线后请把模块从白名单删除。",
    ].join("\n"),
  );
});
