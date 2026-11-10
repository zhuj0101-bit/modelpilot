// P1-06 tests: tri-state profiles, reopen persistence, route isolation.

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const repo = await import(pathToFileURL(join(root, "src", "core", "profile-repository.js")).href);
const { modelKeyStorageKey } = await import(pathToFileURL(join(root, "src", "core", "domain.js")).href);

const keyA = { connectionId: "llm-pi-ai", driverId: "pi-ai", routeId: "gw", protocol: "openai-completions", rawModelId: "m1" };
const keyB = { ...keyA, routeId: "other" };

test("build+save: value state round-trips with version bump", () => {
  const store = repo.createProfileRepository();
  const record = store.buildRecord(keyA, {
    contextWindow: { state: "value", value: 131072, origin: "user-profile" },
    outputBudget: { state: "value", value: 4096, origin: "user-profile" },
  }, { lockedFields: ["contextWindow"] });
  const saved = store.save(record);
  assert.equal(saved.ok, true);
  const read = store.get(record.storageKey);
  assert.equal(read.fields.contextWindow.state, "value");
  assert.equal(read.fields.contextWindow.value, 131072);
  assert.deepEqual(read.lockedFields, ["contextWindow"]);
  assert.ok(read._version > 1);
});

test("reopen semantics: cleared stays cleared, no autofill, round-trip stable (P0-3)", () => {
  const store = repo.createProfileRepository();
  const record = store.buildRecord(keyA, { contextWindow: { state: "value", value: 100 } });
  store.save(record);
  const key = record.storageKey;
  store.clearField(key, "contextWindow");
  // reopen = re-read from the (simulated) persisted store
  const reopened = store.roundTrip(key);
  assert.equal(reopened.fields.contextWindow.state, "cleared");
  // engine honours it: cleared never autofills — repository alone proves state
  // persistence; the candidates engine covers the no-autofill behavior.
  // resetField is the explicit user unlock:
  const reset = store.resetField(key, "contextWindow");
  assert.equal(reset.ok, true);
  assert.equal(store.get(key).fields.contextWindow.state, "inherit");
});

test("same id on another route is an isolated profile (ModelKey route isolation)", () => {
  const store = repo.createProfileRepository();
  const a = store.buildRecord(keyA, { contextWindow: { state: "value", value: 111 } });
  const b = store.buildRecord(keyB, { contextWindow: { state: "value", value: 222 } });
  store.save(a);
  store.save(b);
  assert.notEqual(a.storageKey, b.storageKey);
  assert.equal(store.get(a.storageKey).fields.contextWindow.value, 111);
  assert.equal(store.get(b.storageKey).fields.contextWindow.value, 222);
});

test("stale-write guard: old version cannot clobber newer (B5 §2.3)", () => {
  const store = repo.createProfileRepository();
  const record = store.buildRecord(keyA, { contextWindow: { state: "value", value: 1 } });
  store.save(record);
  const stale = { ...record, _version: 0, fields: { contextWindow: { state: "value", value: 0 } } };
  const result = store.save(stale);
  // our guard compares against existing._version; a forged older write fails
  assert.equal(result.ok, false);
  assert.equal(result.error, "stale-write");
});

test("storage key escaping: slash and percent in rawModelId (B1-OQ4 default)", () => {
  const weird = { ...keyA, rawModelId: "a/b%c" };
  const esc = modelKeyStorageKey(weird);
  assert.ok(esc.includes("%2F"));
  assert.ok(esc.includes("%25c"));
  assert.equal(esc.split("/").length, 5); // still five segments
});

test("default state is inherit; missing record get is undefined", () => {
  const store = repo.createProfileRepository();
  const record = store.buildRecord(keyA, {});
  assert.equal(record.fields.contextWindow.state, "inherit");
  assert.equal(record.fields.reasoning.state, "inherit");
  assert.equal(store.get("nope"), undefined);
});
