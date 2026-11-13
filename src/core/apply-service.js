// P1-04/P1-05：ApplyService —— prepare/commit、planId 幂等、lastApplied
// 字段指纹与撤销（B5 §1–§4）。在注入端口之上的纯编排：
// settingsWriter（读修订号、应用 ops）、profileStore、台账。

import { canonicalJson, fieldFingerprint } from "./domain.js";

/** 构造与目标内容绑定的 planId（B5 §2.1）。 */
export function makePlanId(ops, desiredProfileVersion) {
  return `plan-${fieldFingerprint("$plan", { ops, desiredProfileVersion })}`;
}

/**
 * prepare()：定位目标行、校验投影、产出计划。
 * @param {object} input
 *   projection: 适配器给出的 ProjectionResult（已包含 settingsOps / warnings）
 *   hostRevision: 目标命名空间当前的修订号（来自 describe）
 *   profileVersion: 草稿的 desiredProfileVersion
 *   ackedWarnings: 用户已确认的告警 code 集合（例如 catalog-replacement）
 * @returns 计划，或 {refused, reason}
 */
export function prepare({ projection, hostRevision, profileVersion, ackedWarnings = new Set() }) {
  const blocking = projection.warnings.filter((w) => w.requiresAck && !ackedWarnings.has(w.code));
  if (blocking.length > 0) {
    return { refused: true, reason: "unacked-warnings", warnings: blocking };
  }
  if (projection.unsupportedControls.length > 0 || projection.settingsOps.length === 0) {
    return { refused: true, reason: "no-viable-ops", unsupported: projection.unsupportedControls };
  }
  return {
    refused: false,
    planId: makePlanId(projection.settingsOps, profileVersion),
    ops: projection.settingsOps,
    appliedFields: projection.appliedFields,
    profileOnlyFields: projection.profileOnlyFields,
    hostRevision,
    profileVersion,
    warnings: projection.warnings,
  };
}

/**
 * commit()：先写用户档案（desired / pending），再通过写入器打宿主补丁。
 * 两步各自独立汇报 —— 两个命名空间并不具备原子性 [B5 §1.3]。
 * @param {object} ports
 *   profileStore: {save(planId, profileVersion, record) → {ok, revision} | {ok:false, error}}
 *   settingsWriter: {write(ns, ops, expectedRevision) → {ok, revision} | {ok:false, conflict:{expected,actual}}}
 *   ledger: {append(event)}
 */
export async function commit(plan, ports, { ns, profile } = {}) {
  const events = [];
  const record = (event) => {
    events.push(event);
    ports.ledger?.append?.(event);
    return event;
  };

  // ① 档案行（desired / pending）
  const profileResult = await ports.profileStore.save(plan.planId, plan.profileVersion, { ...profile, state: "pending" });
  if (!profileResult.ok) {
    record({ ts: now(), planId: plan.planId, ns: "modelpilot", op: "profile-save", path: "$", via: "ui", result: "error" });
    return { planId: plan.planId, profile: { ok: false, error: profileResult.error }, host: { ok: false, skipped: true, reason: "profile-failed" }, events };
  }
  record({ ts: now(), planId: plan.planId, ns: "modelpilot", op: "profile-save", path: "$", via: "ui", result: "ok" });

  // ② 带修订号围栏的宿主最小补丁 + 一次重试（重读 + 重定位 + 重算差异）
  let hostResult = await ports.settingsWriter.write(ns, plan.ops, plan.hostRevision);
  if (!hostResult.ok && hostResult.conflict) {
    record({ ts: now(), planId: plan.planId, ns, op: "host-write", path: plan.ops[0]?.path?.join("."), via: "ui", result: "conflict" });
    const retry = await ports.settingsWriter.write(ns, plan.ops, hostResult.conflict.actual); // 重读修订号
    hostResult = retry.ok ? retry : { ...retry, retried: true };
  }
  if (!hostResult.ok) {
    record({ ts: now(), planId: plan.planId, ns, op: "host-write", path: plan.ops[0]?.path?.join("."), via: "ui", result: hostResult.conflict ? "conflict" : "error" });
    return {
      planId: plan.planId,
      profile: { ok: true, revision: profileResult.revision, state: "desired" },
      host: { ok: false, conflict: hostResult.conflict, error: hostResult.error, retried: hostResult.retried },
      events,
      userMessage: "档案已保存，DSH 未应用",
    };
  }
  record({ ts: now(), planId: plan.planId, ns, op: "host-write", path: plan.ops[0]?.path?.join("."), via: "ui", result: "ok", meta: { revision: hostResult.revision } });

  // ③ lastApplied 字段指纹 + 反向补丁（B5 §3）
  const lastApplied = plan.ops.map((op) => ({
    path: op.path,
    fingerprint: fieldFingerprint(op.path, op.op === "set" ? op.value : undefined),
    op: op.op,
    value: op.op === "set" ? op.value : undefined,
    appliedRevision: hostResult.revision,
  }));
  return {
    planId: plan.planId,
    profile: { ok: true, revision: profileResult.revision, state: "applied" },
    host: { ok: true, revision: hostResult.revision },
    lastApplied,
    events,
  };
}

/**
 * undoField()：仅当该字段当前值仍与已应用指纹一致时才回滚
 * （外部改动绝不覆盖）[B5 §3.3]。
 * @param ports.settingsWriter.read(ns) → section（当前宿主文档）
 * @param ports.settingsWriter.write(ns, ops, expectedRevision)
 */
export async function undoField(entry, ports, { ns }) {
  const { path, fingerprint, op, value } = entry;
  const section = await ports.settingsReader.read(ns);
  const current = valueAtPath(section, path);
  const currentFp = fieldFingerprint(path, op === "set" ? current : undefined);
  if (currentFp !== fingerprint) {
    return { ok: false, reason: "external-modification", current };
  }
  // 反向 op：set → 调用方记录过原值就还原原值，否则 unset（删键）；
  // 追加行（数组上的 set，且尾部为空）→ 整行 unset。
  // 数组行的位置会按 id 重新定位 [B5 §3.2]。
  let reverse;
  if (op === "set" && entry.reverseValue !== undefined) {
    reverse = { op: "set", path, value: entry.reverseValue };
  } else {
    reverse = { op: "unset", path };
  }
  const revision = await ports.settingsWriter.currentRevision(ns);
  const result = await ports.settingsWriter.write(ns, [reverse], revision);
  return result.ok ? { ok: true, reverse } : { ok: false, reason: "write-failed", error: result.error, conflict: result.conflict };
}

function valueAtPath(section, path) {
  let node = section;
  for (const key of path) {
    if (node === undefined || node === null) return undefined;
    node = Array.isArray(node) ? node[Number(key)] : node[key];
  }
  return node;
}

function now() {
  return new Date().toISOString();
}
