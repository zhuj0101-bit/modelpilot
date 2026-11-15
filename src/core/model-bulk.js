// 工单 #25：主模型列表的批量删除 / 批量改字段。
//
// 与 model-selection.js 的区别：那里处理的是「拉取弹窗里按 id 勾选的新模型」，
// 这里处理的是主列表的「绝对下标」—— 搜索只影响显示，勾选记的始终是
// models 数组里的位置。因此三条硬约束都落在这个纯逻辑层：
//
// 1. 一次写入：每个计划只产出「一条 set 整数组」的 ops，绝不逐条 mutate；
// 2. 写前复核：调用方先用 sameIdSequence 比对最新快照的 id 序列，
//    下标失效时这里拒绝；
// 3. 不能全删光：选中数 === 模型总数时拒绝（空 models 会让宿主拒整条路由）。
//
// 批量改字段只覆盖 maxTokens / input / reasoningEfforts 三个白名单字段，
// 每行以现有行为基底展开，compat、contextWindow、name 与宿主未来字段都保留。

import { MODALITIES, PI_AI_LEVELS, canonicalJson, validatePiAiReasoningEfforts } from "./domain.js";

/**
 * 两份 id 序列逐项相同（长度 + 顺序 + 每个 id）。
 *
 * 只比长度不够：长度相同但顺序变了，同一个下标指向的已经是另一条模型。
 *
 * @param {(string|undefined)[]} current 当前渲染所用的 id 序列
 * @param {(string|undefined)[]} latest  最新快照的 id 序列
 */
