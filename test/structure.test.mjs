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
  assert.deepEqual(pkg.dsh.client.inject, [
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-client-locale",
  ]);
  assert.equal(pkg.dsh.client.platform, "web");
  // deps: only official schemastery-style packages allowed
  assert.deepEqual(Object.keys(pkg.dependencies), ["@deepseek-ai/schemastery"]);
});

test("peerDependencies range satisfies the N7 matrix", async () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const range = pkg.peerDependencies["@deepseek-ai/dsh"];
  assert.equal(range, ">=0.2.0-rc.2 <0.2.2-0");
  // Use the host's own semver copy to mirror evaluatePluginCompatibility
  // (dsh-app-boot: semver.satisfies(runtimeVersion, range, {includePrerelease:true})).
  const semver = (await import("node:module")).createRequire(
    "F:/AiTools/DSH/resources/app/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
  )("semver");
  const matrix = {
    "0.2.0-rc.2": true,
    "0.2.1-rc.2": true,
    "0.2.1-rc.5": true,
    "0.2.2-rc.1": false,
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

test("Client half is a valid placeholder export", async () => {
  const mod = await importLocal(join(root, "lib", "client.js"));
  assert.equal(typeof mod.apply, "function");
  assert.equal(mod.name, "model-assistant-client");
});
