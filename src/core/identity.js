// P1-01：IdentityResolver —— 五级匹配链（B3 §3，DESIGN-v2 R-N3）。
// 对注入来源做纯函数处理；出现冲突时保留备选（I3）。

import { modelKeyStorageKey } from "./domain.js";

export const LEVELS = Object.freeze(["local-profile", "route-exact", "catalog", "user-rule", "fuzzy"]);

/**
 * 针对注入来源解析一个 (routeId, rawModelId) 请求。
 * @param {{profiles, catalog, rules}} sources
 *   profiles: Map storageKey → 档案记录（第 1 级）
 *   catalog: {route: {models: [{id, name, contextWindow, maxTokens, inputModalities}]} | undefined,
 *             providerEntries: [{providerId, modelId, canonicalModelId?, entry}]}（第 2、3 级）
 *   rules: [{id, matchRouteId?, matchRawModelId?(glob), usePresetId}]（第 4 级）
 * @param {object} request {routeId, rawModelId, protocol}
 * @returns {{level, matched, alternatives[], evidence}}
 */
export function resolveIdentity(sources, request) {
  const { routeId, rawModelId } = request;
  const alternatives = [];

  // L1：按精确存储键命中本地档案（高置信，用户自己写的）
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

  // L2：精确命中路由元数据（该路由的宿主目录里列了这个 id）
  const routeModels = sources.catalog?.route?.models ?? [];
  const routeHit = routeModels.find((m) => m.id === rawModelId);
  if (routeHit) {
    return { level: "route-exact", matched: routeHit, alternatives, evidence: { scope: "route", status: "declared", origin: "route-metadata", confidence: "high" } };
  }

  // L3：同 provider 的目录条目 —— 通过 canonical_model_id 字段精确命中、
  // 大小写折叠匹配，或规范字段匹配（条目声称我们的原始 id 就是它的规范
  // 形态 → 该条目本身就是解析结果，via 记作 "canonical"）。
  const casefold = rawModelId.toLowerCase();
  let canonicalHit;
  let caseHit;
  for (const entry of sources.catalog?.providerEntries ?? []) {
    if (entry.modelId === rawModelId) {
      canonicalHit = entry; // 精确命中目录 id
      break;
    }
    if (!canonicalHit && entry.canonicalModelId === rawModelId) canonicalHit = entry; // 规范关系
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

  // L4：用户规则 —— 精确模型匹配 > 通配 > 仅路由，按此优先级取第一个
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

  // L5：同族 / 模糊，低置信 —— 只做子串包含判断，auto / free 直接跳过
  if (/^(auto|free)$/i.test(rawModelId)) {
    return { level: "fuzzy", matched: undefined, alternatives, evidence: { scope: "model", status: "unknown", origin: "fallback-preset", confidence: "low", note: "dynamic alias, never guessed" } };
  }
  const fuzzy = (sources.catalog?.providerEntries ?? [])
    .filter((entry) => entry.modelId.includes(rawModelId) || rawModelId.includes(entry.modelId))
    .slice(0, 5);
  return { level: "fuzzy", matched: undefined, alternatives: fuzzy.map((f) => ({ via: "fuzzy", id: f.modelId, entry: f })), evidence: { scope: "model", status: "unknown", origin: "fallback-preset", confidence: "low" } };
}
