// P1-06 测试：三态档案、重开后的持久化、路由隔离。

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

test("build+save：value 状态往返且版本号递增", () => {
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

test("重开语义：已清除保持清除、不自动填充、往返稳定（P0-3）", () => {
  const store = repo.createProfileRepository();
  const record = store.buildRecord(keyA, { contextWindow: { state: "value", value: 100 } });
  store.save(record);
  const key = record.storageKey;
  store.clearField(key, "contextWindow");
  // 重开 = 从（模拟的）持久化存储重新读取
  const reopened = store.roundTrip(key);
  assert.equal(reopened.fields.contextWindow.state, "cleared");
  // 引擎遵守该状态：已清除绝不自动填充 —— 仓储本身只证明状态持久化，
  // 不自动填充的行为由候选引擎覆盖。
  // resetField 是用户显式的解锁：
  const reset = store.resetField(key, "contextWindow");
  assert.equal(reset.ok, true);
  assert.equal(store.get(key).fields.contextWindow.state, "inherit");
});

test("另一路由上的同名 id 是隔离的档案（ModelKey 路由隔离）", () => {
  const store = repo.createProfileRepository();
  const a = store.buildRecord(keyA, { contextWindow: { state: "value", value: 111 } });
  const b = store.buildRecord(keyB, { contextWindow: { state: "value", value: 222 } });
  store.save(a);
  store.save(b);
  assert.notEqual(a.storageKey, b.storageKey);
  assert.equal(store.get(a.storageKey).fields.contextWindow.value, 111);
  assert.equal(store.get(b.storageKey).fields.contextWindow.value, 222);
});

test("过期写守卫：旧版本无法覆盖新版本（B5 §2.3）", () => {
  const store = repo.createProfileRepository();
  const record = store.buildRecord(keyA, { contextWindow: { state: "value", value: 1 } });
  store.save(record);
  const stale = { ...record, _version: 0, fields: { contextWindow: { state: "value", value: 0 } } };
  const result = store.save(stale);
  // 守卫与 existing._version 比对；伪造的更旧写入会失败
  assert.equal(result.ok, false);
  assert.equal(result.error, "stale-write");
});

test("存储键转义：rawModelId 中的斜杠与百分号（B1-OQ4 默认）", () => {
  const weird = { ...keyA, rawModelId: "a/b%c" };
  const esc = modelKeyStorageKey(weird);
  assert.ok(esc.includes("%2F"));
  assert.ok(esc.includes("%25c"));
  assert.equal(esc.split("/").length, 5); // 仍然是五段
});

test("默认状态为 inherit；缺失记录 get 返回 undefined", () => {
  const store = repo.createProfileRepository();
  const record = store.buildRecord(keyA, {});
  assert.equal(record.fields.contextWindow.state, "inherit");
  assert.equal(record.fields.reasoning.state, "inherit");
  assert.equal(store.get("nope"), undefined);
});
