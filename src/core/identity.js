// P1-01: IdentityResolver — five-level matching chain (B3 §3, DESIGN-v2 R-N3).
// Pure function over injected sources; conflict keeps alternatives (I3).

import { modelKeyStorageKey } from "./domain.js";

export const LEVELS = Object.freeze(["local-profile", "route-exact", "catalog", "user-rule", "fuzzy"]);

/**
 * Resolve one (routeId, rawModelId) request against injected sources.
 * @param {{profiles, catalog, rules}} sources
 *   profiles: Map storageKey → profile record (level 1)
 *   catalog: {route: {models: [{id, name, contextWindow, maxTokens, inputModalities}]} | undefined,
 *             providerEntries: [{providerId, modelId, canonicalModelId?, entry}]} (levels 2+3)
 *   rules: [{id, matchRouteId?, matchRawModelId?(glob), usePresetId}] (level 4)
 * @param {object} request {routeId, rawModelId, protocol}
 * @returns {{level, matched, alternatives[], evidence}}
 */
export function resolveIdentity(sources, request) {
  const { routeId, rawModelId } = request;
  const alternatives = [];

  // L1: local profile by exact storage key (high confidence, user's own words)
  const storageKey = modelKeyStorageKey({
    connectionId: sources.connectionId ?? "llm-pi-ai",
    driverId: sources.driverId ?? "pi-ai",
    routeId,
    protocol: request.protocol ?? "",
    rawModelId,
  });
  const profile = sources.profiles?.get?.(storageKey);
  if (profile) {
    return { level: "local-profile", matched: profile, alternatives, evidence: { scope: "model", status: "declared", origin: "user-profile", confidence: "high" } };
  }

  // L2: exact route metadata (host catalog for this route lists the id)
  const routeModels = sources.catalog?.route?.models ?? [];
  const routeHit = routeModels.find((m) => m.id === rawModelId);
  if (routeHit) {
    return { level: "route-exact", matched: routeHit, alternatives, evidence: { scope: "route", status: "declared", origin: "route-metadata", confidence: "high" } };
  }

  // L3: same-provider catalog entry — exact via canonical_model_id field,
  // casefold match, or canonical-field match (entry claims our raw id as its
  // canonical form → the entry IS the resolution, via "canonical").
  const casefold = rawModelId.toLowerCase();
  let canonicalHit;
  let caseHit;
  for (const entry of sources.catalog?.providerEntries ?? []) {
    if (entry.modelId === rawModelId) {
      canonicalHit = entry; // exact directory id
      break;
    }
    if (!canonicalHit && entry.canonicalModelId === rawModelId) canonicalHit = entry; // canonical relation
    else if (!caseHit && entry.modelId.toLowerCase() === casefold) caseHit = entry;
  }
  const catalogHit = canonicalHit ?? caseHit;
  if (catalogHit) {
    const via = canonicalHit ? "canonical" : "casefold";
    alternatives.push(...(via === "canonical" && catalogHit.modelId !== rawModelId ? [{ via: "canonical", id: catalogHit.modelId }] : []));
    return {
      level: "catalog",
      matched: catalogHit.entry ?? catalogHit,
      alternatives,
      evidence: {
        scope: "model",
        status: "declared",
        origin: via === "canonical" ? "route-metadata" : "explicit-alias",
        confidence: via === "canonical" ? "high" : "medium",
        via,
      },
    };
  }

  // L4: user rules — exact model match > glob > route-only, first by that order
  const ruleHits = (sources.rules ?? []).filter((rule) => {
    if (rule.matchRouteId !== undefined && rule.matchRouteId !== routeId) return false;
    if (rule.matchRawModelId !== undefined) {
      if (rule.matchRawModelId.endsWith("*")) {
        if (!rawModelId.startsWith(rule.matchRawModelId.slice(0, -1))) return false;
      } else if (rule.matchRawModelId !== rawModelId) return false;
    }
    return true;
  });
  if (ruleHits.length > 0) {
    const scored = ruleHits.map((rule) => ({
      rule,
      score: (rule.matchRawModelId !== undefined && !rule.matchRawModelId.endsWith("*") ? 2 : rule.matchRawModelId !== undefined ? 1 : 0),
    })).sort((a, b) => b.score - a.score);
    return {
      level: "user-rule",
      matched: scored[0].rule,
      alternatives: scored.slice(1).map((s) => ({ via: "rule", id: s.rule.id })),
      evidence: { scope: "route", status: "declared", origin: "protocol-template", confidence: "high", ruleCount: scored.length },
    };
  }

  // L5: family/fuzzy low-confidence — substring containment only, auto/free skipped
  if (/^(auto|free)$/i.test(rawModelId)) {
    return { level: "fuzzy", matched: undefined, alternatives, evidence: { scope: "model", status: "unknown", origin: "fallback-preset", confidence: "low", note: "dynamic alias, never guessed" } };
  }
  const fuzzy = (sources.catalog?.providerEntries ?? [])
    .filter((entry) => entry.modelId.includes(rawModelId) || rawModelId.includes(entry.modelId))
    .slice(0, 5);
  return { level: "fuzzy", matched: undefined, alternatives: fuzzy.map((f) => ({ via: "fuzzy", id: f.modelId, entry: f })), evidence: { scope: "model", status: "unknown", origin: "fallback-preset", confidence: "low" } };
}
