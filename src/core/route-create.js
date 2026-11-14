// 工单 #21：从目录新增路由（平替最后一块）的纯逻辑。
//
// 候选只读消费宿主的 remote.llm.listConfigurableProviders()：它返回所有
// *已声明* 的提供商 —— 包括当前还没配置的 —— 因此用户不需要手抄 provider id，
// 也就不会拼错。这里不改变宿主的返回，只把它整理成弹窗需要的行。
//
// 写入只有一种形态：
//   { op: "set", path: ["providers", <id>], value: {...} }
//
// value 的规则来自宿主 llm-pi-ai 的真实校验：
//   - 目录能描述这个提供商 → 不写 models，宿主用内置目录；
//   - 目录描述不了（自建中转站）→ 必须至少列一条模型，否则宿主整条拒绝：
//     "resolves no models; the installed catalog does not describe this route"
// 密钥值永远不在这里：这里只写 apiKeyEnv 引用名（真值走工单 #18 的
// credentials.set）。

import { FALLBACK_API_PROTOCOLS } from "./route-edit.js";

/** provider id 的 UI 约束（工单 #21 3.4）。 */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const PROVIDER_ID_MAX_LENGTH = 64;

/** 弹窗里的就地校验文案；组件直接展示这些字符串。 */
export const NEW_ROUTE_ERRORS = Object.freeze({
  providerIdRequired: "请填写 provider id",
  providerIdFormat: "只允许 a-z、0-9、连字符（≤64 位）",
  providerIdExists: "该路由已存在",
  providerIdNotInCatalog: "该提供商不在可配置目录中",
  baseURL: "需以 http:// 或 https:// 开头",
  modelsRequired: "自定义路由至少需要一条模型",
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function idInList(list, id) {
  if (Array.isArray(list)) return list.includes(id);
  if (list instanceof Set) return list.has(id);
  return false;
}

/** 表单里的 provider id 统一去掉首尾空白；undefined / null 当空串。 */
export function normalizeProviderId(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 目录行整理：只保留与当前工作台命名空间匹配的条目，并标注是否已配置。
 *
 * listConfigurableProviders() 是跨命名空间的目录（llm-pi-ai / llm-deepseek …）。
 * 本工作台只写 llm-pi-ai；把别的命名空间条目列出来会让用户选到一个写不进去的
 * 路由。缺少 settingsNs 的夹具条目（旧宿主 / 简化测试）按本命名空间处理。
 *
 * @param {object[]|undefined} entries listConfigurableProviders() 的返回
 * @param {{settingsNs?: string, existingIds?: string[]|Set<string>}} [options]
 * @returns {{provider:string, displayName:string, configured:boolean, declared:boolean, error?:string}[]}
 */
export function routeCatalogRows(entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const settingsNs = isNonEmptyString(options.settingsNs) ? options.settingsNs.trim() : undefined;
  const existingIds = options.existingIds;
  const seen = new Set();
  const rows = [];
  for (const entry of list) {
    const provider = normalizeProviderId(entry?.provider);
    if (provider === "" || seen.has(provider)) continue;
    const entryNs = typeof entry?.settingsNs === "string" ? entry.settingsNs.trim() : "";
    if (settingsNs !== undefined && entryNs !== "" && entryNs !== settingsNs) continue;
    seen.add(provider);
    rows.push({
      provider,
      displayName: isNonEmptyString(entry.displayName) ? entry.displayName.trim() : provider,
      configured: idInList(existingIds, provider),
      // declared === true：适配器只因为配置才知道这条路由（目录描述不了它）。
      declared: entry?.declared === true,
      ...(isNonEmptyString(entry?.error) ? { error: entry.error.trim() } : {}),
    });
  }
  return rows;
}

/** 按 provider id 过滤目录行；搜索词只匹配 id（验收判据 4）。 */
export function filterCatalogRows(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (needle === "") return list.slice();
  return list.filter((row) => row.provider.toLowerCase().includes(needle));
}

/**
 * 宿主目录是否描述得了这条路由。只有确定描述不了（declared === true）才算
 * 未知；缺少 declared 的旧宿主条目按「目录可用」处理，避免多写 models。
 */
export function catalogKnowsProvider(catalog, providerId) {
  const id = normalizeProviderId(providerId);
  if (id === "") return false;
  const list = Array.isArray(catalog) ? catalog : [];
  return list.some((entry) => normalizeProviderId(entry?.provider) === id && entry?.declared !== true);
}

/**
 * 协议下拉的默认值：优先 openai-completions，其次是宿主 schema 给的第一个，
 * 最后退回内置白名单第一条。协议不能为空 —— 目录外的路由少了它，宿主会拒绝
 * 每一条模型。
 */
export function defaultProtocolChoice(choices) {
  const list = (Array.isArray(choices) ? choices : [])
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim());
  if (list.includes("openai-completions")) return "openai-completions";
  return list[0] ?? FALLBACK_API_PROTOCOLS[0];
}

/**
 * 模型输入 → 去空、去重后的 id 列表。
 *
 * 支持逗号 / 中文逗号 / 换行 / 空白分隔：弹窗里只有一个输入框，创建后仍可
 * 用「新增模型」补字段。重复 id 在这里合并，避免宿主以 duplicate 整条拒绝。
 */
export function normalizeModelIds(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,，]+/)
      : [];
  const seen = new Set();
  const ids = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function providerIdError(providerId, existingIds) {
  if (providerId === "") return NEW_ROUTE_ERRORS.providerIdRequired;
  if (providerId.length > PROVIDER_ID_MAX_LENGTH || !PROVIDER_ID_PATTERN.test(providerId)) {
    return NEW_ROUTE_ERRORS.providerIdFormat;
  }
  if (idInList(existingIds, providerId)) return NEW_ROUTE_ERRORS.providerIdExists;
  return null;
}

/**
 * 生成「新建路由」的唯一一条 set op。
 *
 * @param {object} input
 * @param {"catalog"|"custom"} input.mode 从目录选 / 自定义
 * @param {string} input.providerId 选中的目录 id 或手填 id
 * @param {string} [input.baseURL] 自定义模式的接口地址（必填）
 * @param {string} [input.api] 自定义模式的协议
 * @param {string} [input.apiKeyEnv] 密钥引用名（永远不是密钥值）
 * @param {string|string[]} [input.modelIds] 自定义模式的模型 id（目录外必填）
 * @param {object[]} [input.catalog] routeCatalogRows() 整理后的目录行
 * @param {string[]|Set<string>} [input.existingIds] 已存在的 provider id
 * @returns {{ok:boolean, op:object|null, providerId:string, value:object|null, errors:Record<string,string>, catalogKnown:boolean}}
 */
export function buildRouteCreatePlan(input = {}) {
  const mode = input.mode === "custom" ? "custom" : "catalog";
  const providerId = normalizeProviderId(input.providerId);
  const existingIds = input.existingIds;
  const catalog = Array.isArray(input.catalog) ? input.catalog : [];
  const errors = {};

  const idError = providerIdError(providerId, existingIds);
  if (idError !== null) errors.providerId = idError;

  const catalogKnown = catalogKnowsProvider(catalog, providerId);
  const modelIds = normalizeModelIds(input.modelIds);
  const baseURL = typeof input.baseURL === "string" ? input.baseURL.trim() : "";
  const api = typeof input.api === "string" ? input.api.trim() : "";
  const apiKeyEnv = typeof input.apiKeyEnv === "string" ? input.apiKeyEnv.trim() : "";

  if (mode === "custom") {
    // 空值和不是 http(s):// 开头的值都在本地拦住；不产出半套 op。
    if (!/^https?:\/\//i.test(baseURL)) errors.baseURL = NEW_ROUTE_ERRORS.baseURL;
    if (!catalogKnown && modelIds.length === 0) errors.models = NEW_ROUTE_ERRORS.modelsRequired;
  } else if (idError === null && !catalogKnown) {
    // 目录模式只能选目录行；这里再兜一层，防止调用方传入已不在目录里的 id。
    errors.providerId = NEW_ROUTE_ERRORS.providerIdNotInCatalog;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, op: null, providerId, value: null, errors, catalogKnown };
  }

  const value = {};
  if (mode === "custom") {
    if (api !== "") value.api = api;
    value.baseURL = baseURL;
    if (apiKeyEnv !== "") value.apiKeyEnv = apiKeyEnv;
    // 目录描述得了这条路由时，models 必须省略：宿主仍用内置目录。
    if (!catalogKnown) value.models = modelIds.map((id) => ({ id }));
  }

  return {
    ok: true,
    op: { op: "set", path: ["providers", providerId], value },
    providerId,
    value,
    errors: {},
    catalogKnown,
  };
}
