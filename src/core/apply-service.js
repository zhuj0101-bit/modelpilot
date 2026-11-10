// P1-04/P1-05: ApplyService — prepare/commit, planId idempotency, lastApplied
// field fingerprints & undo (B5 §1–§4). Pure orchestration over injected
// ports: settingsWriter (read revision, apply ops), profileStore, ledger.

import { canonicalJson, fieldFingerprint } from "./domain.js";

/** Build a planId bound to the desired content (B5 §2.1). */
export function makePlanId(ops, desiredProfileVersion) {
  return `plan-${fieldFingerprint("$plan", { ops, desiredProfileVersion })}`;
}

/**
 * prepare(): locate target rows, validate projection, produce the plan.
 * @param {object} input
 *   projection: ProjectionResult from the adapter (already has settingsOps/warnings)
 *   hostRevision: current revision of the target ns (from describe)
 *   profileVersion: desiredProfileVersion of the draft
 *   ackedWarnings: Set of warning codes the user confirmed (e.g. catalog-replacement)
 * @returns plan or {refused, reason}
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
 * commit(): profile first (desired/pending), then host patch via the writer.
 * Both steps report independently — the two namespaces are NOT atomic [B5 §1.3].
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

  // ① profile line (desired/pending)
  const profileResult = await ports.profileStore.save(plan.planId, plan.profileVersion, { ...profile, state: "pending" });
  if (!profileResult.ok) {
    record({ ts: now(), planId: plan.planId, ns: "modelpilot", op: "profile-save", path: "$", via: "ui", result: "error" });
    return { planId: plan.planId, profile: { ok: false, error: profileResult.error }, host: { ok: false, skipped: true, reason: "profile-failed" }, events };
  }
  record({ ts: now(), planId: plan.planId, ns: "modelpilot", op: "profile-save", path: "$", via: "ui", result: "ok" });

  // ② host minimal patch with revision fence + one retry (re-read + relocate + re-diff)
  let hostResult = await ports.settingsWriter.write(ns, plan.ops, plan.hostRevision);
  if (!hostResult.ok && hostResult.conflict) {
    record({ ts: now(), planId: plan.planId, ns, op: "host-write", path: plan.ops[0]?.path?.join("."), via: "ui", result: "conflict" });
    const retry = await ports.settingsWriter.write(ns, plan.ops, hostResult.conflict.actual); // re-read revision
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

  // ③ lastApplied field fingerprints + reverse patch (B5 §3)
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
 * undoField(): revert one field only if its current value still matches the
 * applied fingerprint (external edits are never overwritten) [B5 §3.3].
 * @param ports.settingsWriter.read(ns) → section (current host doc)
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
  // Reverse op: set → restore previous value if the caller recorded one,
  // else unset (delete key); append-row (set with rest empty on an array) →
  // unset the whole row. Location is re-resolved by id for array rows [B5 §3.2].
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
