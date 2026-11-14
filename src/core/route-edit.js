// 工单 #32 第一批：路由（provider）级字段编辑与删除路由的纯逻辑。
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
// 说明「回到回落」只能用 unset 表达。

import { humanizeTokenCount } from "./domain.js";

/** 九个可编辑字段；顺序同时决定 ops 与「改动字段」的展示顺序。 */
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
]);

export const ROUTE_FIELD_KEYS = Object.freeze(ROUTE_FIELD_DEFINITIONS.map((field) => field.key));

/** cacheRetention 的三个取值（宿主 schema：none / short / long）。 */
export const CACHE_RETENTION_CHOICES = Object.freeze(["none", "short", "long"]);

/** transport 的四个取值（宿主 schema）。 */
export const TRANSPORT_CHOICES = Object.freeze(["sse", "websocket", "websocket-cached", "auto"]);

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
 * 现有路由 → 九个字段的表单初值。
 *
 * 只预填路由上真正声明过的值：未声明就留空，绝不把宿主 schema 的默认值
 * （例如 defaultContextWindow 的 1e6）当成用户设过的值。
 *
 * @param {object|undefined} provider 当前 providers 里的那条路由
 * @returns {Record<string, string>} 九个字段的字符串表单值
 */
export function routeFormFromProvider(provider) {
  const source = isPlainObject(provider) ? provider : {};
  const form = {};
  for (const field of ROUTE_FIELD_DEFINITIONS) {
    if (field.kind === "integer") {
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

/** 九个字段的中文标签列表（「改动字段」一行使用）。 */
export function routeFieldLabels(keys) {
  return keys.map(routeFieldLabel);
}

/**
 * 校验表单，返回 {field: message}；空对象表示全部合法。
 *
 * - baseURL：空 = 清空；非空必须以 http:// 或 https:// 开头
 * - 三个数字字段：空 = 清空；非空必须是正整数
 * - 文本 / 下拉字段不做额外校验（api 的合法值由宿主 schema 决定）
 */
export function validateRouteForm(form) {
  const errors = {};
  for (const field of ROUTE_FIELD_DEFINITIONS) {
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
 * 表单值 → 要写入的值；空串 = undefined（目标文档里不存在该字段）。
 */
function desiredValue(field, form) {
  const raw = form?.[field.key];
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (text === "") return undefined;
  return field.kind === "integer" ? Number(text) : text;
}

/** 路由上当前声明的值（用于判断是否真的变化）。 */
function currentValue(field, provider) {
  return field.kind === "integer"
    ? declaredInteger(provider?.[field.key])
    : declaredText(provider?.[field.key]);
}

/**
 * 生成路由级编辑操作。
 *
 * @param {string} routeId 路由 id（必须是 providers 的键）
 * @param {Record<string,string>} form 九个字段的表单值
 * @param {object|undefined} provider 当前路由对象；缺失即 stale-route
 * @returns {{ops: object[], changed: string[], errors: Record<string,string>, warnings: object[]}}
 *   - 任一字段校验失败 → ops 为空（整体拒绝，避免半套写入）
 *   - 什么都没改 → ops 为空
 *   - 每个 op 的 path 都以 ["providers", routeId] 为前缀，且 set 只写叶子字段
 */
export function buildRouteEditOps(routeId, form, provider) {
  const result = { ops: [], changed: [], errors: {}, warnings: [] };
  if (typeof routeId !== "string" || routeId === "" || !isPlainObject(provider)) {
    result.warnings.push({
      code: "stale-route",
      message: `stale-route：路由 "${String(routeId)}" 已不存在（可能已被别处删除）；请重新读取后重试`,
    });
    return result;
  }

  const errors = validateRouteForm(form);
  if (Object.keys(errors).length > 0) {
    result.errors = errors;
    return result;
  }

  for (const field of ROUTE_FIELD_DEFINITIONS) {
    const desired = desiredValue(field, form);
    const current = currentValue(field, provider);
    if (desired === current) continue;
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
