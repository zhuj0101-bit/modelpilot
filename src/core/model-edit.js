// 工单 #26 一期：编辑 / 删除模型的纯逻辑。
//
// 表单值与现有行之间的比较放在这里，组件只负责把结果接到 React 状态上。
// 关键约束：只产出真正变化的字段；未变化的字段一个都不写，这样
// projectPiAi 的合并式写入才能保住 compat 与宿主未来新增的字段。

import { MODALITIES, PI_AI_LEVELS } from "./domain.js";
import { sameWireMap, wireMapFromApiValues, wireMapFromEfforts } from "./reasoning-wire.js";

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
 * reasoningEfforts === false 表示「非推理模型」，表单里没有档位，
 * reasoningDisabled 让界面连档位组与 API 参数值一起隐藏。
 *
 * reasoningApiValues 只预填「值与档位名不同」的条目：off 的 null、
 * 与档位名相同的值都留空，因为留空在语义上就等于「用档位名」。
 *
 * @param {object|undefined} model 现有 models 数组中的一行
 * @returns {{name:string, contextWindow:string, maxTokens:string,
 *            inputText:boolean, inputImage:boolean, reasoningLevels:string[],
 *            reasoningApiValues:Record<string,string>, reasoningDisabled:boolean}}
 */
export function formFromModel(model) {
  const input = Array.isArray(model?.input) ? model.input : [];
  const efforts = model?.reasoningEfforts;
  const isEffortsObject = efforts !== null && typeof efforts === "object" && !Array.isArray(efforts);
  const reasoningLevels = isEffortsObject
    ? PI_AI_LEVELS.filter((level) => Object.hasOwn(efforts, level))
    : [];
  return {
    name: typeof model?.name === "string" ? model.name : "",
    contextWindow: tokenFormValue(model?.contextWindow),
    maxTokens: tokenFormValue(model?.maxTokens),
    inputText: input.includes("text"),
    inputImage: input.includes("image"),
    reasoningLevels,
    reasoningApiValues: isEffortsObject ? wireMapFromEfforts(efforts) : {},
    reasoningDisabled: efforts === false,
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
 * 自定义 wire 值不会因为重新生成字典而丢失。wireMap 只包含当前勾选的非 off
 * 档位；没勾的档位、留空的值、与档位名相同的值都不写入。
 *
 * 只改 API 参数值而不改档位集合也算改动 —— 否则用户改了值，保存按钮还是灰的。
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
  const nextWire = wireMapFromApiValues(levels, form?.reasoningApiValues);
  const existingWire = wireMapFromEfforts(efforts);
  if (levels.length > 0 && (!sameArray(levels, existingLevels) || !sameWireMap(nextWire, existingWire))) {
    changed.reasoning = {
      mode: "effort",
      levels,
      ...(Object.keys(nextWire).length === 0 ? {} : { wireMap: nextWire }),
    };
  }

  return changed;
}

// ── 模型行摘要的来源标注（工单 #27）────────────────────────────────────
//
// 宿主的真实回落链是单向三级（llm-pi-ai resolveRouteModels）：
//   entry[field] ?? 内置目录[field] ?? request[default*]
// 也就是「模型自己 → 内置目录 → 路由级默认值」。模型行摘要必须把这个来源
// 说清楚：同样显示 1M，可能来自这一行、目录，或路由默认值。只写「未设置」
// 会让用户以为这一行什么都没配，而它其实正在用路由默认值。
//
// 内置目录描述了哪些模型 id 由宿主掌握，没有交给设置客户端（工单 #16 已
// 确认）。所以界面默认只区分三态：模型声明 / ↑ 路由默认 / 未设置 —— 拿不
// 到目录就不标「目录」，绝不假装知道。宿主将来提供目录接口时，把查询函数
// 作为 catalogValueOf 传进来即可接入 `·目录`，这是预留的可选扩展点。

/** 「来自路由默认值」的标记。 */
export const ROUTE_DEFAULT_MARK = "↑";
/** 「来自内置目录」的标记；只有传入 catalogValueOf 时才会出现。 */
export const CATALOG_MARK = "·目录";

const ROW_UNSET = "未设置";

/** 模型行摘要按这个顺序依次说明四个字段。 */
const ROW_FIELDS = Object.freeze([
  Object.freeze({ key: "contextWindow", label: "窗口", prefix: "窗口 ", routeField: "defaultContextWindow" }),
  Object.freeze({ key: "maxTokens", label: "输出", prefix: "输出 ", routeField: "defaultMaxTokens" }),
  Object.freeze({ key: "input", label: "模态", prefix: "", routeField: "defaultInput" }),
  Object.freeze({ key: "reasoningEfforts", label: "推理档位", prefix: "", routeField: null }),
]);

function isModelObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 模态数组 → 摘要里的模样；空数组 / 非数组都返回 ""（= 没有可显示的值）。 */
function modalitiesText(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(" / ") : "";
}

function tokenText(humanizeTokenCount, value) {
  return humanizeTokenCount(value) || "";
}

/**
 * 一个字段的值与来源。
 *
 * `source` 四种取值：model（模型声明）、catalog（内置目录）、route（路由
 * 默认值）、none（三处都没有）。title 是悬停时给用户看的回落链解释。
 *
 * @returns {{source: "model"|"catalog"|"route"|"none", text: string, title: string}}
 */
function resolveRowField(model, field, humanizeTokenCount, route, catalogValueOf) {
  if (field.key === "reasoningEfforts") {
    // 推理档位没有路由级默认值（工单 #27 2.3）：只可能是模型自己声明，
    // 缺失就是无档，绝不标 ↑ —— 硬标就是撒谎。
    const efforts = model.reasoningEfforts;
    if (efforts === false) {
      return { source: "model", text: "非推理", title: "模型声明非推理（reasoningEfforts: false）" };
    }
    if (isModelObject(efforts)) {
      const count = Object.keys(efforts).length;
      return { source: "model", text: `${count} 档`, title: `模型声明 ${count} 档` };
    }
    return { source: "none", text: "无档", title: "模型未声明（没有路由级默认值）" };
  }

  if (field.key === "input") {
    // 空数组是明确选择（一个模态都不开），算已声明：显示「未设置」但不标 ↑。
    if (Array.isArray(model.input)) {
      const own = modalitiesText(model.input);
      return own === ""
        ? { source: "model", text: ROW_UNSET, title: "模型声明空数组（一个模态都不开）" }
        : { source: "model", text: own, title: `模型声明 ${own}` };
    }
    const catalogValue = catalogValueOf?.(model, field.key);
    const catalogText = catalogValue === undefined || catalogValue === null ? "" : modalitiesText(catalogValue);
    if (catalogText !== "") {
      return { source: "catalog", text: `${catalogText}${CATALOG_MARK}`, title: `模型未声明 → 内置目录 ${catalogText}` };
    }
    // 路由的 defaultInput 是空数组时宿主会拒绝，空数组不构成有效默认值。
    const routeText = modalitiesText(route?.[field.routeField]);
    if (routeText !== "") {
      return { source: "route", text: `${routeText}${ROUTE_DEFAULT_MARK}`, title: `模型未声明 → 使用路由默认值 ${routeText}` };
    }
    return { source: "none", text: ROW_UNSET, title: "模型未声明 → 路由默认值未设置" };
  }

  const declared = model[field.key];
  if (declared !== undefined && declared !== null) {
    const own = tokenText(humanizeTokenCount, declared);
    return own === ""
      ? { source: "model", text: ROW_UNSET, title: "模型声明（值无法显示）" }
      : { source: "model", text: own, title: `模型声明 ${own}` };
  }
  const catalogValue = catalogValueOf?.(model, field.key);
  const catalogText = catalogValue === undefined || catalogValue === null ? "" : tokenText(humanizeTokenCount, catalogValue);
  if (catalogText !== "") {
    return { source: "catalog", text: `${catalogText}${CATALOG_MARK}`, title: `模型未声明 → 内置目录 ${catalogText}` };
  }
  const routeValue = route?.[field.routeField];
  const routeText = routeValue === undefined || routeValue === null ? "" : tokenText(humanizeTokenCount, routeValue);
  if (routeText !== "") {
    return { source: "route", text: `${routeText}${ROUTE_DEFAULT_MARK}`, title: `模型未声明 → 使用路由默认值 ${routeText}` };
  }
  return { source: "none", text: ROW_UNSET, title: "模型未声明 → 路由默认值未设置" };
}

/**
 * 模型行摘要 + 悬停解释：窗口 / 输出 / 模态 / 档位数，并逐个字段标出来源。
 *
 * 返回的 `text` 是列表那一行文案，`title` 是悬停时逐字段的回落链说明，
 * `sources` 是四个字段的机器可读来源（model / catalog / route / none）。
 *
 * route 缺失或不是对象时全部按「模型自己」判定：不抛错，也不会显示 ↑。
 * model 为 null / 非对象时返回一句「未设置」占位。
 *
 * @param {object|null|undefined} model 路由 models 数组里的一条模型条目
 * @param {(value: unknown) => string} humanizeTokenCount 现有的 token 千分位 / 缩写函数
 * @param {object|null|undefined} [route] 这条模型所属的路由（读取 default* 字段）
 * @param {(model: object, field: string) => unknown} [catalogValueOf] 可选扩展点：
 *   宿主将来提供「内置目录描述了什么」时，用它查询目录值；不传就绝不标「目录」
 * @returns {{text: string, title: string, sources: Record<string, "model"|"catalog"|"route"|"none">}}
 */
export function describeModelRowSource(model, humanizeTokenCount, route, catalogValueOf) {
  if (!isModelObject(model)) {
    return { text: ROW_UNSET, title: ROW_UNSET, sources: {} };
  }
  const humanize = typeof humanizeTokenCount === "function" ? humanizeTokenCount : () => "";
  const routeObject = isModelObject(route) ? route : undefined;
  const catalog = typeof catalogValueOf === "function" ? catalogValueOf : undefined;

  const parts = ROW_FIELDS.map((field) => ({
    ...field,
    ...resolveRowField(model, field, humanize, routeObject, catalog),
  }));
  const text = parts.map((part) => `${part.prefix}${part.text}`).join(" · ");
  return {
    text,
    title: parts.map((part) => `${part.label}：${part.title}`).join("\n"),
    sources: Object.fromEntries(parts.map((part) => [part.key, part.source])),
  };
}

/**
 * 模型行摘要：窗口 / 输出 / 模态 / 档位数，供列表的一行文案使用。
 * 只返回文案；需要悬停解释或来源时用 {@link describeModelRowSource}。
 */
export function describeModelRow(model, humanizeTokenCount, route) {
  return describeModelRowSource(model, humanizeTokenCount, route).text;
}
