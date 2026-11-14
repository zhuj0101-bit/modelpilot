// P1-03：HostProjectionAdapter —— pi-ai 投影（B2 §4；DESIGN-v2 §6 J1/J2）。
// 纯函数：(用户档案草稿 + hostState) → ProjectionResult。
// 拒绝时产出 ops:[] + unsupportedControls —— 绝不抛异常 [B2 §3]。
//
// 工单 #26 一期新增 mode：
// - create（默认）：现有行为，追加新行；必须逐字节不变。
// - update：编辑第 index 行。以现有行为基底，只覆盖草稿里真正变化的字段，
//   从而原样保留 compat 与宿主未来新增的字段。
// - remove：删除第 index 行。用一条 set 重写整个 models 数组，绝不用 unset
//   在数组里打洞（宿主 schema 是 z.array(modelProfile)，null 会校验失败）。

import { canonicalJson, validatePiAiReasoningEfforts, PI_AI_LEVELS, MODALITIES } from "./domain.js";

export const WHITELIST = Object.freeze(["name", "contextWindow", "maxTokens", "input", "reasoningEfforts"]);

const MODES = Object.freeze(["create", "update", "remove"]);

/** 拒绝写入的 stale-index 结果：告警 + 不可写控件，绝不抛异常。 */
function staleIndex(result, routeId, index, detail) {
  result.warnings.push({
    code: "stale-index",
    message: `路由 "${routeId}" 的模型下标 ${index} 已失效${detail === undefined ? "" : `（${detail}）`}；配置可能已被别处修改，请重新读取后重试`,
  });
  result.unsupportedControls.push({ control: "index", reason: "stale-index" });
}

/**
 * @param {object} draft - 已选定的值 {id, name?, contextWindow?, maxTokens?, input?, reasoning?}
 *   reasoning = ReasoningPolicy。
 * @param {object} hostState - {providers: {<routeId>: {models?: [...], modelOverrides?: {...}}}, catalogModels?: Set}
 * @param {object} opts {routeId, mode: "create"|"update"|"remove", index, append?, ackedReplacement?}
 * @returns ProjectionResult {settingsOps, appliedFields, profileOnlyFields, unsupportedControls, warnings, previewFidelity}
 */
export function projectPiAi(draft, hostState, { routeId, mode = "create", index, append = true, ackedReplacement = false } = {}) {
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
  const isCreate = mode === "create";

  if (!MODES.includes(mode)) {
    result.warnings.push({ code: "unknown-mode", message: `未知的投影模式 "${mode}"；只支持 create / update / remove` });
    result.unsupportedControls.push({ control: "mode", reason: "unknown-mode" });
    return result;
  }

  // 互斥 [audit 02-S3：resolveRouteModels 同时提供两种通道会拒绝]
  if (Object.keys(overrides).length > 0 && ((isCreate && append) || models !== undefined)) {
    result.warnings.push({ code: "models-overrides-exclusive", message: `路由 "${routeId}" 已在用 modelOverrides；写 models 数组会被宿主拒绝` });
    result.unsupportedControls.push({ control: "models-channel", reason: "overrides-channel-conflict" });
    return result;
  }

  // update / remove 先校验下标。update 还要求该下标的 id 与草稿一致：
  // 编辑期间配置若被别处改动（插入 / 删除 / 重排），绝不允许写错行。
  if (mode === "update") {
    const target = models !== undefined && Number.isInteger(index) && index >= 0 ? models[index] : undefined;
    if (target === undefined || target?.id !== draft?.id) {
      const detail = target === undefined
        ? "该下标不存在"
        : `当前该位置是 "${String(target?.id)}"，不是 "${String(draft?.id)}"`;
      staleIndex(result, routeId, index, detail);
      return result;
    }
  }
  if (mode === "remove") {
    const target = models !== undefined && Number.isInteger(index) && index >= 0 ? models[index] : undefined;
    if (target === undefined) {
      staleIndex(result, routeId, index, "该下标不存在");
      return result;
    }
    // 删除必须重写整个数组：逐下标 unset 会在数组里留下空洞，宿主校验会炸。
    const next = models.filter((_, current) => current !== index);
    result.settingsOps.push({ op: "set", path: ["providers", routeId, "models"], value: next });
    result.appliedFields.push("models");
    return result;
  }

  // 重复 id 守卫（宿主会拒绝；我们提前拒绝并给出定位信息）。
  // update 的目标行本来就与 draft.id 相同，不能套用「追加」的重复拒绝。
  if (isCreate) {
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
  }

  // 目录替换告警（P1-1 门禁；未确认前不下发 ops）。只有 create 会新建数组。
  if (isCreate && models === undefined && hasCatalog && draft.id !== undefined) {
    const catalogIds = hostState.catalogModels instanceof Set ? [...hostState.catalogModels] : hostState.catalogModels;
    result.warnings.push({
      code: "catalog-replacement",
      message: `向目录路由 "${routeId}" 写入 models 会整体替换它当前提供的目录`,
      removedCatalogIds: catalogIds ?? [],
      requiresAck: true,
    });
    // 暂不下发 ops：调用方需带 {ackedReplacement: true} 重新调用
    if (!ackedReplacement) return result;
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

  if (isCreate) {
    // 下发 ops：整行追加，或在定位到的下标上逐字段设置
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
  } else {
    // update：以现有行为基底，只覆盖草稿里真正变化的字段。
    const existing = models[index];
    const changed = {};
    for (const field of Object.keys(row)) {
      if (field === "id") continue;
      if (canonicalJson(row[field]) !== canonicalJson(existing?.[field])) changed[field] = row[field];
    }
    if (Object.keys(changed).length === 0) {
      result.warnings.push({ code: "no-change", message: "没有字段发生变化；未生成写入操作" });
      return result;
    }
    result.settingsOps.push({
      op: "set",
      path: ["providers", routeId, "models", String(index)],
      value: { ...existing, ...changed },
    });
    result.appliedFields.push("id", ...valueFields.filter((field) => Object.hasOwn(changed, field)));
  }

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
