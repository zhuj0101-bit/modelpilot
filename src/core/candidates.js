// P1-02: CandidateEngine — field-level candidate synthesis (B3 §4, 8-level order).
// Pure function; touched/locked short-circuit; conflicts kept side-by-side.

import { PI_AI_LEVELS, MODALITIES } from "./domain.js";

/**
 * Synthesize per-field candidates for one model draft.
 * @param {object} input
 *   profile:    ModelProfileV2-like StoredField map (may be undefined)
 *   resolved:   resolved identity entry (route/catalog hit) — may be undefined
 *   template:   user-selected template values — may be undefined
 *   preset:     one of the three presets (basic/coding/long) — may be undefined
 *   touched:    Set of field ids the user edited
 *   locked:     Set of field ids locked by the user
 * @returns {fields: {contextWindow|outputBudget|input|reasoning: Candidate}}
 *   Candidate = {value, origin, evidence:{scope,status,source}, confidence, via}
 */
export function synthesizeCandidates(input) {
  const { resolved, template, preset } = input;
  const touched = input.touched ?? new Set();
  const locked = input.locked ?? new Set();
  const fields = {};

  const decide = (fieldId, chain, { noAutofill = false } = {}) => {
    if (locked.has(fieldId) || touched.has(fieldId)) {
      return { fieldId, shortCircuited: true };
    }
    // cleared = explicit "never autofill again" (a.md §3.B / B2 StoredField):
    // the whole chain is skipped, not just the stored link. Re-enabling is a
    // user action (unlock/clear-reset), never a late catalog arrival.
    if (noAutofill) return { fieldId, candidate: undefined, shortCircuited: false, noAutofill: true };
    for (const link of chain) {
      if (link === undefined || link === null) continue;
      if (link.value === undefined) continue;
      if (link.gate && !link.gate(link.value)) continue;
      return { fieldId, candidate: link, shortCircuited: false };
    }
    return { fieldId, candidate: undefined, shortCircuited: false };
  };

  // StoredField tri-state: cleared → noAutofill for the whole chain;
  // inherit → no explicit value (fall through);
  // value → the stored value is the top-priority candidate.
  const storedInfo = (stored) => {
    if (stored === undefined) return { link: undefined, cleared: false };
    if (stored.state === "cleared") return { link: undefined, cleared: true };
    if (stored.state === "inherit") return { link: undefined, cleared: false };
    return {
      link: { value: stored.value, origin: "user-profile", evidence: { scope: "model", status: "declared", source: "local-profile" }, confidence: "high", via: "profile" },
      cleared: false,
    };
  };

    const ctxStored = storedInfo(input.profile?.contextState !== undefined ? { state: input.profile.contextState, value: input.profile.contextValue } : undefined);
  fields.contextWindow = decide("contextWindow", [
    ctxStored.link,
    resolved ? { value: resolved.context ?? resolved.contextWindow, origin: "route-metadata", evidence: { scope: "route", status: resolved.context !== undefined ? "declared" : "unknown", source: "catalog" }, confidence: "high", via: "catalog" } : undefined,
    resolved?.context && resolved.contextSemantics === "input" ? { value: resolved.context, origin: "route-metadata", evidence: { scope: "model", status: "declared", source: "models-dev" }, confidence: "medium", via: "models-dev-input-semantics" } : undefined,
    template?.contextWindow ? { value: template.contextWindow, origin: "protocol-template", evidence: { scope: "model", status: "unknown", source: "template" }, confidence: "low", via: "template" } : undefined,
    preset?.contextWindow ? { value: preset.contextWindow, origin: "fallback-preset", evidence: { scope: "model", status: "unknown", source: "preset" }, confidence: "low", via: "preset" } : undefined,
  ], { noAutofill: ctxStored.cleared });

  const budgetStored = storedInfo(input.profile?.budgetState !== undefined ? { state: input.profile.budgetState, value: input.profile.budgetValue } : undefined);
  fields.outputBudget = decide("outputBudget", [
    budgetStored.link,
    // Models.dev declared output limit is capability FACT, not the user budget —
    // it surfaces as evidence only (B4 three-value display), never as the budget.
    template?.outputBudget ? { value: template.outputBudget, origin: "protocol-template", evidence: { scope: "model", status: "unknown", source: "template" }, confidence: "low", via: "template" } : undefined,
    preset?.outputBudget ? { value: preset.outputBudget, origin: "fallback-preset", evidence: { scope: "model", status: "unknown", source: "preset" }, confidence: "low", via: "preset" } : undefined,
    { value: 8192, origin: "fallback-preset", evidence: { scope: "model", status: "unknown", source: "default" }, confidence: "low", via: "default-budget" },
  ], { noAutofill: budgetStored.cleared });

  const inputStored = storedInfo(input.profile?.inputState !== undefined ? { state: input.profile.inputState, value: input.profile.inputValue } : undefined);
  fields.input = decide("input", [
    inputStored.link,
    resolved?.inputModalities ? { value: resolved.inputModalities.filter((m) => MODALITIES.includes(m)), origin: "route-metadata", evidence: { scope: "model", status: "declared", source: "catalog" }, confidence: "high", via: "catalog" } : undefined,
    template?.input ? { value: template.input, origin: "protocol-template", evidence: { scope: "model", status: "unknown", source: "template" }, confidence: "low", via: "template" } : undefined,
    preset?.input ? { value: preset.input, origin: "fallback-preset", evidence: { scope: "model", status: "unknown", source: "preset" }, confidence: "low", via: "preset" } : undefined,
    { value: ["text"], origin: "fallback-preset", evidence: { scope: "model", status: "unknown", source: "default" }, confidence: "low", via: "default-input" },
  ], { noAutofill: inputStored.cleared });

  const reasoningStored = storedInfo(input.profile?.reasoningState !== undefined ? { state: input.profile.reasoningState, value: input.profile.reasoningValue } : undefined);
  fields.reasoning = decide("reasoning", [
    reasoningStored.link,
    // Catalog-declared reasoning: convert models.dev controls into an effort policy
    resolved?.reasoningControls?.length ? { value: reasoningPolicyFromControls(resolved.reasoningControls), origin: "route-metadata", evidence: { scope: "model", status: "declared", source: "catalog" }, confidence: "medium", via: "catalog-reasoning" } : undefined,
    template?.reasoning ? { value: template.reasoning, origin: "protocol-template", evidence: { scope: "model", status: "unknown", source: "template" }, confidence: "low", via: "template" } : undefined,
    { value: { mode: "inherit" }, origin: "fallback-preset", evidence: { scope: "model", status: "unknown", source: "default" }, confidence: "low", via: "default-inherit" },
  ], { noAutofill: reasoningStored.cleared });

  return { fields, shortCircuited: Object.values(fields).filter((f) => f.shortCircuited).map((f) => f.fieldId) };
}

/** models.dev controls → ReasoningPolicy [B3 §2 mapping; effort values preserved]. */
export function reasoningPolicyFromControls(controls) {
  const effort = controls.find((c) => c.kind === "effort");
  if (effort) {
    const defaultLevel = effort.values.find((v) => PI_AI_LEVELS.includes(v) && v !== "off") ?? effort.values[0];
    return { mode: "effort", defaultLevel, wireProfileId: "pi-ai-catalog", allowedLevels: effort.values };
  }
  if (controls.some((c) => c.kind === "toggle")) return { mode: "disabled", wireProfileId: "pi-ai-toggle" };
  return { mode: "inherit" };
}
