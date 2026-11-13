// P1-02：CandidateEngine —— 字段级候选合成（B3 §4，八级优先序）。
// 纯函数；已改动 / 已锁定的字段直接短路；冲突项并列保留。

import { PI_AI_LEVELS, MODALITIES } from "./domain.js";

/**
 * 为一个模型草稿合成逐字段候选。
 * @param {object} input
 *   profile:    形如 ModelProfileV2 的 StoredField 映射（可能为 undefined）
 *   resolved:   已解析的身份条目（命中路由 / 目录）—— 可能为 undefined
 *   template:   用户选定的模板值 —— 可能为 undefined
 *   preset:     三个预设之一（basic / coding / long）—— 可能为 undefined
 *   touched:    用户改过的字段 id 集合
 *   locked:     被用户锁定的字段 id 集合
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
    // cleared = 明确的「以后永不自动填充」（a.md §3.B / B2 StoredField）：
    // 整条链都会被跳过，而不只是跳过已存储的那一环。重新启用属于用户动作
    // （解锁 / 清除重置），绝不会因为目录数据迟到而自动恢复。
    if (noAutofill) return { fieldId, candidate: undefined, shortCircuited: false, noAutofill: true };
    for (const link of chain) {
      if (link === undefined || link === null) continue;
      if (link.value === undefined) continue;
      if (link.gate && !link.gate(link.value)) continue;
      return { fieldId, candidate: link, shortCircuited: false };
    }
    return { fieldId, candidate: undefined, shortCircuited: false };
  };

  // StoredField 三态：cleared → 整条链都不自动填充；
  // inherit → 没有显式值（继续往下走）；
  // value → 存储值就是最高优先级候选。
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
    // Models.dev 声明的输出上限是能力事实，不是用户预算 ——
    // 它只作为证据出现（B4 三值展示），永远不当成预算。
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
    // 目录声明的推理：把 models.dev 的 controls 转成档位策略（effort policy）
    resolved?.reasoningControls?.length ? { value: reasoningPolicyFromControls(resolved.reasoningControls), origin: "route-metadata", evidence: { scope: "model", status: "declared", source: "catalog" }, confidence: "medium", via: "catalog-reasoning" } : undefined,
    template?.reasoning ? { value: template.reasoning, origin: "protocol-template", evidence: { scope: "model", status: "unknown", source: "template" }, confidence: "low", via: "template" } : undefined,
    { value: { mode: "inherit" }, origin: "fallback-preset", evidence: { scope: "model", status: "unknown", source: "default" }, confidence: "low", via: "default-inherit" },
  ], { noAutofill: reasoningStored.cleared });

  return { fields, shortCircuited: Object.values(fields).filter((f) => f.shortCircuited).map((f) => f.fieldId) };
}

/** models.dev controls → ReasoningPolicy [B3 §2 映射；档位值保持原样]。 */
export function reasoningPolicyFromControls(controls) {
  const effort = controls.find((c) => c.kind === "effort");
  if (effort) {
    const defaultLevel = effort.values.find((v) => PI_AI_LEVELS.includes(v) && v !== "off") ?? effort.values[0];
    return { mode: "effort", defaultLevel, wireProfileId: "pi-ai-catalog", allowedLevels: effort.values };
  }
  if (controls.some((c) => c.kind === "toggle")) return { mode: "disabled", wireProfileId: "pi-ai-toggle" };
  return { mode: "inherit" };
}
