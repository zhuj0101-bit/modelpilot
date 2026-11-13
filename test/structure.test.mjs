// P0-01 结构校验。
// 对照宿主实际的加载预期验证包形态：package.json 字段、cordis.patch.yml 的单条
// 插入形式、Config 的 volatile 标记，以及 docs/p0-evidence-notes.md N7 中
// 实测的 peer 范围矩阵。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { hostRequire } from "../scripts/host-anchor.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const importLocal = (p) => import(pathToFileURL(p).href);

test("package.json 结构", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.exports["."], "./lib/index.js");
  assert.equal(pkg.exports["./client"], "./lib/client.js");
  assert.ok(pkg.exports["./package.json"]);
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  // `slots` 来自渲染器包，`configForms` 来自 ui-settings。
  // 两者都是包名（宿主约定），不是服务名。
  assert.deepEqual(pkg.dsh.client.inject, [
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-settings",
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
