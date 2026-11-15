// 工单 #29：连接测试请求的纯逻辑（路由 declared 分流 + 失败文案分类）。
//
// 连接测试要同时满足两件互相拉扯的事实：
//   - 宿主只在请求带 provider 时才解析这条路由已保存的凭据；
//   - 宿主一旦收到 provider 且内置目录有货，就直接返回目录、不发 HTTP 请求。
//
// 因此请求是否带 provider 不能拍脑袋决定，要按宿主的 declared 事实分流：
//   - declared === true：适配器只因为配置才知道这条路由，目录描述不了它，
//     带 provider 既拿得到凭据，也不会被目录短路；
//   - declared === false：内置目录有货，不能带 provider，否则「读目录」会
//     冒充一次真实探活；
//   - 目录读不到：保守按 declared 处理。宁可多带一次 provider 拿到真实
//     错误（至少不是「没带密钥」的 401），也不要在缺事实时退回旧坑。
//
// 失败文案只做「分类标注 + 截断」，宿主的原始消息照旧保留：用户既知道
// 401 是密钥问题，也能看到宿主给出的完整上下文。

/** 连接测试失败文案的截断长度（沿用既有界面约定）。 */
export const PROBE_TEXT_LIMIT = 200;

/** 取出宿主的目录条目数组；失败 / 形态不符返回 undefined。 */
export function catalogEntriesOf(response) {
  if (Array.isArray(response)) return response;
  if (response === null || typeof response !== "object") return undefined;
  if (response.ok === true && Array.isArray(response.value)) return response.value;
  return undefined;
}

/**
 * 读一次可配置提供商目录。目录是只读事实，读失败不能挡住探活：
 * 返回 undefined，让调用方按 declared 保守处理。
 *
 * @param {(() => Promise<unknown>|unknown)|undefined} load listConfigurableProviders
 * @returns {Promise<object[]|undefined>}
 */
export async function loadCatalogEntries(load) {
  if (typeof load !== "function") return undefined;
  try {
    return catalogEntriesOf(await load());
  } catch {
    return undefined;
  }
}

function providerIdOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 这条路由要不要在探活请求里带 provider。
 *
 * 目录条目缺失（目录不认识它 / 目录为空 / 目录读不到）都按 declared 处理；
 * 条目存在时与宿主一致：只有显式 declared === true 才算目录描述不了，
 * 缺少 declared 的旧宿主条目按「目录可用」处理（与 route-create.js 同口径）。
 *
 * @param {object[]|undefined} entries catalogEntriesOf / loadCatalogEntries 的结果
 * @param {string} routeId 当前路由 id
 * @returns {{declared:boolean, includeProvider:boolean, provider:string}}
 */
export function probeProviderChoice(entries, routeId) {
  const provider = providerIdOf(routeId);
  if (provider === "") return { declared: true, includeProvider: false, provider: "" };
  if (!Array.isArray(entries)) return { declared: true, includeProvider: true, provider };
  const hit = entries.find((entry) => providerIdOf(entry?.provider) === provider);
  if (hit === undefined) return { declared: true, includeProvider: true, provider };
  const declared = hit.declared === true;
  return { declared, includeProvider: declared, provider };
}

/**
 * 生成一次连接测试的 discoverModels 请求。
 *
 * 字段顺序固定为 provider / baseURL / api：测试可以直接按 Object.keys 断言
 * 「目录路由没有 provider，declared 路由有 provider」。
 *
 * @param {{entries?:object[], routeId?:string, baseURL?:string, api?:string}} input
 * @returns {{request:object, declared:boolean, includeProvider:boolean, provider:string}}
 */
export function buildProbeRequest(input = {}) {
  const choice = probeProviderChoice(input.entries, input.routeId);
  const request = {};
  if (choice.includeProvider) request.provider = choice.provider;
  request.baseURL = typeof input.baseURL === "string" ? input.baseURL : "";
  if (typeof input.api === "string" && input.api !== "") request.api = input.api;
  return {
    request,
    declared: choice.declared,
    includeProvider: choice.includeProvider,
    provider: choice.provider,
  };
}

/**
 * 从宿主错误里取 HTTP 状态。
 *
 * 当前宿主把状态写在消息里（`<url> answered 401; check the API key`），
 * 不单独给 status；未来宿主若补了 status 字段也直接认。只匹配 `answered`
 * 与 `HTTP` 两种前缀，避免把端口号之类的三位数字误当状态码。
 *
 * @param {unknown} error
 * @returns {number|undefined}
 */
export function probeHttpStatus(error) {
  const status = typeof error === "object" && error !== null ? error.status : undefined;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  const message = typeof error === "string"
    ? error
    : typeof error === "object" && error !== null && typeof error.message === "string"
      ? error.message
      : "";
  const match = message.match(/\b(?:answered|http)\s+(\d{3})\b/i);
  return match === null ? undefined : Number(match[1]);
}

function statusHint(status) {
  if (status === 401 || status === 403) return `密钥未通过认证（HTTP ${status}）`;
  if (status === 404) return "接口地址可能写错（HTTP 404）";
  if (status !== undefined && status >= 500 && status <= 599) return `服务端错误（HTTP ${status}）`;
  return undefined;
}

/**
 * 连接测试失败文案：按 HTTP 状态加一句明确的分类前缀，保留宿主原文，
 * 最后统一截断到 200 字符（前缀在前，不会被截掉）。
 *
 * @param {unknown} error 宿主的 error（{code,message,status?}）或抛出的异常
 * @returns {string}
 */
export function probeFailureText(error) {
  const raw = typeof error === "string"
    ? error
    : typeof error === "object" && error !== null && typeof error.message === "string"
      ? error.message
      : "";
  const message = raw.trim();
  const hint = statusHint(probeHttpStatus(error));
  if (message === "") return hint ?? "连接测试失败（宿主未返回原因）";
  return (hint === undefined ? message : `${hint}：${message}`).slice(0, PROBE_TEXT_LIMIT);
}
