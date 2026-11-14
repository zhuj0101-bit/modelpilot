// 工单 #32 第一批：路由（provider）级字段编辑与删除路由的纯逻辑。
// 工单 #22（平替收口）：追加第 10 个路由字段 defaultInput（多选模态）。
//
// 与模型级写入的关键差异：一条路由里装着 models 数组、modelOverrides、compat
// 以及宿主未来新增的字段。重建整个 route 对象会瞬间覆盖别处（或宿主）
// 的改动，也会让并发编辑更容易冲突。因此这里只产出叶子路径：
//   set   ["providers", routeId, <field>]  ← 改过的字段
//   unset ["providers", routeId, <field>]  ← 清空的字段（回到宿主回落语义）
//   unset ["providers", routeId]           ← 删除整条路由（唯一允许的整条操作）
//
// 表单值统一用字符串表示：空串 = 该字段在目标文档里不存在。数字字段的
// 空串同样表示清空（unset），而不是写 0 —— profile schema 的 .default(…)
// 说明「回到回落」只能用 unset 表达。唯一的例外是 defaultInput：多选 chip
// 用字符串数组表示，空数组 = 全部不选 = unset（宿主拒绝 defaultInput: []）。

import { MODALITIES, humanizeTokenCount } from "./domain.js";

/** 十个可编辑字段；顺序同时决定 ops 与「改动字段」的展示顺序。 */
export const ROUTE_FIELD_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "displayName", label: "显示名", kind: "text" }),
  Object.freeze({ key: "baseURL", label: "接口地址", kind: "url" }),
  Object.freeze({ key: "api", label: "协议", kind: "select" }),
  Object.freeze({ key: "apiKeyEnv", label: "密钥引用", kind: "text" }),
  Object.freeze({ key: "defaultContextWindow", label: "默认上下文", kind: "integer" }),
  Object.freeze({ key: "defaultMaxTokens", label: "默认输出上限", kind: "integer" }),
  Object.freeze({ key: "cacheRetention", label: "缓存", kind: "select" }),
  Object.freeze({ key: "transport", label: "传输", kind: "select" }),
  Object.freeze({ key: "timeoutMs", label: "超时(ms)", kind: "integer" }),
  Object.freeze({ key: "defaultInput", label: "默认输入模态", kind: "modalities" }),
]);

export const ROUTE_FIELD_KEYS = Object.freeze(ROUTE_FIELD_DEFINITIONS.map((field) => field.key));

/** cacheRetention 的三个取值（宿主 schema：none / short / long）。 */
export const CACHE_RETENTION_CHOICES = Object.freeze(["none", "short", "long"]);

/** transport 的四个取值（宿主 schema）。 */
export const TRANSPORT_CHOICES = Object.freeze(["sse", "websocket", "websocket-cached", "auto"]);

/**
 * schema 读不到模态清单时的内置候选（当前宿主 MODALITIES 是 text / image）。
 * 与协议清单同一策略：schema 是唯一事实来源，读不到才用这份会过期的副本。
 */
export const FALLBACK_MODALITIES = Object.freeze([...MODALITIES]);

/** schema 读不到协议清单时的内置白名单（当前宿主支持的七种协议）。 */
export const FALLBACK_API_PROTOCOLS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "mistral-conversations",
  "bedrock-converse-stream",
]);

/** 与内置模型页相同的探针路由名：不会和任何真实路由冲突。 */
export const PROBE_ROUTE = "\u0000probe";

