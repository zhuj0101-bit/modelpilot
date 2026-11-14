// 工单 #22：拉取模型列表的纯逻辑层。
//
// 这里只做三件事：过滤、标注、把勾选结果投影成 settingsOps。
// 不碰 React、不碰 remote —— 组件只负责把结果接到界面上；
// 投影一律复用 pi-ai 引擎，白名单 / R1–R7 / 重复守卫 / 目录替换门禁
// 不在这里重新实现。

import { PI_AI_LEVELS } from "./domain.js";
import { projectPiAi } from "./pi-ai-projection.js";

/** 没有默认模板时的字段落点，等价于 templateToForm(null)。 */
export const BUILTIN_TEMPLATE = Object.freeze({
  contextWindow: "",
  maxTokens: "",
  inputText: true,
  inputImage: false,
  reasoningLevels: Object.freeze(["off", "low", "medium", "high"]),
});

/**
 * 大小写不敏感的子串过滤；空查询返回全部。
 * @param {string[]} ids
 * @param {string} query
 * @returns {string[]}
 */
export function filterModels(ids, query) {
  const list = Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (needle === "") return [...list];
  return list.filter((id) => id.toLowerCase().includes(needle));
}

/**
 * 给每个远端 id 标注它与该路由现有模型的关系。
 * @param {string[]} ids        远端返回的 id
 * @param {string[]} existing   该路由下已有的模型 id
 * @returns {{id:string, status:"new"|"exists"|"casefold", conflictWith?:string}[]}
 */
export function classifyModels(ids, existing) {
  const existingIds = (Array.isArray(existing) ? existing : []).filter((id) => typeof id === "string");
  const exact = new Set(existingIds);
  const folded = new Map();
  for (const id of existingIds) {
    const key = id.toLowerCase();
    if (!folded.has(key)) folded.set(key, id);
  }
  return (Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === "string")
    .map((id) => {
      if (exact.has(id)) return { id, status: "exists" };
      const conflict = folded.get(id.toLowerCase());
      if (conflict !== undefined) return { id, status: "casefold", conflictWith: conflict };
      return { id, status: "new" };
    });
}

/** 模板里的档位按 PI_AI_LEVELS 排序并去重。 */
function orderedLevels(levels) {
  const selected = new Set(Array.isArray(levels) ? levels : []);
  return PI_AI_LEVELS.filter((level) => selected.has(level));
}

/** 模板 → projectPiAi 需要的 draft；模板缺失时用内置默认值。 */
function draftFromTemplate(template, id) {
  const source = template && typeof template === "object" ? template : BUILTIN_TEMPLATE;
  // 显式写入 name：宿主回落链的中间一级是目录基准的 name，会抢在 id 前面。
  const draft = { id, name: id };

  const contextWindow = Number(source.contextWindow);
  if (typeof source.contextWindow === "string" && source.contextWindow.trim() !== "" && Number.isFinite(contextWindow) && contextWindow > 0) {
    draft.contextWindow = contextWindow;
  }
  const maxTokens = Number(source.maxTokens);
  if (typeof source.maxTokens === "string" && source.maxTokens.trim() !== "" && Number.isFinite(maxTokens) && maxTokens > 0) {
    draft.maxTokens = maxTokens;
  }

  const input = [];
  if (source.inputText === true) input.push("text");
  if (source.inputImage === true) input.push("image");
  if (input.length > 0) draft.input = input;

  const levels = orderedLevels(source.reasoningLevels);
  if (levels.length > 0) draft.reasoning = { mode: "effort", levels };
  return draft;
}

/** 同一个告警只保留一次（批量时 maxTokens 等提示会逐条重复）。 */
function mergeWarnings(target, seen, warnings) {
  for (const warning of warnings ?? []) {
    const key = `${warning.code}\u0000${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(warning);
  }
}

/**
 * 把选中的 id 批量投影成 settingsOps。
 *
 * 逐条调用 projectPiAi 并累积上一条写入后的 models 数组，
 * 因此第 2 条会写到 models.N+1，而不是又写 models.N。
 * 已存在 / 仅大小写不同的条目直接跳过，不进入投影。
 *
 * @param {string[]} selectedIds
 * @param {object} hostState   {providers, catalogModels}
 * @param {{routeId:string, template?:object|null, ackedReplacement?:boolean}} options
 * @returns {{ops:object[], written:string[], skipped:{id:string,reason:string,conflictWith?:string}[], warnings:object[]}}
 */
export function planBatchSelection(selectedIds, hostState, { routeId, template = null, ackedReplacement = false } = {}) {
  const result = { ops: [], written: [], skipped: [], warnings: [] };
  const providers = hostState?.providers ?? {};
  const route = providers?.[routeId];
  const models = Array.isArray(route?.models) ? route.models : undefined;
  const existing = (models ?? []).map((model) => model?.id).filter((id) => typeof id === "string");

  let simulated = models === undefined ? undefined : [...models];
  const seen = new Set();
  const warningKeys = new Set();

  for (const id of Array.isArray(selectedIds) ? selectedIds : []) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);

    const status = classifyModels([id], existing)[0];
    if (status.status === "exists") {
      result.skipped.push({ id, reason: "exists" });
      continue;
    }
    if (status.status === "casefold") {
      result.skipped.push({ id, reason: "casefold", conflictWith: status.conflictWith });
      continue;
    }

    const routeState = { ...(route ?? {}) };
    if (simulated !== undefined) routeState.models = simulated;
    else delete routeState.models;
    const projection = projectPiAi(
      draftFromTemplate(template, id),
      { ...(hostState ?? {}), providers: { ...providers, [routeId]: routeState } },
      { routeId, append: true, ackedReplacement },
    );
    mergeWarnings(result.warnings, warningKeys, projection.warnings);

    if (projection.unsupportedControls.length > 0 || projection.settingsOps.length === 0) {
      // 目录替换尚未确认时整批都写不了，不用再试后面的条目。
      if (projection.warnings.some((warning) => warning.code === "catalog-replacement")) break;
      continue;
    }

    for (const op of projection.settingsOps) result.ops.push(op);
    result.written.push(id);
    const row = projection.settingsOps.find((op) => op.op === "set")?.value;
    if (row !== undefined) simulated = [...(simulated ?? []), row];
  }

  return result;
}