export function sameIdSequence(current, latest) {
  const left = Array.isArray(current) ? current : [];
  const right = Array.isArray(latest) ? latest : [];
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** 选中集合 → 去重升序的合法下标；出现越界 / 非整数时返回 null。 */
function normalizeIndexes(selection, length) {
  const raw = selection instanceof Set ? [...selection] : Array.isArray(selection) ? [...selection] : [];
  const indexes = new Set();
  for (const value of raw) {
    if (!Number.isInteger(value) || value < 0 || value >= length) return null;
    indexes.add(value);
  }
  return [...indexes].sort((left, right) => left - right);
}

/** 正整数字面值 → number；其余返回 undefined。 */
function positiveInteger(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

/** 勾选的档位 → 规范顺序 → reasoningEfforts 字典（线上值默认 = 档位名）。 */
export function reasoningEffortsFromLevels(levels) {
  const selected = new Set(Array.isArray(levels) ? levels : []);
  const ordered = PI_AI_LEVELS.filter((level) => selected.has(level));
  if (ordered.length === 0) return undefined;
  const dict = { off: null };
  for (const level of ordered) {
    if (level !== "off") dict[level] = level;
  }
  return dict;
}

function modelOp(routeId, value) {
  return { op: "set", path: ["providers", routeId, "models"], value };
}

/** 第 index 行在确认文案里的名字；id 缺失时回落序号。 */
function displayIdAt(models, index) {
  return typeof models[index]?.id === "string" ? models[index].id : `第 ${index + 1} 个模型`;
}

/**
 * 批量删除确认框要用的选择摘要：条数、按绝对下标升序的 id，以及其中当前
 * 不可见的条数。
 *
 * visibleIndexes 是界面真正渲染出来的行（展开且命中搜索）；不在其中的选中
 * 行就是「用户看不见但会被删除」的行。选择里出现越界 / 非整数下标时按失效
 * 处理，返回空摘要，交给调用方原有的写前复核拒绝写入。
 *
 * @param {object[]} models
 * @param {Set<number>|number[]} selection
 * @param {number[]} visibleIndexes
 * @returns {{count:number, ids:string[], hiddenCount:number, hiddenIndexes:number[]}}
 */
export function summarizeBulkSelection(models, selection, visibleIndexes) {
  const list = Array.isArray(models) ? models : [];
  const indexes = normalizeIndexes(selection, list.length) ?? [];
  const visible = new Set(
    (Array.isArray(visibleIndexes) ? visibleIndexes : []).filter(
      (value) => Number.isInteger(value) && value >= 0 && value < list.length,
    ),
  );
  const hiddenIndexes = indexes.filter((index) => !visible.has(index));
  return {
    count: indexes.length,
    ids: indexes.map((index) => displayIdAt(list, index)),
    hiddenCount: hiddenIndexes.length,
    hiddenIndexes,
  };
}

/**
 * 批量删除：删掉选中的绝对下标，其余模型原样保留顺序。
 *
 * @param {object[]} models
 * @param {Set<number>|number[]} selection
 * @param {string} routeId
 * @returns {{status:string, ops:object[], removed:string[], message?:string}}
 */
export function planBulkDelete(models, selection, routeId) {
  const list = Array.isArray(models) ? models : [];
  const indexes = normalizeIndexes(selection, list.length);
  if (indexes === null) {
    return { status: "stale", ops: [], removed: [], message: "选中的模型下标已失效，请重新核对当前配置" };
  }
  if (indexes.length === 0) {
    return { status: "empty", ops: [], removed: [], message: "没有选中任何模型" };
  }
  if (indexes.length >= list.length) {
    return { status: "refuse-all", ops: [], removed: [], message: "不能删除全部模型；至少保留一条" };
  }
  const selected = new Set(indexes);
  const next = list.filter((_, index) => !selected.has(index));
  return {
    status: "ok",
    ops: [modelOp(routeId, next)],
    removed: indexes.map((index) => displayIdAt(list, index)),
  };
}

/**
 * 批量改字段：给选中的模型设同一个 maxTokens / input / reasoningLevels。
 *
 * patch 里只有出现过的字段才会被写入；三个字段可以任意组合，但仍然只产出
 * 一条 set 整数组的 op。没有实际变化时返回 no-change，不写盘。
 *
 * @param {object[]} models
 * @param {Set<number>|number[]} selection
 * @param {{maxTokens?:number|string, input?:string[], reasoningLevels?:string[]}} patch
 * @param {string} routeId
 * @returns {{status:string, ops:object[], changed:{index:number,id:string}[], message?:string}}
 */
export function planBulkFields(models, selection, patch, routeId) {
  const list = Array.isArray(models) ? models : [];
  const indexes = normalizeIndexes(selection, list.length);
  if (indexes === null) {
    return { status: "stale", ops: [], changed: [], message: "选中的模型下标已失效，请重新核对当前配置" };
  }
  if (indexes.length === 0) {
    return { status: "empty", ops: [], changed: [], message: "没有选中任何模型" };
  }

  const source = patch !== null && typeof patch === "object" ? patch : {};
  const has = (key) => Object.hasOwn(source, key) && source[key] !== undefined;
  if (!has("maxTokens") && !has("input") && !has("reasoningLevels")) {
    return { status: "invalid", ops: [], changed: [], message: "没有要修改的字段；请至少勾选一项" };
  }

  let maxTokens;
  if (has("maxTokens")) {
    maxTokens = positiveInteger(source.maxTokens);
    if (maxTokens === undefined) {
      return { status: "invalid", ops: [], changed: [], message: "输出上限必须是正整数" };
    }
  }

  let input;
  if (has("input")) {
    const candidates = Array.isArray(source.input) ? source.input : [];
    if (candidates.length === 0) {
      return { status: "invalid", ops: [], changed: [], message: "输入模态至少选一项" };
    }
    if (!candidates.every((modality) => MODALITIES.includes(modality))) {
      return { status: "invalid", ops: [], changed: [], message: "输入模态只能是 text 或 image" };
    }
    const selected = new Set(candidates);
    input = MODALITIES.filter((modality) => selected.has(modality));
  }

  let efforts;
  if (has("reasoningLevels")) {
    const levels = Array.isArray(source.reasoningLevels) ? source.reasoningLevels : [];
    if (levels.length === 0) {
      return { status: "invalid", ops: [], changed: [], message: "推理档位至少选一项；不写该字段请取消勾选" };
    }
    if (!levels.every((level) => PI_AI_LEVELS.includes(level))) {
      return { status: "invalid", ops: [], changed: [], message: "推理档位里包含未知档位" };
    }
    efforts = reasoningEffortsFromLevels(levels);
    const refusal = validatePiAiReasoningEfforts(efforts);
    if (refusal !== null) {
      return { status: "invalid", ops: [], changed: [], message: refusal.message, code: refusal.code };
    }
  }

  let changed = false;
  // 工单 #34：选中判断走 Set.has；indexes 最坏等于 list.length，线性扫描会
  // 变成 O(n×m)，而 bulkLivePlan 每次渲染都会重算。输出顺序仍由 indexes
  // （已去重升序）决定，未选中项保持同一引用。
  const selected = new Set(indexes);
  const next = list.map((model, index) => {
    if (!selected.has(index)) return model;
    const row = { ...model };
    if (maxTokens !== undefined) row.maxTokens = maxTokens;
    if (input !== undefined) row.input = [...input];
    if (efforts !== undefined) row.reasoningEfforts = { ...efforts };
    if (canonicalJson(row) !== canonicalJson(model)) changed = true;
    return row;
  });

  if (!changed) {
    return { status: "no-change", ops: [], changed: [], message: "选中模型已经是这些值，没有需要写入的改动" };
  }

  return {
    status: "ok",
    ops: [modelOp(routeId, next)],
    changed: indexes.map((index) => ({
      index,
      id: typeof list[index]?.id === "string" ? list[index].id : `第 ${index + 1} 个模型`,
    })),
  };
}
