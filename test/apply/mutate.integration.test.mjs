// P0-03: settings mutate integration tests.
//
// Runs the walker matrix + three op templates + conflict semantics against
// the VERBATIM write-path code of every supported host, extracted at test
// time (never re-implemented):
//   0.2.0-rc.2 / 0.2.1-rc.2 -> npm supplement trees
//   0.2.2-rc.2             -> the RUNNING installation (F:\AiTools\DSH)
//
// The 0.2.2 column is what keeps a future host upgrade honest: if the write
// path changes shape, this test fails instead of shipping a silent mismatch.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const supplement = join(root, "..", "modelpilot-tmp-npm", "extracted", "dsh-settings");
const HOST = "F:/AiTools/DSH/resources/app/dsh/node_modules/@deepseek-ai";

/** Locate one host version's dsh-settings bundle. */
function settingsPath(version) {
  if (version === "live") return `${HOST}/dsh-settings/lib/index.js`;
  return join(supplement, version, "package", "lib", "index.js");
}

const VERSIONS = ["0.2.0-rc.2", "0.2.1-rc.2", "live"];

/** Extract the three pure functions + SettingsConflictError by slicing the
 * bundle between stable anchors, then evaluate it as a data-URL module. */
function loadWalker(version) {
  const src = readFileSync(settingsPath(version), "utf8");
  const start = src.indexOf("function isVolatilePath(");
  const end = src.indexOf("/** Human label for a value that lossless JSON cannot represent");
  const conflictStart = src.indexOf("var SettingsConflictError = class");
  const conflictEnd = src.indexOf("/** Whether a value is a plain data object");
  if (start < 0 || end < 0 || conflictStart < 0 || conflictEnd < 0) {
    throw new Error(`anchors not found in ${version} (${settingsPath(version)})`);
  }
  const code = `
${src.slice(conflictStart, conflictEnd)}
${src.slice(start, end)}
export { isVolatilePath, applyPathOp, SettingsConflictError };
`;
  return import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
}

/** Equivalent schema shape: pi-ai-like providers node marked volatile. */
const schemaVolatileRoot = {
  meta: { volatile: false },
  dict: {
    providers: { meta: { volatile: true }, inner: { meta: { volatile: true }, dict: {} } },
    plain: { meta: { volatile: false }, inner: { meta: { volatile: false }, dict: {} } },
  },
};

function makeSection() {
  return {
    providers: {
      "gw.example": {
        models: [
          { id: "m1", contextWindow: 131072, maxTokens: 8192 },
          { id: "m2", contextWindow: 262144, maxTokens: 16384 },
        ],
      },
    },
    plain: { a: 1 },
  };
}

