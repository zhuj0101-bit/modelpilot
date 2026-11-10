// P1-03: HostProjectionAdapter — pi-ai projection (B2 §4; DESIGN-v2 §6 J1/J2).
// Pure function: (profile draft + hostState) → ProjectionResult.
// Refusals produce ops:[] + unsupportedControls — never throw [B2 §3].

import { canonicalJson, validatePiAiReasoningEfforts, PI_AI_LEVELS, MODALITIES } from "./domain.js";

export const WHITELIST = Object.freeze(["name", "contextWindow", "maxTokens", "input", "reasoningEfforts"]);

/**
 * @param {object} draft - selected values {id, name?, contextWindow?, maxTokens?, input?, reasoning?}
 *   reasoning = ReasoningPolicy.
 * @param {object} hostState - {providers: {<routeId>: {models?: [...], modelOverrides?: {...}}}, catalogModels?: Set}
 * @param {object} opts {routeId, append: bool}
 * @returns ProjectionResult {settingsOps, appliedFields, profileOnlyFields, unsupportedControls, warnings, previewFidelity}
 */
export function projectPiAi(draft, hostState, { routeId, append = true } = {}) {
  const result = {
    settingsOps: [],
    appliedFields: [],
    profileOnlyFields: [],
    unsupportedControls: [],
    warnings: [],
    previewFidelity: "logical-only",
  };
  const providers = hostState?.providers ?? {};
  const route = providers[routeId];
  const models = Array.isArray(route?.models) ? route.models : undefined;
  const overrides = route?.modelOverrides ?? {};
  const hasCatalog = hostState?.catalogModels instanceof Set ? hostState.catalogModels.size > 0 : Boolean(hostState?.catalogModels);

  // Mutual exclusion [audit 02-S3: resolveRouteModels refuses both channels]
  if (Object.keys(overrides).length > 0 && (append || models !== undefined)) {
    result.warnings.push({ code: "models-overrides-exclusive", message: `route "${routeId}" already uses modelOverrides; a models array write is refused by the host` });
    result.unsupportedControls.push({ control: "models-channel", reason: "overrides-channel-conflict" });
    return result;
  }

  // Duplicate id guard (host refuses; we pre-refuse with relocation info)
  const existingIndex = (models ?? []).findIndex((m) => m?.id === draft.id);
  const caseFold = (models ?? []).findIndex((m) => typeof m?.id === "string" && m.id !== draft.id && m.id.toLowerCase() === draft.id.toLowerCase());
  if (existingIndex >= 0) {
    result.warnings.push({ code: "duplicate-model-id", message: `model "${draft.id}" already exists at models.${existingIndex}` });
    result.unsupportedControls.push({ control: "append", reason: "duplicate-model-id" });
    return result;
  }
  if (caseFold >= 0) {
    result.warnings.push({ code: "duplicate-model-id-casefold", message: `"${draft.id}" differs only by case from models.${caseFold} ("${models[caseFold].id}")` });
  }

  // Catalog replacement warning (P1-1 gate; ops withheld until acked)
  if (models === undefined && hasCatalog && draft.id !== undefined) {
    const catalogIds = hostState.catalogModels instanceof Set ? [...hostState.catalogModels] : hostState.catalogModels;
    result.warnings.push({
      code: "catalog-replacement",
      message: `writing models to catalog route "${routeId}" replaces the served directory`,
      removedCatalogIds: catalogIds ?? [],
      requiresAck: true,
    });
    // ops withheld: caller must re-invoke with {ackedReplacement: true}
    if (!arguments[2]?.ackedReplacement) return result;
  }

  // Reasoning projection: policy → reasoningEfforts dict, with R1–R7 pre-check
  let reasoningEfforts;
  if (draft.reasoning !== undefined && draft.reasoning.mode !== "inherit") {
    if (draft.reasoning.mode === "disabled") {
      reasoningEfforts = false; // pi-ai: false = non-reasoning model declaration
    } else if (draft.reasoning.mode === "effort") {
      const dict = {};
      dict.off = null; // off:null = omit the parameter (audit 02-S3)
      for (const level of draft.reasoning.levels ?? [draft.reasoning.defaultLevel].filter(Boolean)) {
        if (!PI_AI_LEVELS.includes(level)) {
          result.unsupportedControls.push({ control: `reasoningEfforts.${level}`, reason: "unknown-thinking-level" });
          continue;
        }
        if (level === "off") continue;
        dict[level] = draft.reasoning.wireMap?.[level] ?? level; // wire spelling defaults to the level id
      }
      reasoningEfforts = dict;
    } else if (draft.reasoning.mode === "budget") {
      result.profileOnlyFields.push("reasoningBudget");
      reasoningEfforts = undefined; // budget has no per-model slot; dict stays as-is
    }
    if (reasoningEfforts !== undefined && reasoningEfforts !== false) {
      const refusal = validatePiAiReasoningEfforts(reasoningEfforts);
      if (refusal) {
        // A bad dict would fail the WHOLE route's resolution on the host —
        // refuse everything (B2 §4.2: reasoning refusal drops all ops).
        result.unsupportedControls.push({ control: "reasoningEfforts", reason: refusal.code, message: refusal.message });
        result.settingsOps = [];
        result.appliedFields = [];
        return result;
      }
    }
  }

  // Build the row from the whitelist only; unknown keys are dropped with a warning
  const row = { id: draft.id };
  const valueFields = [];
  for (const field of WHITELIST) {
    if (field === "reasoningEfforts") continue;
    const value = draft[field];
    if (value === undefined) continue;
    if (field === "input") {
      const filtered = Array.isArray(value) ? value.filter((m) => MODALITIES.includes(m)) : undefined;
      if (filtered === undefined || filtered.length === 0) continue;
      row[field] = filtered;
    } else if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value) && value > 0)) {
      row[field] = value;
    } else {
      result.unsupportedControls.push({ control: field, reason: "invalid-value-shape" });
      continue;
    }
    valueFields.push(field);
  }

  if (reasoningEfforts !== undefined) {
    row.reasoningEfforts = reasoningEfforts;
    valueFields.push("reasoningEfforts");
  }
  for (const key of Object.keys(draft)) {
    if (key === "id" || key === "reasoning") continue;
    if (!WHITELIST.includes(key)) result.warnings.push({ code: "unknown-key-dropped", message: `draft.${key} is outside the pi-ai whitelist; host would drop it` });
  }

  // Emit ops: append whole row or set per-field on the located index
  if (existingIndex >= 0) {
    // unreachable (duplicate refused above) — kept for clarity
  }
  if (models === undefined) {
    // Route has no models array: this write CREATES it with our row at 0
    // (hand-declared route: no catalog to lose → no replacement warning).
    result.settingsOps.push({ op: "set", path: ["providers", routeId, "models", "0"], value: row });
  } else if (models.length === 0) {
    result.settingsOps.push({ op: "set", path: ["providers", routeId, "models", "0"], value: row });
  } else if (append) {
    result.settingsOps.push({ op: "set", path: ["providers", routeId, "models", String(models.length)], value: row });
  }
  result.appliedFields.push("id", ...valueFields);

  // contextWindow semantics warning when the resolved fact says input-only
  if (draft.contextSemantics === "input") {
    result.warnings.push({ code: "context-input-semantics", message: "declared context is input-only; DSH treats contextWindow as combined" });
  }
  // maxTokens dual identity reminder (B4 three-value display obligation)
  if (row.maxTokens !== undefined) {
    result.warnings.push({ code: "max-tokens-dual-identity", message: "maxTokens also becomes the default request output budget when a call omits maxTokens" });
  }
  return result;
}
