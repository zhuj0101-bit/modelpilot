// P1-04/P1-05 测试：prepare/commit、幂等、指纹、撤销。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const svc = await import(pathToFileURL(join(root, "src", "core", "apply-service.js")).href);
const { canonicalJson, fieldFingerprint } = await import(pathToFileURL(join(root, "src", "core", "domain.js")).href);

const projectionOk = {
  settingsOps: [{ op: "set", path: ["providers", "gw", "models", "2"], value: { id: "m3", maxTokens: 4096 } }],
  appliedFields: ["id", "maxTokens"],
  profileOnlyFields: [],
  unsupportedControls: [],
  warnings: [],
  previewFidelity: "logical-only",
};

function makePorts({ conflictOnce = false, section } = {}) {
  let writeCount = 0;
  const events = [];
  return {
    events,
    ports: {
      profileStore: { save: async () => ({ ok: true, revision: 11 }) },
      settingsWriter: {
        currentRevision: async () => 9,
        write: async (ns, ops, expected) => {
          writeCount++;
          if (conflictOnce && writeCount === 1) return { ok: false, conflict: { expected, actual: expected + 1 } };
          return { ok: true, revision: 10 };
        },
      },
      settingsReader: { read: async () => section ?? { providers: { gw: { models: [{ id: "m1" }, { id: "m2" }, { id: "m3", maxTokens: 4096 }] } } } },
      ledger: { append: (event) => events.push(event) },
    },
  };
}

test("prepare：构建绑定到 ops+profileVersion 的 planId", () => {
  const plan = svc.prepare({ projection: projectionOk, hostRevision: 9, profileVersion: 3 });
  assert.equal(plan.refused, false);
  assert.equal(plan.planId, svc.makePlanId(projectionOk.settingsOps, 3));
  // 内容+版本相同 → planId 相同（幂等重复点击）
  const again = svc.prepare({ projection: projectionOk, hostRevision: 9, profileVersion: 3 });
  assert.equal(again.planId, plan.planId);
  // 内容变化 → planId 不同
  const changed = svc.prepare({ projection: { ...projectionOk, settingsOps: [projectionOk.settingsOps[0]] }, hostRevision: 9, profileVersion: 4 });
  assert.notEqual(changed.planId, plan.planId);
});

test("prepare：未确认的 catalog-replacement 拒绝；已确认则通过", () => {
  const withGate = { ...projectionOk, warnings: [{ code: "catalog-replacement", requiresAck: true, removedCatalogIds: ["a"] }] };
  const refused = svc.prepare({ projection: withGate, hostRevision: 9, profileVersion: 1 });
  assert.equal(refused.refused, true);
  assert.equal(refused.reason, "unacked-warnings");
  const acked = svc.prepare({ projection: withGate, hostRevision: 9, profileVersion: 1, ackedWarnings: new Set(["catalog-replacement"]) });
  assert.equal(acked.refused, false);
});

test("prepare：不支持的控件带原因拒绝", () => {
  const result = svc.prepare({ projection: { ...projectionOk, unsupportedControls: [{ control: "append", reason: "duplicate-model-id" }] }, hostRevision: 9, profileVersion: 1 });
  assert.equal(result.refused, true);
  assert.equal(result.reason, "no-viable-ops");
});

test("commit：档案优先；宿主失败时档案保持为期望状态（B5 §1.2）", async () => {
  const { ports, events } = makePorts({ conflictOnce: false });
  // 让宿主始终失败
  ports.settingsWriter.write = async () => ({ ok: false, conflict: { expected: 9, actual: 12 } });
  const plan = svc.prepare({ projection: projectionOk, hostRevision: 9, profileVersion: 1 });
  const result = await svc.commit(plan, ports, { ns: "llm-pi-ai", profile: { key: "k" } });
  assert.equal(result.profile.ok, true);
  assert.equal(result.profile.state, "desired");
  assert.equal(result.host.ok, false);
  assert.equal(result.userMessage, "档案已保存，DSH 未应用");
  assert.ok(events.some((e) => e.result === "conflict"));
});

test("commit：冲突后用新修订号重试一次（A2：重读，同样重定位后的操作）", async () => {
  const { ports } = makePorts({ conflictOnce: true });
  const plan = svc.prepare({ projection: projectionOk, hostRevision: 9, profileVersion: 1 });
  const result = await svc.commit(plan, ports, { ns: "llm-pi-ai", profile: {} });
  assert.equal(result.host.ok, true);
  assert.equal(result.host.revision, 10);
});

test("commit：成功时记录 lastApplied 指纹（B5 §3.1）", async () => {
  const { ports } = makePorts();
  const plan = svc.prepare({ projection: projectionOk, hostRevision: 9, profileVersion: 1 });
  const result = await svc.commit(plan, ports, { ns: "llm-pi-ai", profile: {} });
  assert.equal(result.lastApplied.length, 1);
  const entry = result.lastApplied[0];
  assert.equal(entry.fingerprint, fieldFingerprint(["providers", "gw", "models", "2"], { id: "m3", maxTokens: 4096 }));
  assert.equal(entry.appliedRevision, 10);
});

test("undoField：指纹匹配则回退（unset 该行）；外部编辑则拒绝", async () => {
  const { ports } = makePorts();
  const plan = svc.prepare({ projection: projectionOk, hostRevision: 9, profileVersion: 1 });
  const committed = await svc.commit(plan, ports, { ns: "llm-pi-ai", profile: {} });
  const entry = { ...committed.lastApplied[0] };
  // 当前分节仍持有该行 → unset 生效
  const undo = await svc.undoField(entry, ports, { ns: "llm-pi-ai" });
  assert.equal(undo.ok, true);
  assert.deepEqual(undo.reverse, { op: "unset", path: entry.path });
  // 外部修改：指纹不匹配 → 拒绝，绝不覆盖
  ports.settingsReader.read = async () => ({ providers: { gw: { models: [{ id: "m1" }, { id: "m2" }, { id: "m3", maxTokens: 99999 }] } } });
  const refused = await svc.undoField(entry, ports, { ns: "llm-pi-ai" });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "external-modification");
});

test("指纹规范化：键顺序无关，数字字符串区分", () => {
  assert.equal(fieldFingerprint(["a"], { x: 1, y: 2 }), fieldFingerprint(["a"], { y: 2, x: 1 }));
  assert.notEqual(fieldFingerprint(["a"], { x: "1" }), fieldFingerprint(["a"], { x: 1 }));
});