for (const version of VERSIONS) {
  const skip = !existsSync(settingsPath(version));

  test(`[${version}] walker case matrix (verbatim host code)`, { skip }, async () => {
    const { applyPathOp, isVolatilePath } = await loadWalker(version);
    const section = makeSection();

    // 1. set deep field with String(i)
    const afterSet = applyPathOp(
      section,
      { op: "set", path: ["providers", "gw.example", "models", "0", "maxTokens"], value: 4096 },
      schemaVolatileRoot,
    );
    assert.equal(afterSet.providers["gw.example"].models[0].maxTokens, 4096);

    // 2. unset deep field → key removed (schema default applies on merge)
    const afterUnset = applyPathOp(
      afterSet,
      { op: "unset", path: ["providers", "gw.example", "models", "0", "maxTokens"] },
      schemaVolatileRoot,
    );
    assert.deepEqual(afterUnset.providers["gw.example"].models[0], { id: "m1", contextWindow: 131072 });

    // 3. append whole row: index == length
    const afterAppend = applyPathOp(
      afterUnset,
      { op: "set", path: ["providers", "gw.example", "models", "2"], value: { id: "m3", contextWindow: 8192, maxTokens: 2048 } },
      schemaVolatileRoot,
    );
    assert.equal(afterAppend.providers["gw.example"].models.length, 3);

    // 4. unset whole row: splice
    const afterSplice = applyPathOp(
      afterAppend,
      { op: "unset", path: ["providers", "gw.example", "models", "1"] },
      schemaVolatileRoot,
    );
    assert.deepEqual(afterSplice.providers["gw.example"].models.map((m) => m.id), ["m1", "m3"]);

    // 5. out-of-range rejections (three shapes)
    assert.throws(
      () => applyPathOp(section, { op: "set", path: ["providers", "gw.example", "models", "5"], value: {} }, schemaVolatileRoot),
      /out of range/,
    );
    assert.throws(
      () => applyPathOp(section, { op: "unset", path: ["providers", "gw.example", "models", "2"] }, schemaVolatileRoot),
      /out of range/,
    );
    assert.throws(
      () => applyPathOp(section, { op: "set", path: ["providers", "gw.example", "models", "2", "id"], value: "x" }, schemaVolatileRoot),
      /out of range/,
    );

    // 6. volatility cascade
    assert.equal(isVolatilePath(schemaVolatileRoot, ["providers", "x", "models", "0", "maxTokens"]), true);
    assert.equal(isVolatilePath(schemaVolatileRoot, ["plain", "a"]), false);
  });

  test(`[${version}] op templates produce host-consumable paths`, { skip }, async () => {
    const { applyPathOp } = await loadWalker(version);
    const section = makeSection();
    const models = section.providers["gw.example"].models;

    // Template: appendModelRow → set at String(currentLength)
    const row = { id: "m9", contextWindow: 4096, maxTokens: 1024 };
    const after = applyPathOp(section, { op: "set", path: ["providers", "gw.example", "models", String(models.length)], value: row }, schemaVolatileRoot);
    assert.equal(after.providers["gw.example"].models.length, 3);
    assert.deepEqual(after.providers["gw.example"].models[2], row);

    // Template: setModelField → locate by model id (never cache the index)
    const locate = (sec, routeId, modelId) => {
      const list = sec.providers[routeId].models;
      const index = list.findIndex((m) => m.id === modelId);
      if (index < 0) throw new Error(`model "${modelId}" not found`);
      return index;
    };
    const i = locate(after, "gw.example", "m9");
    const after2 = applyPathOp(after, { op: "set", path: ["providers", "gw.example", "models", String(i), "maxTokens"], value: 512 }, schemaVolatileRoot);
    assert.equal(after2.providers["gw.example"].models[i].maxTokens, 512);
    assert.equal(after2.providers["gw.example"].models[i].id, "m9");

    // Template: unsetModelRow → splice by located index
    const after3 = applyPathOp(after2, { op: "unset", path: ["providers", "gw.example", "models", String(i)] }, schemaVolatileRoot);
    assert.equal(after3.providers["gw.example"].models.length, 2);
  });

  test(`[${version}] SettingsConflictError shape + retry relocation`, { skip }, async () => {
    const { SettingsConflictError, applyPathOp } = await loadWalker(version);
    const error = new SettingsConflictError("llm-pi-ai", 7, 9);
    assert.equal(error.code, "SETTINGS_CONFLICT");
    assert.equal(error.expected, 7);
    assert.equal(error.actual, 9);
    assert.match(error.message, /llm-pi-ai/);

    // Retry semantics (B1 §3.3 / A2): after a conflict the caller re-reads,
    // re-locates by model id, rebuilds the ops — never replays stale indices.
    const section = makeSection();
    const moved = applyPathOp(section, { op: "unset", path: ["providers", "gw.example", "models", "0"] }, schemaVolatileRoot);
    const newIndex = moved.providers["gw.example"].models.findIndex((m) => m.id === "m2");
    assert.equal(newIndex, 0, "relocated by modelId, not by stale index");
    const rebuilt = { op: "set", path: ["providers", "gw.example", "models", String(newIndex), "maxTokens"], value: 999 };
    const applied = applyPathOp(moved, rebuilt, schemaVolatileRoot);
    assert.equal(applied.providers["gw.example"].models[0].maxTokens, 999);
  });
}
