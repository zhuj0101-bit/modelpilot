// P1-03：HostProjectionAdapter —— pi-ai 投影（B2 §4；DESIGN-v2 §6 J1/J2）。
// 纯函数：(用户档案草稿 + hostState) → ProjectionResult。
// 拒绝时产出 ops:[] + unsupportedControls —— 绝不抛异常 [B2 §3]。

import { canonicalJson, validatePiAiReasoningEfforts, PI_AI_LEVELS, MODALITIES } from "./domain.js";

export const WHITELIST = Object.freeze(["name", "contextWindow", "maxTokens", "input", "reasoningEfforts"]);

/**
 * @param {object} draft - 已选定的值 {id, name?, contextWindow?, maxTokens?, input?, reasoning?}
 *   reasoning = ReasoningPolicy。
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

  // 互斥 [audit 02-S3：resolveRouteModels 同时提供两种通道会拒绝]
  if (Object.keys(overrides).length > 0 && (append || models !== undefined)) {
    result.warnings.push({ code: "models-overrides-exclusive", message: `路由 "${routeId}" 已在用 modelOverrides；写 models 数组会被宿主拒绝` });
    result.unsupportedControls.push({ control: "models-channel", reason: "overrides-channel-conflict" });
    return result;
  }

  // 重复 id 守卫（宿主会拒绝；我们提前拒绝并给出定位信息）
  const existingIndex = (models ?? []).findIndex((m) => m?.id === draft.id);
  const caseFold = (models ?? []).findIndex((m) => typeof m?.id === "string" && m.id !== draft.id && m.id.toLowerCase() === draft.id.toLowerCase());
  if (existingIndex >= 0) {
    result.warnings.push({ code: "duplicate-model-id", message: `模型 "${draft.id}" 已存在于 models.${existingIndex}` });
    result.unsupportedControls.push({ control: "append", reason: "duplicate-model-id" });
    return result;
  }
  if (caseFold >= 0) {
    result.warnings.push({ code: "duplicate-model-id-casefold", message: `"${draft.id}" 与 models.${caseFold}（"${models[caseFold].id}"）仅大小写不同` });
  }

  // 目录替换告警（P1-1 门禁；未确认前不下发 ops）
  if (models === undefined && hasCatalog && draft.id !== undefined) {
    const catalogIds = hostState.catalogModels instanceof Set ? [...hostState.catalogModels] : hostState.catalogModels;
    result.warnings.push({
      code: "catalog-replacement",
      message: `向目录路由 "${routeId}" 写入 models 会整体替换它当前提供的目录`,
      removedCatalogIds: catalogIds ?? [],
      requiresAck: true,
    });
    // 暂不下发 ops：调用方需带 {ackedReplacement: true} 重新调用
    if (!arguments[2]?.ackedReplacement) return result;
  }

  // 推理投影：策略 → reasoningEfforts 字典，并做 R1–R7 预检
  let reasoningEfforts;
  if (draft.reasoning !== undefined && draft.reasoning.mode !== "inherit") {
    if (draft.reasoning.mode === "disabled") {
      reasoningEfforts = false; // pi-ai：false 表示声明为非推理模型
    } else if (draft.reasoning.mode === "effort") {
      const dict = {};
      dict.off = null; // off:null = 省略该参数（audit 02-S3）
      for (const level of draft.reasoning.levels ?? [draft.reasoning.defaultLevel].filter(Boolean)) {
        if (!PI_AI_LEVELS.includes(level)) {
          result.unsupportedControls.push({ control: `reasoningEfforts.${level}`, reason: "unknown-thinking-level" });
          continue;
        }
        if (level === "off") continue;
        dict[level] = draft.reasoning.wireMap?.[level] ?? level; // 线上拼写默认就是档位 id
      }
      reasoningEfforts = dict;
    } else if (draft.reasoning.mode === "budget") {
      result.profileOnlyFields.push("reasoningBudget");
      reasoningEfforts = undefined; // budget 没有逐模型槽位；字典保持原样
    }
    if (reasoningEfforts !== undefined && reasoningEfforts !== false) {
      const refusal = validatePiAiReasoningEfforts(reasoningEfforts);
      if (refusal) {
        // 一个坏字典会让宿主上整条路由的解析失败 ——
        // 因此整体拒绝（B2 §4.2：推理拒绝会丢弃全部 ops）。
        result.unsupportedControls.push({ control: "reasoningEfforts", reason: refusal.code, message: refusal.message });
        result.settingsOps = [];
        result.appliedFields = [];
        return result;
      }
    }
  }

  // 只按白名单拼这一行；未知键会被丢弃并留下告警
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
    if (!WHITELIST.includes(key)) result.warnings.push({ code: "unknown-key-dropped", message: `draft.${key} 不在 pi-ai 白名单内；宿主会丢弃它` });
  }

  // 下发 ops：整行追加，或在定位到的下标上逐字段设置
  if (existingIndex >= 0) {
    // 不可达（重复项已在上面拒绝）—— 保留以便阅读
  }
  if (models === undefined) {
    // 路由没有 models 数组：这次写入会创建它，并把我们的行放在 0 号位
    // （手工声明的路由：没有目录可丢 → 不触发替换告警）。
    result.settingsOps.push({ op: "set", path: ["providers", routeId, "models", "0"], value: row });
  } else if (models.length === 0) {
    result.settingsOps.push({ op: "set", path: ["providers", routeId, "models", "0"], value: row });
  } else if (append) {
    result.settingsOps.push({ op: "set", path: ["providers", routeId, "models", String(models.length)], value: row });
  }
  result.appliedFields.push("id", ...valueFields);

  // 解析出的事实标注为「仅输入」时，给出 contextWindow 语义告警
  if (draft.contextSemantics === "input") {
    result.warnings.push({ code: "context-input-semantics", message: "声明的上下文仅指输入；DSH 把 contextWindow 当作输入加输出合计" });
  }
  // maxTokens 双重身份提示（B4 三值展示义务）
  if (row.maxTokens !== undefined) {
    result.warnings.push({ code: "max-tokens-dual-identity", message: "调用未指定 maxTokens 时，maxTokens 同时充当默认请求输出预算" });
  }
  return result;
}
