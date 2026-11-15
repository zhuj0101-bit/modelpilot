// 工单 #24：全部路由总览 —— 跨路由的只读清单与批量密钥状态。
//
// 这一层只回答四个问题，不碰任何密钥内容：
//   1. 每条路由的凭据引用名（apiKeyEnv 为空时回落 deriveKeyRef(routeId)）；
//   2. 总览行按路由 id 字母序排列，与 Object.keys(providers) 的顺序无关；
//   3. 引用名怎么分批（宿主 describe 单次最多 64 个，超过会整体拒绝）；
//   4. 三态（已配置 / 未配置 / 未知）的文案与圆点字形。
//
// 明文密钥永远不经过这里：读路径只有 describe 返回的 configured / writable
// 布尔值，总览只显示状态。

import { credentialRefOf, deriveKeyRef } from "./api-key.js";

/** 宿主 `credentials.describe` 的 `z.array(...).max(64)`：一次超过会被整体拒绝。 */
export const DESCRIBE_BATCH_SIZE = 64;

/** 三种密钥状态的文案；「未知」是读失败 / 未返回，与「未配置」严格分开。 */
export const OVERVIEW_KEY_TEXT = Object.freeze({
  configured: "已配置",
  unconfigured: "未配置",
  unknown: "未知",
  loading: "正在读取密钥状态…",
});

/** 路由 id 的稳定字母序：不依赖插入顺序，也不受运行环境的区域设置影响。 */
export function compareRouteIds(a, b) {
  const left = typeof a === "string" ? a : String(a ?? "");
  const right = typeof b === "string" ? b : String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 路由 → 有效引用名；apiKeyEnv 为空（含纯空白）时回落 deriveKeyRef(routeId)。 */
export function routeCredentialRef(routeId, provider) {
  const explicit = credentialRefOf(provider?.apiKeyEnv);
  return explicit !== "" ? explicit : deriveKeyRef(routeId);
}

/**
 * 总览行：按路由 id 字母序，每行带模型数、协议原始值与凭据引用名。
 * 模型数 / 协议的展示文案（「未设置」/「未指定」）留在渲染层，纯层只给事实。
 */
export function buildRouteOverview(providers) {
  const map = providers && typeof providers === "object" && !Array.isArray(providers) ? providers : {};
  return Object.keys(map).sort(compareRouteIds).map((id) => {
    const provider = map[id];
    return {
      id,
      modelCount: Array.isArray(provider?.models) ? provider.models.length : 0,
      api: typeof provider?.api === "string" ? provider.api : "",
      ref: routeCredentialRef(id, provider),
    };
  });
}

/** 需要查询的引用名：同一引用被多条路由共用时只保留第一次出现（Set 去重）。 */
export function overviewCredentialRefs(rows) {
  const seen = new Set();
  const refs = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const ref = typeof row?.ref === "string" ? row.ref : "";
    if (ref === "" || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

/** 每批最多 64 个 ref；空输入不产生请求（不能给宿主发空数组）。 */
export function describeBatches(refs, size = DESCRIBE_BATCH_SIZE) {
  const list = Array.isArray(refs) ? refs : [];
  const limit = Number.isInteger(size) && size > 0 ? size : DESCRIBE_BATCH_SIZE;
  const batches = [];
  for (let index = 0; index < list.length; index += limit) {
    batches.push(list.slice(index, index + limit));
  }
  return batches;
}

/** describe 返回值 → 三态；返回里没有的 ref 是「未知」，不是「未配置」。 */
export function credentialStateOf(ref, info) {
  const entry = info && typeof info === "object" ? info[ref] : undefined;
  if (entry?.configured === true) return "configured";
  if (entry?.configured === false) return "unconfigured";
  return "unknown";
}

/** 单元格：三态文案 + 圆点字形；loading 是请求进行中的临时态，不是第四种密钥状态。 */
export function credentialCellOf(ref, info, { loading = false } = {}) {
  if (loading) return { kind: "loading", glyph: "…", text: OVERVIEW_KEY_TEXT.loading };
  const kind = credentialStateOf(ref, info);
  return {
    kind,
    glyph: kind === "configured" ? "●" : kind === "unconfigured" ? "○" : "?",
    text: OVERVIEW_KEY_TEXT[kind],
  };
}

/**
 * 折叠摘要：「全部路由（N 条 · X 条密钥已配 · Y 条未配）」。
 *
 * idle（尚未展开、从未查询）只能说条数 —— 没有查询就没有密钥状态；
 * loading 用同一句「正在读取密钥状态…」，绝不在结果回来前把任何一条说成「未配置」；
 * 有未知行时追加「Z 条未知」，不把读失败混进「未配」。
 */
export function describeOverviewSummary(rows, info, status = "ready") {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  if (status === "idle" || status === "error") return `全部路由（${total} 条）`;
  if (status === "loading") return `全部路由（${total} 条 · ${OVERVIEW_KEY_TEXT.loading}）`;
  let configured = 0;
  let unconfigured = 0;
  let unknown = 0;
  for (const row of list) {
    const state = credentialStateOf(row?.ref, info);
    if (state === "configured") configured += 1;
    else if (state === "unconfigured") unconfigured += 1;
    else unknown += 1;
  }
  const parts = [`${total} 条`, `${configured} 条密钥已配`, `${unconfigured} 条未配`];
  if (unknown > 0) parts.push(`${unknown} 条未知`);
  return `全部路由（${parts.join(" · ")}）`;
}