/** 表单校验文案。 */
export const ROUTE_ERRORS = Object.freeze({
  baseURL: "接口地址必须以 http:// 或 https:// 开头",
  integer: "请输入正整数",
  modality: "存在未知的输入模态",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 现有字符串字段 → 表单值；非字符串 / 空串都当作未声明。 */
function declaredText(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** 现有数字字段 → 表单值；0 / 负数 / 非数字都当作未声明。 */
function declaredInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isInteger(value)
    ? value
    : undefined;
}

/**
 * 模态多选值 → 稳定顺序的字符串数组。
 *
 * 顺序始终按候选清单（schema 给的顺序，读不到时用内置清单）排，不按用户点击
 * 顺序 —— 否则同样的配置会写出不同的数组，canonicalJson 比较时会误判为改动。
 * 候选清单之外的现有值（例如旧 schema 认识的未来模态）按原顺序追加在尾部：
 * 既不会被静默丢掉，也不会把未知值排到已知值前面。
 *
 * 非字符串 / 空白值直接丢弃；重复值只保留第一次出现。
 *
 * @param {unknown} values 表单值或路由上声明的值
 * @param {string[]|undefined} choices 候选清单（顺序即产出顺序）
 * @returns {string[]} 归一化后的模态数组；空数组表示「没有选择」
 */
export function normalizeModalities(values, choices = FALLBACK_MODALITIES) {
  const pool = (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const order = [];
  for (const choice of Array.isArray(choices) ? choices : FALLBACK_MODALITIES) {
    if (typeof choice !== "string") continue;
    const text = choice.trim();
    if (text !== "" && !order.includes(text)) order.push(text);
  }
  const wanted = new Set(pool);
  const result = [];
  for (const choice of order) {
    if (wanted.has(choice)) result.push(choice);
  }
  const seen = new Set(result);
  for (const value of pool) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * 现有路由 → 十个字段的表单初值。
 *
 * 只预填路由上真正声明过的值：未声明就留空，绝不把宿主 schema 的默认值
 * （例如 defaultContextWindow 的 1e6）当成用户设过的值。defaultInput 用
 * 数组表示：路由没声明就是空数组（全部 chip 不选）。
 *
 * @param {object|undefined} provider 当前 providers 里的那条路由
 * @returns {Record<string, string|string[]>} 十个字段的表单值
 */
export function routeFormFromProvider(provider) {
  const source = isPlainObject(provider) ? provider : {};
  const form = {};
  for (const field of ROUTE_FIELD_DEFINITIONS) {
    if (field.kind === "modalities") {
      form[field.key] = normalizeModalities(source[field.key]);
    } else if (field.kind === "integer") {
      const value = declaredInteger(source[field.key]);
      form[field.key] = value === undefined ? "" : String(value);
    } else {
      const value = declaredText(source[field.key]);
      form[field.key] = value === undefined ? "" : value;
    }
  }
  return form;
}

/** 字段 key → 中文标签；未知 key 原样返回，方便展示。 */
export function routeFieldLabel(key) {
  const field = ROUTE_FIELD_DEFINITIONS.find((candidate) => candidate.key === key);
  return field === undefined ? key : field.label;
}

/** 十个字段的中文标签列表（「改动字段」一行使用）。 */
export function routeFieldLabels(keys) {
  return keys.map(routeFieldLabel);
}

/**
 * 校验表单，返回 {field: message}；空对象表示全部合法。
 *
 * - baseURL：空 = 清空；非空必须以 http:// 或 https:// 开头
 * - 三个数字字段：空 = 清空；非空必须是正整数
 * - 文本 / 下拉字段不做额外校验（api 的合法值由宿主 schema 决定）
 * - defaultInput 的模态值另由 {@link validateModalityForm} 校验（需要候选清单）
 */
export function validateRouteForm(form) {
  const errors = {};
  for (const field of ROUTE_FIELD_DEFINITIONS) {
    if (field.kind === "modalities") continue;
    const raw = form?.[field.key];
    const text = raw === undefined || raw === null ? "" : String(raw).trim();
    if (text === "") continue;
    if (field.kind === "url" && !/^https?:\/\//i.test(text)) {
      errors[field.key] = ROUTE_ERRORS.baseURL;
      continue;
    }
    if (field.kind === "integer" && (!/^\d+$/.test(text) || Number(text) <= 0)) {
      errors[field.key] = ROUTE_ERRORS.integer;
    }
  }
  return errors;
}

/**
 * 校验输入模态都是宿主 schema 认识的取值。
 *
 * chip 只能选出候选清单里的值，所以这条校验是给程序化调用兜底的：真正会
 * 出现的未知值只有一种 —— 路由上早就声明过、但当前 schema 没读出来的未来
 * 模态（读失败时用的是内置清单）。这类值原样保留不算用户的新选择，故不报错；
 * 只有候选清单和路由现值都不认识的模态才拒绝，避免把宿主必拒的值写进去。
 *
 * @param {Record<string, unknown>} form 路由表单值
 * @param {object|undefined} provider 当前路由对象
 * @param {string[]|undefined} choices 候选清单
 * @returns {Record<string,string>} 空对象表示全部合法
 */
export function validateModalityForm(form, provider, choices = FALLBACK_MODALITIES) {
  const listed = Array.isArray(choices) && choices.length > 0 ? choices : FALLBACK_MODALITIES;
  const allowed = new Set(normalizeModalities(listed, listed));
  const declared = new Set(normalizeModalities(provider?.defaultInput, listed));
  const unknown = normalizeModalities(form?.defaultInput, listed)
    .filter((value) => !allowed.has(value) && !declared.has(value));
  return unknown.length === 0
    ? {}
    : { defaultInput: `${ROUTE_ERRORS.modality}：${unknown.join(" / ")}` };
}

/** 候选清单（schema 顺序）→ 去重后的字符串数组；空清单退回内置模态。 */
function modalityChoicesOf(options) {
  const listed = Array.isArray(options?.modalities) ? options.modalities : FALLBACK_MODALITIES;
  const choices = [];
  for (const value of listed) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text !== "" && !choices.includes(text)) choices.push(text);
  }
  return choices.length > 0 ? choices : [...FALLBACK_MODALITIES];
}

/**
 * 表单值 → 要写入的值；空串 = undefined（目标文档里不存在该字段）。
 * defaultInput：空数组（全部不选）= undefined → unset，绝不写 [] —— 宿主
 * 会在解析路由时以 “defaultInput must name at least one modality” 拒绝。
 */
function desiredValue(field, form, choices) {
  if (field.kind === "modalities") {
    const values = normalizeModalities(form?.[field.key], choices);
    return values.length === 0 ? undefined : values;
  }
  const raw = form?.[field.key];
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (text === "") return undefined;
  return field.kind === "integer" ? Number(text) : text;
}

/** 路由上当前声明的值（用于判断是否真的变化）；模态按同一规则归一化后比较。 */
function currentValue(field, provider, choices) {
  if (field.kind === "modalities") {
    return Array.isArray(provider?.[field.key])
      ? normalizeModalities(provider[field.key], choices)
      : undefined;
  }
  return field.kind === "integer"
    ? declaredInteger(provider?.[field.key])
    : declaredText(provider?.[field.key]);
}

/** 结构化相等：数组逐元素比较（不是引用比较），标量用 ===。 */
function sameFieldValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

/**
 * 生成路由级编辑操作。
 *
 * @param {string} routeId 路由 id（必须是 providers 的键）
 * @param {Record<string, string|string[]>} form 十个字段的表单值
 * @param {object|undefined} provider 当前路由对象；缺失即 stale-route
 * @param {{modalities?: string[]}} [options] 模态候选清单（顺序即写入顺序）；
 *   省略时用内置清单 —— 界面传入从 schema 现读的清单
 * @returns {{ops: object[], changed: string[], errors: Record<string,string>, warnings: object[]}}
 *   - 任一字段校验失败 → ops 为空（整体拒绝，避免半套写入）
 *   - 什么都没改 → ops 为空
 *   - 每个 op 的 path 都以 ["providers", routeId] 为前缀，且 set 只写叶子字段
 */
export function buildRouteEditOps(routeId, form, provider, options = {}) {
  const result = { ops: [], changed: [], errors: {}, warnings: [] };
  if (typeof routeId !== "string" || routeId === "" || !isPlainObject(provider)) {
    result.warnings.push({
      code: "stale-route",
      message: `stale-route：路由 "${String(routeId)}" 已不存在（可能已被别处删除）；请重新读取后重试`,
    });
    return result;
  }

  const choices = modalityChoicesOf(options);
  const errors = {
    ...validateRouteForm(form),
    ...validateModalityForm(form, provider, choices),
  };
  if (Object.keys(errors).length > 0) {
    result.errors = errors;
    return result;
  }

  for (const field of ROUTE_FIELD_DEFINITIONS) {
    const desired = desiredValue(field, form, choices);
    const current = currentValue(field, provider, choices);
    if (sameFieldValue(desired, current)) continue;
    if (desired === undefined) {
      result.ops.push({ op: "unset", path: ["providers", routeId, field.key] });
    } else {
      result.ops.push({ op: "set", path: ["providers", routeId, field.key], value: desired });
    }
    result.changed.push(field.key);
  }
  return result;
}

/**
 * 删除整条路由的操作。唯一允许的整条路径操作；其余情况返回告警 + 空 ops。
 *
 * 写入前必须用最新快照重新调用本函数：路由若已被别处删除（stale-route），
 * 或只剩一个路由（last-route），都拒绝写入。
 *
 * @param {string} routeId 要删除的路由 id
 * @param {object} providers 最新的 providers 映射
 * @returns {{ops: object[], warnings: object[]}}
 */
export function buildRouteDeleteOps(routeId, providers) {
  const result = { ops: [], warnings: [] };
  const map = isPlainObject(providers) ? providers : {};
  if (typeof routeId !== "string" || routeId === "" || !isPlainObject(map[routeId])) {
    result.warnings.push({
      code: "stale-route",
      message: `stale-route：路由 "${String(routeId)}" 已不存在（可能已被别处删除）；请重新读取后重试`,
    });
    return result;
  }
  if (Object.keys(map).length <= 1) {
    result.warnings.push({ code: "last-route", message: "至少要保留一个路由" });
    return result;
  }
  result.ops.push({ op: "unset", path: ["providers", routeId] });
  return result;
}

/**
 * 删除按钮的禁用理由；null 表示可以删除。
 * @param {number} routeCount 当前路由条数
 */
export function routeDeleteBlockReason(routeCount) {
  return Number.isFinite(routeCount) && routeCount > 1 ? null : "至少要保留一个路由";
}

// ── 模型排序（工单 #19） ────────────────────────────────────────────────
//
// 顺序是数组本身的属性，没有「第 i 位的顺序」这种叶子路径，所以排序只能
// 用一条 set 重写整个 models 数组 —— 与删除模型相同的写入形态，但只换
// 位置、不改内容：元素对象按引用原样搬走，compat / 宿主未来字段都跟着
// 对应模型走，不按位置留下。
//
// 返回新数组，绝不原地 splice：原地修改会污染 React state 与宿主快照，
// 失败回滚时也再没有「移动前」的数组可退回。

/** 排序被拒绝时的告警码。 */
export const MODEL_MOVE_WARNINGS = Object.freeze({
  noChange: "no-change",
  staleIndex: "stale-index",
  invalidModels: "invalid-models",
});

function moveWarning(code, message) {
  return { warning: { code, message } };
}

/**
 * 把第 from 位的模型移到 to 位，返回新数组（不修改原数组）。
 *
 * - `from === to` → no-change 告警，不产出 op；
 * - 越界 / 非整数 / models 不是数组 → stale-index（或 invalid-models）告警；
 * - 其余：产出恰好 1 条整数组 set，path 为 ["providers", routeId, "models"]。
 *
 * routeId 是 op 路径必需的一环（函数本身无从得知当前路由），因此作为第 4
 * 个参数传入；省略时只返回重排后的数组、不产出 op，方便调用方先看结果。
 *
 * @param {Array} models 现有 models 数组
 * @param {number} from 源下标
 * @param {number} to 目标下标
 * @param {string} [routeId] 当前路由 id；提供时产出整数组 set
 * @returns {{models: Array, ops: object[]}|{warning: object}}
 */
export function moveModel(models, from, to, routeId) {
  if (!Array.isArray(models)) {
    return moveWarning(
      MODEL_MOVE_WARNINGS.invalidModels,
      "invalid-models：当前路由没有可排序的 models 数组；请重新读取后重试",
    );
  }
  const length = models.length;
  const validIndex = (value) => Number.isInteger(value) && value >= 0 && value < length;
  if (!validIndex(from) || !validIndex(to)) {
    return moveWarning(
      MODEL_MOVE_WARNINGS.staleIndex,
      `stale-index：模型下标 ${String(from)} → ${String(to)} 已失效（当前 ${length} 条）；请重新读取后重试`,
    );
  }
  if (from === to) {
    return moveWarning(MODEL_MOVE_WARNINGS.noChange, `no-change：模型已经在第 ${from + 1} 位`);
  }

  const next = models.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const ops = typeof routeId === "string" && routeId !== ""
    ? [{ op: "set", path: ["providers", routeId, "models"], value: next }]
    : [];
  return { models: next, ops };
}

/** 折叠摘要：输出上限 / 上下文 / 模型数（未声明的值显示「未设置」）。 */
export function describeRouteSummary(provider) {
  const token = (value) => {
    const declared = declaredInteger(value);
    if (declared === undefined) return "未设置";
    return humanizeTokenCount(declared) || String(declared);
  };
  const models = Array.isArray(provider?.models) ? provider.models.length : 0;
  return `输出上限 ${token(provider?.defaultMaxTokens)} · 上下文 ${token(provider?.defaultContextWindow)} · ${models} 个模型`;
}

// ── 路由默认值与模型声明的关系（工单 #34） ─────────────────────────────
//
// 宿主的真实回落链是单向三级（llm-pi-ai resolveRouteModels）：
//   entry[field] ?? base?.[field] ?? request[default*]
// 也就是「模型自己 → 内置目录 → 路由级默认值」。这里只解释这条链，
// 不改写它的任何一环；目录给了值就是给了，不覆盖。

/** 路由默认值覆盖的字段：路由字段 → 模型条目字段 / 展示标签 / 值的形态。 */
export const ROUTE_DEFAULT_FIELDS = Object.freeze([
  Object.freeze({ key: "defaultContextWindow", modelField: "contextWindow", label: "默认上下文", kind: "token" }),
  Object.freeze({ key: "defaultMaxTokens", modelField: "maxTokens", label: "默认输出上限", kind: "token" }),
  Object.freeze({ key: "defaultInput", modelField: "input", label: "默认输入模态", kind: "modalities" }),
]);

/**
 * 路由默认值留空时宿主回落到的那两个内置常量（不是「不限制」）。
 * 对齐 llm-pi-ai 的 DEFAULT_CONTEXT_WINDOW / DEFAULT_MAX_TOKENS / DEFAULT_INPUT。
 */
export const HOST_ROUTE_DEFAULT_FALLBACKS = Object.freeze({
  defaultContextWindow: 1_000_000,
  defaultMaxTokens: 128_000,
  defaultInput: Object.freeze(["text"]),
});

function routeDefaultField(routeKey) {
  return ROUTE_DEFAULT_FIELDS.find((candidate) => candidate.key === routeKey);
}

/**
 * 该模型在某个 token 字段上是否会用到路由级默认值 —— 与宿主的单向三级
 * 回落逐环一致：模型自己声明了 → 不受影响；内置目录描述了这个模型 id →
 * 目录优先，也不受影响；两者都没有 → 才轮到路由级默认值。
 *
 * 两个字段必须分开判断：只声明了 `contextWindow` 的模型对窗口不受影响，
 * 但对输出上限仍然受路由默认值影响。
 *
 * @param {object} model 路由 models 数组里的一条模型条目
 * @param {Set<string>|Map<string,*>|undefined} catalogIds 宿主内置目录描述的模型 id
 * @param {"contextWindow"|"maxTokens"} modelField 要判断的模型字段（默认输出上限）
 * @returns {boolean} true 表示该字段最终会取路由级默认值
 */
export function usesRouteDefault(model, catalogIds, modelField = "maxTokens") {
  if (model === null || typeof model !== "object") return false;
  if (model[modelField] !== undefined) return false;
  if (typeof catalogIds?.has === "function" && catalogIds.has(model.id)) return false;
  return true;
}

/**
 * 该模型的输入模态是否会用到路由级 defaultInput。
 *
 * 宿主的回落链同样是三级：`declaredInput(entry.input) ?? base?.input ??
 * [...request.defaultInput]`，且 `declaredInput` 把空数组视为「没声明」以便
 * 回落到目录。但对用户而言 `input: []` 是明确选择（一个模态都不开），界面
 * 计数按「声明了空数组也算声明」处理 —— 与 maxTokens 的 `!== undefined` 一致。
 *
 * @param {object} model 路由 models 数组里的一条模型条目
 * @param {Set<string>|Map<string,*>|undefined} catalogIds 宿主内置目录描述的模型 id
 * @returns {boolean} true 表示该模型的输入模态最终取路由级 defaultInput
 */
export function usesRouteDefaultInput(model, catalogIds) {
  if (model === null || typeof model !== "object") return false;
  if (Array.isArray(model.input)) return false;
  if (typeof catalogIds?.has === "function" && catalogIds.has(model.id)) return false;
  return true;
}

/**
 * 按字段分别统计本路由有多少模型会用到路由级默认值。
 * 三个字段的受影响集合可能不同，绝不合并成一个「是否完全声明」。
 *
 * @param {object[]|undefined} models 路由的 models 数组
 * @param {Set<string>|Map<string,*>|undefined} catalogIds 宿主内置目录描述的模型 id
 * @returns {{total: number, contextWindow: {count: number, models: object[]}, maxTokens: {count: number, models: object[]}, input: {count: number, models: object[]}}}
 */
export function countRouteDefaultUsers(models, catalogIds) {
  const entries = Array.isArray(models) ? models : [];
  const result = {
    total: entries.length,
    contextWindow: { count: 0, models: [] },
    maxTokens: { count: 0, models: [] },
    input: { count: 0, models: [] },
  };
  for (const model of entries) {
    if (model === null || typeof model !== "object") continue;
    for (const modelField of ["contextWindow", "maxTokens"]) {
      if (!usesRouteDefault(model, catalogIds, modelField)) continue;
      result[modelField].count += 1;
      result[modelField].models.push(model);
    }
    if (!usesRouteDefaultInput(model, catalogIds)) continue;
    result.input.count += 1;
    result.input.models.push(model);
  }
  return result;
}

/**
 * 展开清单里的一行：写清这个模型未声明什么，以及另一个字段是否已声明。
 * @param {object} model 路由 models 数组里的一条模型条目
 * @returns {string} 如「未声明 contextWindow / maxTokens」
 */
export function describeRouteDefaultUsage(model) {
  const missingContext = model?.contextWindow === undefined;
  const missingMaxTokens = model?.maxTokens === undefined;
  if (missingContext && missingMaxTokens) return "未声明 contextWindow / maxTokens";
  if (missingContext) return "未声明 contextWindow（已声明 maxTokens）";
  if (missingMaxTokens) return "未声明 maxTokens（已声明 contextWindow）";
  return "已声明 contextWindow / maxTokens";
}

/**
 * 输入模态清单里的一行：写清这个模型的 input 是怎么来的。
 * @param {object} model 路由 models 数组里的一条模型条目
 * @returns {string} 如「未声明 input（路由默认值生效）」
 */
export function describeRouteDefaultInputUsage(model) {
  const declared = model?.input;
  if (!Array.isArray(declared)) return "未声明 input（路由默认值生效）";
  if (declared.length === 0) return "已声明 input（空数组：一个模态都不开）";
  return `已声明 input（${declared.join(" / ")}）`;
}

/**
 * 单个字段的计数文案，拆成「前缀 / 可点击的数量 / 后缀」三段 —— 界面把
 * 中间那段做成就地展开的按钮，纯文本调用方（测试、日志）用
 * {@link describeRouteDefaultCount} 拼回完整句子。
 *
 * 四种状态：全部受影响 / 部分受影响 / 全部不受影响 / 没有模型（null）。
 * token 字段说「这两个值 / 这两个输入框」；模态字段是多选 chip，说
 * 「这个默认值 / 这个多选项」。
 *
 * @param {string} routeKey defaultContextWindow | defaultMaxTokens | defaultInput
 * @param {number} total 路由模型条数
 * @param {number} affected 会用到该路由默认值的模型条数
 * @returns {{prefix: string, countText: string|null, suffix: string}|null}
 */
export function routeDefaultCountParts(routeKey, total, affected) {
  const field = routeDefaultField(routeKey);
  if (field === undefined) throw new TypeError(`未知的路由默认值字段：${String(routeKey)}`);
  if (!Number.isInteger(total) || total <= 0) return null;
  const count = Number.isInteger(affected) ? Math.min(Math.max(affected, 0), total) : 0;
  const modalities = field.kind === "modalities";
  const declaredText = modalities ? "都已声明自己的模态，这个多选项不影响它们。" : "都已声明自己的值，这两个输入框不影响它们。";
  const allText = modalities ? "全部使用这个默认值。" : "全部使用这两个值。";
  const useText = modalities ? "会使用这个默认值。" : "会使用这两个值。";
  if (count === 0) {
    return {
      prefix: `${field.label}：当前路由 ${total} 个模型${declaredText}`,
      countText: null,
      suffix: "",
    };
  }
  if (count === total) {
    return { prefix: `${field.label}：当前路由 ${total} 个模型${allText}`, countText: null, suffix: "" };
  }
  return {
    prefix: `${field.label}：当前路由 ${total} 个模型中有 `,
    countText: `${count} 个`,
    suffix: useText,
  };
}

/**
 * {@link routeDefaultCountParts} 的纯文本版本：返回完整的一句话；路由没有
 * 模型时返回 null（那一行不显示）。
 * @param {string} routeKey defaultContextWindow | defaultMaxTokens | defaultInput
 * @param {number} total 路由模型条数
 * @param {number} affected 会用到该路由默认值的模型条数
 * @returns {string|null}
 */
export function describeRouteDefaultCount(routeKey, total, affected) {
  const parts = routeDefaultCountParts(routeKey, total, affected);
  return parts === null ? null : `${parts.prefix}${parts.countText ?? ""}${parts.suffix}`;
}

/**
 * 路由默认值留空时宿主的真实后果：回落到内置常量，而不是「不限制」。
 * @param {string} routeKey defaultContextWindow | defaultMaxTokens | defaultInput
 * @returns {string|null} 如「默认上下文：留空 → 宿主使用内置默认值 1,000,000（1M）」
 */
export function describeHostDefaultFallback(routeKey) {
  const field = routeDefaultField(routeKey);
  const value = HOST_ROUTE_DEFAULT_FALLBACKS[routeKey];
  if (field === undefined) return null;
  if (Array.isArray(value)) {
    return `${field.label}：留空 → 宿主使用内置默认值 ${value.join(" / ")}（未声明 input 的模型按纯文本处理）`;
  }
  if (!Number.isFinite(value)) return null;
  const exact = value.toLocaleString("en-US");
  const short = humanizeTokenCount(value) || String(value);
  return `${field.label}：留空 → 宿主使用内置默认值 ${exact}（${short}）`;
}

/**
 * 从宿主命名空间 schema 里读 `providers.<任意>.api` 的 union 成员。
 *
 * schema 是协议清单的唯一事实来源：宿主新增协议时这里自动跟上，ModelPilot
 * 不维护第二份会漂移的白名单。读不到（没有 schema 服务、路径不是 union、
 * schema 抛错）时退回内置七种，并由调用方在界面上标注。
 *
 * @param {{rehydrate?:Function,nodeAtPath?:Function}|undefined} schemaOps 宿主 settingsSchema 操作
 * @param {object|undefined} namespaceSchema 序列化的命名空间 schema
 * @returns {{choices: string[], source: "schema"|"fallback"}}
 */
export function apiChoicesFromSchema(schemaOps, namespaceSchema) {
  const fallback = { choices: [...FALLBACK_API_PROTOCOLS], source: "fallback" };
  try {
    if (
      schemaOps === undefined ||
      schemaOps === null ||
      typeof schemaOps.rehydrate !== "function" ||
      typeof schemaOps.nodeAtPath !== "function" ||
      namespaceSchema === undefined ||
      namespaceSchema === null
    ) {
      return fallback;
    }
    const root = schemaOps.rehydrate(namespaceSchema);
    const node = schemaOps.nodeAtPath(root, ["providers", PROBE_ROUTE, "api"]);
    const list = Array.isArray(node?.list) ? node.list : [];
    const choices = [];
    for (const entry of list) {
      const value = entry?.value;
      if (typeof value === "string" && value.trim() !== "" && !choices.includes(value)) choices.push(value);
    }
    if (choices.length === 0) return fallback;
    return { choices, source: "schema" };
  } catch {
    return fallback;
  }
}

/**
 * 从宿主命名空间 schema 里读 `providers.<任意>.defaultInput` 的模态 union。
 *
 * 与协议清单同一做法：候选值现读 schema，宿主新增模态时自动跟上；读不到
 * （没有 schema 服务、路径不是 array、内层不是 union、schema 抛错）时退回
 * 内置 text / image，并由调用方在界面上标注。
 *
 * @param {{rehydrate?:Function,nodeAtPath?:Function}|undefined} schemaOps 宿主 settingsSchema 操作
 * @param {object|undefined} namespaceSchema 序列化的命名空间 schema
 * @returns {{choices: string[], source: "schema"|"fallback"}}
 */
export function modalityChoicesFromSchema(schemaOps, namespaceSchema) {
  const fallback = { choices: [...FALLBACK_MODALITIES], source: "fallback" };
  try {
    if (
      schemaOps === undefined ||
      schemaOps === null ||
      typeof schemaOps.rehydrate !== "function" ||
      typeof schemaOps.nodeAtPath !== "function" ||
      namespaceSchema === undefined ||
      namespaceSchema === null
    ) {
      return fallback;
    }
    const root = schemaOps.rehydrate(namespaceSchema);
    // defaultInput: z.array(z.union(MODALITIES)) → 先取 array 节点，再取内层 union。
    const arrayNode = schemaOps.nodeAtPath(root, ["providers", PROBE_ROUTE, "defaultInput"]);
    if (arrayNode?.type !== "array") return fallback;
    const node = schemaOps.nodeAtPath(arrayNode, ["0"]);
    const list = Array.isArray(node?.list) ? node.list : [];
    const choices = [];
    for (const entry of list) {
      const value = entry?.value;
      if (typeof value === "string" && value.trim() !== "" && !choices.includes(value)) choices.push(value);
    }
    if (choices.length === 0) return fallback;
    return { choices, source: "schema" };
  } catch {
    return fallback;
  }
}
