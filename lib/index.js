// dsh-model-assistant — Host half.
//
// Plugin settings namespace: the composition entry id in cordis.patch.yml
// ("modelpilot") is the settings namespace the host keys our documents by
// [audit 02-S1: settings describe() uses entry.options.id as ns].
//
// Only `.volatile()` fields are exposed through DSH settings forms; all four
// data lines below are volatile so the whole namespace is online-editable
// through the settings writer [B1 §1.4].
//
// P0 scope: declaration only. Business logic lands behind P0 gates
// (docs/PLAN.md P0-01..P0-05).

import z from "@deepseek-ai/schemastery";
import { ModelAssistantService } from "./model-assistant-service.js";

/** Own settings namespace. Must equal the cordis.patch.yml insert id. */
export const SETTINGS_NS = "modelpilot";

/** Plugin name registered with cordis. */
export const name = "model-assistant";

/** Host services this plugin requires before apply runs. */
export const inject = [];

/** Stored-field tri-state, mirrored in the schema as string values.
 * value → the field carries an explicit user value;
 * inherit → follow host entry/route defaults (projection: delete override key);
 * cleared → explicit removal of the declaration (see B2 §4 cleared-lossy).
 * [B2-data-model-projection §2, tsc-strict verified] */
export const FIELD_STATES = ["value", "inherit", "cleared"];

/** One durable model profile record (ModelProfileV2 serialized form). */
const profileRecord = z.object({
  key: z.string().required(), // canonical JSON of ModelKey (connectionId/driverId/routeId/protocol/rawModelId), percent-encoded per B1 OQ-4
  connectionId: z.string(),
  driverId: z.union(["pi-ai", "deepseek"]).required(),
  routeId: z.string(),
  protocol: z.string(),
  rawModelId: z.string().required(),
  contextState: z.union(FIELD_STATES).default("inherit"),
  contextValue: z.number().step(1).min(1),
  budgetState: z.union(FIELD_STATES).default("inherit"),
  budgetValue: z.number().step(1).min(1),
  inputState: z.union(FIELD_STATES).default("inherit"),
  inputValue: z.array(z.union(["text", "image"])),
  reasoning: z.string(), // serialized ReasoningPolicy JSON
  locked: z.array(z.string()).default([]), // field ids locked by the user
  updatedAt: z.string()
});

/** One structured rule (B3 §5). */
const ruleRecord = z.object({
  id: z.string().required(),
  matchRouteId: z.string(),
  matchRawModelId: z.string(), // trailing-* glob only, ≤128 chars
  usePresetId: z.string(),
  reasoningProfileId: z.string(),
  note: z.string()
});

/** One ledger event (B5 §8 — the canonical schema; B1 mirrors it to JSONL). */
const ledgerEvent = z.object({
  ts: z.string().required(),
  planId: z.string(),
  ns: z.string(),
  op: z.string(),
  path: z.string(),
  before: z.string(), // canonical JSON or "" for absent
  after: z.string(),
  via: z.string().default("ui"),
  result: z.string().required(), // ok | conflict | skipped | error
  meta: z.string()
});

/** Durable configuration of this plugin's own entry. */
export const Config = z
  .object({
    profiles: z.array(profileRecord).default([]).volatile(),
    rules: z.array(ruleRecord).default([]).volatile(),
    locks: z.array(z.string()).default([]).volatile(),
    ledger: z.array(ledgerEvent).default([]).volatile()
  })
  .default({});

function apply(ctx) {
  // Turn off the auto-generated settings form: this plugin ships its own
  // workbench UI (dsh.client half). The generic form stays available as a
  // degraded fallback if configure() is unavailable on the running host.
  try {
    ctx.inject(["settings"], (child) => {
      child.effect(
        () => child.settings.configure({ auto: false }, ctx.fiber),
        "model-assistant: custom settings page",
      );
    });
  } catch {
    // Conservative default (B1 OQ-5): if configure() is unavailable on some
    // host build, degrade to the visible generic form instead of failing boot.
  }

  // Remote service (SRC-mode, namespace "modelAssistant"): the constructor's
  // TypertRemoteService → bindTypertRemote call is the registration; the
  // gateway resolves <namespace>/<method> through its SRC fallback because we
  // ship no ./typert manifest (docs/p0-evidence-notes.md N1, re-verified on
  // 0.2.2 in N9).
  ctx.effect(
    () => {
      const service = new ModelAssistantService(ctx);
      return () => void service;
    },
    "model-assistant: modelAssistant remote service",
  );
}

export { apply };
