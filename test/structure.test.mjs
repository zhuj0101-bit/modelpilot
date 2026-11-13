// P0-01 structure validation.
// Verifies the package shape against the host's actual loading expectations:
// package.json fields, cordis.patch.yml single-insert form, Config volatility,
// and the peer range matrix measured in docs/p0-evidence-notes.md N7.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const importLocal = (p) => import(pathToFileURL(p).href);

test("package.json shape", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.exports["."], "./lib/index.js");
  assert.equal(pkg.exports["./client"], "./lib/client.js");
  assert.ok(pkg.exports["./package.json"]);
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  // `slots` comes from the renderer package, `configForms` from ui-settings.
  // Both are package names (host convention), not service names.
  assert.deepEqual(pkg.dsh.client.inject, [
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-settings",
  ]);
  assert.equal(pkg.dsh.client.platform, "web");
  // deps: only the official schemastery schema library is a real dependency;
  // every host package is a peer supplied by the installation anchor.
  assert.deepEqual(Object.keys(pkg.dependencies), ["@deepseek-ai/schemastery"]);
});

test("peerDependencies range satisfies the host matrix", async () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const range = pkg.peerDependencies["@deepseek-ai/dsh"];
  // Widened for 0.2.2 (running host) while still refusing 0.2.3+ until its
  // surface diff is checked: every DSH API this plugin touches is byte-identical
  // across 0.2.0 / 0.2.1 / 0.2.2 (docs/p0-evidence-notes.md N9).
  assert.equal(range, ">=0.2.0-rc.2 <0.2.3-0");
  // Typert protocol moves in lockstep with the host release.
  assert.equal(pkg.peerDependencies["@deepseek-ai/dsh-typert-protocol"], ">=0.2.0-rc.2 <0.2.3-0");
  assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "~4.1.0");
  // schemastery version must match the host's, or volatile markers and the
  // settings form projection disagree (0.2.2 ships 3.19.0).
  assert.equal(pkg.dependencies["@deepseek-ai/schemastery"], "~3.19.0");

  const semver = (await import("node:module")).createRequire(
    "F:/AiTools/DSH/resources/app/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
  )("semver");
  const matrix = {
    "0.2.0-rc.2": true,
    "0.2.1-rc.2": true,
    "0.2.2-rc.2": true,   // the currently running host
    "0.2.2": true,
    "0.2.3-rc.1": false,  // unverified surface — refuse until checked
  };
  for (const [version, expected] of Object.entries(matrix)) {
    assert.equal(
      semver.satisfies(version, range, { includePrerelease: true }),
      expected,
      `range vs ${version}`,
    );
  }
});

test("cordis.patch.yml single insert with id=modelpilot", () => {
  const yml = readFileSync(join(root, "cordis.patch.yml"), "utf8");
  const inserts = [...yml.matchAll(/- id: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ["modelpilot"], "exactly one insert, id=modelpilot");
  assert.match(yml, /name: dsh-model-assistant/);
});

test("Host half exports the settings-facing contract", async () => {
  const mod = await importLocal(join(root, "lib", "index.js"));
  assert.equal(mod.SETTINGS_NS, "modelpilot");
  assert.equal(mod.name, "model-assistant");
  assert.deepEqual(mod.inject, []);
  assert.equal(typeof mod.apply, "function");
  assert.equal(typeof mod.Config, "function"); // schemastery schema is callable
  // volatility: every top-level data line must be volatile so settings writes
  // pass isVolatilePath (audit 02-S1). Schemastery object schema exposes
  // fields via .dict; volatile meta lives on each field node.
  const shape = mod.Config;
  assert.ok(shape.dict, "Config is a schemastery object schema with .dict");
  for (const key of ["profiles", "rules", "locks", "ledger"]) {
    const field = shape.dict[key];
    assert.ok(field, `Config.${key} exists`);
    assert.equal(field.meta?.volatile === true || field.volatile === true, true, `Config.${key} is volatile`);
  }
});

test("Client half is the bundled ModuleLoader registration (not raw ESM)", () => {
  // lib/client.js is a build artifact: the browser half is registered through
  // window.__ModuleLoader__.load, so it must NOT be imported as an ES module
  // here. Its contract is covered by test/client/bundle.test.mjs (loads it
  // through a real ModuleLoader shim and asserts the slot wiring).
  const source = readFileSync(join(root, "lib", "client.js"), "utf8");
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(source, /id: "dsh-model-assistant"/);
  assert.match(source, /factory: \(require\) =>/);
  assert.ok(source.length > 5_000, "bundle carries the real client, not a stub");
  // The Host half stays plain ESM and is imported directly.
  assert.ok(!source.includes("export const name = \"model-assistant-client\""));
});

test("Host half declares no dynamic import inside apply (lifecycle-safe)", () => {
  const source = readFileSync(join(root, "lib", "index.js"), "utf8");
  const applyStart = source.indexOf("function apply(ctx)");
  assert.ok(applyStart >= 0, "apply exists");
  const body = source.slice(applyStart);
  // A dynamic import inside apply() returns a promise the loader does not
  // await on every entry path; the service module is imported statically.
  assert.ok(!/await import\(/.test(body), "no await import inside apply");
  assert.ok(/import \{ ModelAssistantService \}/.test(source), "service imported statically");
  // Config must satisfy 0.2.2 volatileForm(): >=1 volatile top-level field.
  const volatileCount = (source.match(/\.volatile\(\)/g) || []).length;
  assert.ok(volatileCount >= 4, `expected >=4 volatile data lines, saw ${volatileCount}`);
});
