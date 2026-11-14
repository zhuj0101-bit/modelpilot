// 工单 #26 一期：编辑 / 删除模型的纯逻辑。
//
// 表单值与现有行之间的比较放在这里，组件只负责把结果接到 React 状态上。
// 关键约束：只产出真正变化的字段；未变化的字段一个都不写，这样
// projectPiAi 的合并式写入才能保住 compat 与宿主未来新增的字段。

import { MODALITIES, PI_AI_LEVELS } from "./domain.js";

/** 正整数字符串 → number；空串 / 非数字 / <= 0 返回 undefined。 */
function positiveNumber(text) {
  if (typeof text === "number") {
    return Number.isFinite(text) && text > 0 ? text : undefined;
  }
  if (typeof text !== "string" || text.trim() === "") return undefined;
  if (!/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 现有行的 token 值 → 表单字符串；缺失时保持空串。 */
function tokenFormValue(value) {
  return Number.isFinite(value) && value > 0 ? String(value) : "";
}

/**
 * 现有模型行 → 编辑表单初值。
 *
 * 字段全量预填（不是模板值）；缺失字段显示为空 / 未勾选。
 * reasoningEfforts === false 表示「非推理模型」，表单里没有档位。
 *
 * @param {object|undefined} model 现有 models 数组中的一行
 * @returns {{name:string, contextWindow:string, maxTokens:string,
 *            inputText:boolean, inputImage:boolean, reasoningLevels:string[]}}
 */
export function formFromModel(model) {
  const input = Array.isArray(model?.input) ? model.input : [];
  const efforts = model?.reasoningEfforts;
  const reasoningLevels =
    efforts !== null && typeof efforts === "object" && !Array.isArray(efforts)
      ? PI_AI_LEVELS.filter((level) => Object.hasOwn(efforts, level))
      : [];
  return {
    name: typeof model?.name === "string" ? model.name : "",
    contextWindow: tokenFormValue(model?.contextWindow),
    maxTokens: tokenFormValue(model?.maxTokens),
    inputText: input.includes("text"),
    inputImage: input.includes("image"),
    reasoningLevels,
  };
}

/** 数组逐项相等（顺序敏感）；用于 input 与档位顺序。 */
function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * 对比表单值与现有行，只产出真正变化的字段。
 *
 * 返回的片段直接满足 projectPiAi 的 draft 形状：
 * - name / contextWindow / maxTokens / input 是白名单字段；
 * - reasoning 是 ReasoningPolicy；projectPiAi 会把它投影成 reasoningEfforts 字典。
 *
 * 保留现有 reasoningEfforts 的线上值映射：用户只增删档位时，已有档位的
 * 自定义 wire 值不会因为重新生成字典而丢失。
 *
 * 注意：一期只支持「修改」，不支持清空字段；空 token 输入不产生写入。
 *
 * @param {ReturnType<typeof formFromModel>} form
 * @param {object|undefined} existing 当前下标上的现有行
 * @returns {object} 变化字段组成的 draft 片段
 */
export function diffRow(form, existing) {
  const changed = {};

  const currentName = typeof existing?.name === "string" ? existing.name : "";
  const nextName = typeof form?.name === "string" ? form.name.trim() : "";
  if (nextName !== currentName) changed.name = nextName;

  const contextWindow = positiveNumber(form?.contextWindow);
  if (contextWindow !== undefined && contextWindow !== existing?.contextWindow) {
    changed.contextWindow = contextWindow;
  }

  const maxTokens = positiveNumber(form?.maxTokens);
  if (maxTokens !== undefined && maxTokens !== existing?.maxTokens) {
    changed.maxTokens = maxTokens;
  }

  const input = [];
  if (form?.inputText === true) input.push("text");
  if (form?.inputImage === true) input.push("image");
  const existingInput = Array.isArray(existing?.input)
    ? existing.input.filter((modality) => MODALITIES.includes(modality))
    : [];
  if (input.length > 0 && !sameArray(input, existingInput)) changed.input = input;

  const selected = new Set(Array.isArray(form?.reasoningLevels) ? form.reasoningLevels : []);
  const levels = PI_AI_LEVELS.filter((level) => selected.has(level));
  const efforts = existing?.reasoningEfforts;
  const existingLevels =
    efforts !== null && typeof efforts === "object" && !Array.isArray(efforts)
      ? PI_AI_LEVELS.filter((level) => Object.hasOwn(efforts, level))
      : [];
  if (levels.length > 0 && !sameArray(levels, existingLevels)) {
    const wireMap =
      efforts !== null && typeof efforts === "object" && !Array.isArray(efforts) ? efforts : undefined;
    changed.reasoning = { mode: "effort", levels, ...(wireMap === undefined ? {} : { wireMap }) };
  }

  return changed;
}

/** 模型行摘要：窗口 / 输出 / 模态 / 档位数，供列表的一行文案使用。 */
export function describeModelRow(model, humanizeTokenCount) {
  const token = (value) => humanizeTokenCount(value) || "未设置";
  const input = Array.isArray(model?.input) && model.input.length > 0 ? model.input.join(" / ") : "未设置";
  let levels;
  if (model?.reasoningEfforts === false) {
    levels = "非推理";
  } else if (model?.reasoningEfforts !== null && typeof model?.reasoningEfforts === "object" && !Array.isArray(model.reasoningEfforts)) {
    levels = `${Object.keys(model.reasoningEfforts).length} 档`;
  } else {
    levels = "无档";
  }
  return `窗口 ${token(model?.contextWindow)} · 输出 ${token(model?.maxTokens)} · ${input} · ${levels}`;
}
