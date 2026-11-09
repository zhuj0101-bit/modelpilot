// P0-03: settings mutate integration tests.
//
// Strategy (PLAN P0-03): extract applyPathOp / isVolatilePath / isPlainObject
// verbatim from BOTH host versions' dsh-settings/lib/index.js at test time
// (the npm-supplement trees under ../../modelpilot-tmp-npm/extracted), then
// run the walker case matrix + the three op templates + revision-conflict and
// retry semantics against each version's extracted code. This proves the op
// templates work byte-identically on 0.2.0 and 0.2.1 write semantics.
//
// The full SettingsService.write() pipeline (configEditor.edit, describe
// bookkeeping) is host-owned; what a plugin must match is the op vocabulary
// and the conflict error, so the fixture drives applyPathOp the way mutate()
// does and asserts SettingsConflictError semantics via the extracted class.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const supplement = join(root, "..", "modelpilot-tmp-npm", "extracted", "dsh-settings");

const VERSIONS = ["0.2.0-rc.2", "0.2.1-rc.2"];

/** Extract the three pure functions + SettingsConflictError from one version's
 * bundle by slicing the source between stable anchors, then evaluate it as a
 * module. Extraction (not re-implementation) is the point: byte-identical
 * semantics with the running host. */
function loadWalker(version) {
  const src = readFileSync(join(supplement, version, "package", "lib", "index.js"), "utf8");
  const start = src.indexOf("function isVolatilePath(");
  const end = src.indexOf("/** Human label for a value that lossless JSON cannot represent");
  if (start < 0 || end < 0 || end <= start) throw new Error(`anchors not found in ${version}`);
  const conflictStart = src.indexOf("var SettingsConflictError = class");
  const conflictEnd = src.indexOf("/** Whether a value is a plain data object");
  const code = `
${src.slice(conflictStart, conflictEnd)}
${src.slice(start, end)}
export { isVolatilePath, applyPathOp, SettingsConflictError };
`;
  const url = pathToFileURL(join(root, "test", "apply", `.walker-${version}.mjs`)).href;
  // data: URL avoids writing temp files: base64 the code.
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
  // eslint-disable-next-line no-new-func
  return import(dataUrl);
}

/** Equivalent schema shape: llm-pi-ai-like providers node marked volatile
 * (audit 02-S1: providers volatile → every deeper path is legal). */
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
  test(`[${version}] walker case matrix (verbatim host code)`, async () => {
    const { applyPathOp, isVolatilePath } = await loadWalker(version);
    const section = makeSection();

    // 1. set deep field with String(i)
    const afterSet = applyPathOp(
      section,
      { op: "set", path: ["providers", "gw.example", "models", "0", "maxTokens"], value: 4096 },
      schemaVolatileRoot,
    );
    assert.equal(afterSet.providers["gw.example"].models[0].maxTokens, 4096);

    // 2. unset deep field → key removed (falls back to schema default on merge)
    const afterUnset = applyPathOp(
      afterSet,
      { op: "unset", path: ["providers", "gw.example", "models", "0", "maxTokens"] },
      schemaVolatileRoot,
    );
    assert.deepEqual(afterUnset.providers["gw.example"].models[0], { id: "m1", contextWindow: 131072 });

    // 3. append whole row: index == length, rest empty, set
    const afterAppend = applyPathOp(
      afterUnset,
      {
        op: "set",
        path: ["providers", "gw.example", "models", "2"],
        value: { id: "m3", contextWindow: 8192, maxTokens: 2048 },
      },
      schemaVolatileRoot,
    );
    assert.equal(afterAppend.providers["gw.example"].models.length, 3);

    // 4. unset whole row: splice
    const afterSplice = applyPathOp(
      afterAppend,
      { op: "unset", path: ["providers", "gw.example", "models", "1"] },
      schemaVolatileRoot,
    );
    assert.deepEqual(
      afterSplice.providers["gw.example"].models.map((m) => m.id),
      ["m1", "m3"],
    );

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

  test(`[${version}] op templates produce host-consumable paths`, async () => {
    await loadWalker(version); // ensure module loads
    const { applyPathOp } = await loadWalker(version);

    // Template: appendModelRow(ns, routeId, row) →
    //   ops = [{op:"set", path:["providers", routeId, "models", String(len)], value: row}]
    const section = makeSection();
    const models = section.providers["gw.example"].models;
    const row = { id: "m9", contextWindow: 4096, maxTokens: 1024 };
    const appendOps = [{ op: "set", path: ["providers", "gw.example", "models", String(models.length)], value: row }];
    const after = applyPathOp(section, appendOps[0], schemaVolatileRoot);
    assert.equal(after.providers["gw.example"].models.length, 3);
    assert.deepEqual(after.providers["gw.example"].models[2], row);

    // Template: setModelField → locate row by model id (never cache index),
    // then set <field> at String(i).
    const locate = (section, routeId, modelId) => {
      const list = section.providers[routeId].models;
      const index = list.findIndex((m) => m.id === modelId);
      if (index < 0) throw new Error(`model "${modelId}" not found`);
      return index;
    };
    const i = locate(after, "gw.example", "m9");
    const setOps = [{ op: "set", path: ["providers", "gw.example", "models", String(i), "maxTokens"], value: 512 }];
    const after2 = applyPathOp(after, setOps[0], schemaVolatileRoot);
    assert.equal(after2.providers["gw.example"].models[i].maxTokens, 512);
    assert.equal(after2.providers["gw.example"].models[i].id, "m9");

    // Template: unsetModelRow → splice by located index.
    const after3 = applyPathOp(after2, { op: "unset", path: ["providers", "gw.example", "models", String(i)] }, schemaVolatileRoot);
    assert.equal(after3.providers["gw.example"].models.length, 2);
  });

  test(`[${version}] SettingsConflictError shape (code/expected/actual)`, async () => {
    const { SettingsConflictError } = await loadWalker(version);
    const error = new SettingsConflictError("llm-pi-ai", 7, 9);
    assert.equal(error.code, "SETTINGS_CONFLICT");
    assert.equal(error.expected, 7);
    assert.equal(error.actual, 9);
    assert.equal(error.name, "SettingsConflictError");
    assert.match(error.message, /llm-pi-ai/);
    // Retry semantics (B1 §3.3 / A2): after conflict, a retry re-reads
    // describe() → new expected → the SAME ops re-applied against the fresh
    // section must succeed when the target row still exists and diff is empty
    // or still valid.
    const { applyPathOp } = await loadWalker(version);
    const section = makeSection();
    const ops = [{ op: "set", path: ["providers", "gw.example", "models", "1", "maxTokens"], value: 999 }];
    const next = applyPathOp(section, ops[0], schemaVolatileRoot);
    assert.equal(next.providers["gw.example"].models[1].maxTokens, 999);
    // Semantic-change detection: the row moved (splice by another writer) →
    // relocation by modelId finds the new index; ops are REBUILT (never replayed).
    const moved = applyPathOp(section, { op: "unset", path: ["providers", "gw.example", "models", "0"] }, schemaVolatileRoot);
    const newIndex = moved.providers["gw.example"].models.findIndex((m) => m.id === "m2");
    assert.equal(newIndex, 0, "relocated by modelId, not by stale index");
  });
}
