// 工单 #26 一期：编辑 / 删除模型的纯逻辑。
//
// 表单值与现有行之间的比较放在这里，组件只负责把结果接到 React 状态上。
// 关键约束：只产出真正变化的字段；未变化的字段一个都不写，这样
// projectPiAi 的合并式写入才能保住 compat 与宿主未来新增的字段。

import { MODALITIES, PI_AI_LEVELS } from "./domain.js";
import { sameWireMap, wireMapFromApiValues, wireMapFromEfforts } from "./reasoning-wire.js";

/**
 * token 字段输入的三种判定结果（工单 #38 问题 3）。
 *
 * 输入层（changeEditToken / changeTokenCount）与逻辑层（diffRow）必须调用
 * 同一个判定函数：空串合法（= 删除该字段），正整数合法，其余一律非法。
 * 绝不允许「输入层说合法、逻辑层当没看见」。
 */
export const TOKEN_INPUT = Object.freeze({
  EMPTY: "empty",
  VALID: "valid",
  INVALID: "invalid",
});

/**
 * token 字段输入 → 判定结果。
 *
 * - 空串 / 纯空白 / undefined / null：{ status: "empty" }，语义是「删除该字段」；
 * - 十进制正整数：{ status: "valid", value }，前导零按数值归一（"007" → 7，
 *   与既有输入层行为一致，明确固定为期望行为）；
 * - 0 / 负数 / 小数 / 指数 / 非数字 / 超出安全整数范围：{ status: "invalid" }。
 *
 * 超长数字（超过 Number.MAX_SAFE_INTEGER）不再是宿主能可靠表示的整数，
 * 因此按非法输入拒绝，而不是静默写成一个失真的 number。
 *
 * @param {unknown} text 输入框字符串或现有行里的值
 * @returns {{status: "empty"|"valid"|"invalid", value?: number, code?: string}}
 */
export function classifyTokenInput(text) {
  if (typeof text === "number") {
    if (!Number.isSafeInteger(text) || text <= 0) {
      return { status: TOKEN_INPUT.INVALID, code: "token-invalid" };
    }
    return { status: TOKEN_INPUT.VALID, value: text };
  }
  if (text === undefined || text === null) return { status: TOKEN_INPUT.EMPTY };
  const raw = String(text).trim();
  if (raw === "") return { status: TOKEN_INPUT.EMPTY };
  if (!/^\d+$/.test(raw)) return { status: TOKEN_INPUT.INVALID, code: "token-invalid" };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { status: TOKEN_INPUT.INVALID, code: "token-invalid" };
  }
  return { status: TOKEN_INPUT.VALID, value };
}

/** 现有行的 token 值 → 表单字符串；缺失 / 非法时保持空串。 */
function tokenFormValue(value) {
  const state = classifyTokenInput(value);
  return state.status === TOKEN_INPUT.VALID ? String(state.value) : "";
}

/** 编辑表单的输入模态校验错误码与文案（工单 #38 问题 2，方案 A）。 */
export const EDIT_FORM_ERRORS = Object.freeze({
  INPUT_EMPTY: Object.freeze({
    code: "input-empty",
    field: "input",
    message: "至少保留一个输入模态（宿主会拒绝空 input）",
  }),
});

/**
 * 编辑表单的纯逻辑校验（工单 #38 问题 2，方案 A：不允许取消全部输入模态）。
 *
 * 只有「现有行确实声明了非空 input，而表单把两个模态都取消」才报错 ——
 * 那是一次清空尝试，宿主会拒绝空 input。现有行本来就没有 input（或声明了
 * 空数组）时，两个框都空着表示「不改这个字段」，不能误伤其他字段的编辑。
 *
 * @param {ReturnType<typeof formFromModel>} form
 * @param {object|undefined} existing 当前下标上的现有行
 * @returns {{code: string, field: string, message: string}|null}
 */
export function validateEditForm(form, existing) {
  const inputText = form?.inputText === true;
  const inputImage = form?.inputImage === true;
  const existingInput = Array.isArray(existing?.input)
    ? existing.input.filter((modality) => MODALITIES.includes(modality))
    : [];
  if (!inputText && !inputImage && existingInput.length > 0) {
    return EDIT_FORM_ERRORS.INPUT_EMPTY;
  }
  return null;
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
 * 返回的片段除删除标记外直接满足 projectPiAi 的 draft 形状：
 * - name / contextWindow / maxTokens / input 是白名单字段；
 * - reasoning 是 ReasoningPolicy；projectPiAi 会把它投影成 reasoningEfforts 字典。
 *
 * 保留现有 reasoningEfforts 的线上值映射：用户只增删档位时，已有档位的
 * 自定义 wire 值不会因为重新生成字典而丢失。wireMap 只包含当前勾选的非 off
 * 档位；没勾的档位、留空的值、与档位名相同的值都不写入。
 *
 * 只改 API 参数值而不改档位集合也算改动 —— 否则用户改了值，保存按钮还是灰的。
 *
 * 工单 #38：token 字段支持清空。表单为空串且现有行有合法值时，返回该字段
 * 为 null —— 这是一个明确的「删除该键」标记，由调用方走整数组 set 写入；
 * 现有行本来就没有值时不产生任何变化，绝不写多余的 unset。
 *
 * @param {ReturnType<typeof formFromModel>} form
 * @param {object|undefined} existing 当前下标上的现有行
 * @returns {object} 变化字段组成的 draft 片段；值为 null 表示删除该字段
 */
export function diffRow(form, existing) {
  const changed = {};

  const currentName = typeof existing?.name === "string" ? existing.name : "";
  const nextName = typeof form?.name === "string" ? form.name.trim() : "";
  if (nextName !== currentName) changed.name = nextName;

  for (const field of ["contextWindow", "maxTokens"]) {
    const next = classifyTokenInput(form?.[field]);
    const current = classifyTokenInput(existing?.[field]);
    if (next.status === TOKEN_INPUT.INVALID) continue;
    if (next.status === TOKEN_INPUT.EMPTY) {
      if (current.status === TOKEN_INPUT.VALID) changed[field] = null;
      continue;
    }
    if (current.status !== TOKEN_INPUT.VALID || current.value !== next.value) {
      changed[field] = next.value;
    }
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

/**
 * 把 diffRow 的结果拆成「要写入的值」与「要删除的键」。
 *
 * diffRow 用 null 表示删除字段；投影 draft 不能携带 null（会被当成非法值），
 * 因此界面先把 null 拆出来，作为 update 模式的 unset 清单传入。
 *
 * @param {ReturnType<typeof diffRow>} diff
 * @returns {{values: object, unset: string[]}}
 */
export function splitEditDiff(diff) {
  const values = {};
  const unset = [];
  for (const [key, value] of Object.entries(diff ?? {})) {
    if (value === null) unset.push(key);
    else values[key] = value;
  }
  return { values, unset };
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
