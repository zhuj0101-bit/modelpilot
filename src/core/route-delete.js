// 工单 #26：删除路由时一并清理存储的密钥 —— 与内置模型页一致的纯规则。
//
// 这一层只回答四个问题，不碰任何密钥内容：
//   1. 删除某条路由时，它对应哪个凭据引用名（apiKeyEnv 优先，空时回落派生名）；
//   2. 这个引用名有没有被别的路由共用（共用的不能删）；
//   3. describe 的结果 + 共用关系 → 删除弹窗该说哪种话（有没有 / 共用 / 只读 / 读不到）；
//   4. 每种状态下的标题、正文、提示与按钮文字。
//
// 顺序不在这一层：调用方必须先删密钥、再删配置 —— 引用名从路由的 apiKeyEnv
// 派生，配置先删掉就不知道该删哪个 ref 了。删密钥失败时也不得继续删配置。
//
// 明文密钥永远不经过这里：只有引用名，没有任何密钥内容。

import { credentialRefOf } from "./api-key.js";
import { compareRouteIds, routeCredentialRef } from "./route-overview.js";

/**
 * 删除弹窗的密钥状态：
 *
 * - `checking`  —— describe 还没回来（或还没发）：确认按钮必须禁用，绝不提前猜；
 * - `absent`    —— 确认没有存储的密钥（或引用名为空）：不发 unset；
 * - `configured`—— 已配置、可写、且没有别的路由共用：先删密钥再删配置；
 * - `shared`    —— 引用名还被别的路由使用：保留密钥，只删配置；
 * - `readonly`  —— 密钥由环境变量提供（writable: false）：删不掉，保留；
 * - `unknown`   —— 读失败：无法确认存在与否，只删配置并在弹窗里说明。
 */
export const ROUTE_DELETE_KEY_STATE = Object.freeze({
  checking: "checking",
  absent: "absent",
  configured: "configured",
  shared: "shared",
  readonly: "readonly",
  unknown: "unknown",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 除 routeId 之外、仍然指向同一个引用名的其它路由 id（字母序）。
 *
 * 共用就绝不能删：删掉之后另一条路由会立刻认证失败。这里只做**精确相等**
 * 比较，不做前缀 / 通配匹配 —— 引用名是宿主凭据存储里的完整键。
 */
export function routesSharingKeyRef(routeId, providers, ref) {
  if (typeof ref !== "string" || ref === "") return [];
  const map = isPlainObject(providers) ? providers : {};
  return Object.keys(map)
    .filter((id) => id !== routeId && routeCredentialRef(id, map[id]) === ref)
    .sort(compareRouteIds);
}

/**
 * 删除确认需要的全部事实，一律从**最新快照**重算（弹窗打开与点确认是两个
 * 时刻，路由可能已被别处删除、apiKeyEnv 可能已被改过）。
 *
 * @param {string} routeId 要删除的路由 id
 * @param {object} providers 最新的 providers 映射
 * @returns {{routeId: string, modelCount: number, ref: string, sharedBy: string[]}}
 */
export function buildRouteDeleteTarget(routeId, providers) {
  const map = isPlainObject(providers) ? providers : {};
  const provider = map[routeId];
  const ref = routeCredentialRef(routeId, provider);
  return {
    routeId: typeof routeId === "string" ? routeId : "",
    modelCount: Array.isArray(provider?.models) ? provider.models.length : 0,
    ref,
    sharedBy: routesSharingKeyRef(routeId, map, ref),
  };
}

/**
 * describe 结果 + 最新快照里的共用关系 → 删除弹窗状态。
 *
 * 优先级刻意如此：
 * - 引用名为空 → 没有可删的对象，按「没有存储的密钥」处理；
 * - 读失败 → unknown（不是 absent，也不能偷偷当 absent）；
 * - 未配置 → absent（绝不发一次注定失败的 unset）；
 * - 共用 → shared（比 readonly 先说，因为它解释了「为什么保留」）；
 * - 不可写（环境变量提供）→ readonly；
 * - 其余 → configured。
 *
 * @param {{ref?: string, status?: "idle"|"loading"|"ready"|"error", configured?: boolean,
 *   writable?: boolean, sharedBy?: string[]}} probe
 * @returns {string} {@link ROUTE_DELETE_KEY_STATE} 之一
 */
export function routeDeleteKeyState(probe) {
  const ref = credentialRefOf(probe?.ref);
  if (ref === "") return ROUTE_DELETE_KEY_STATE.absent;
  const status = probe?.status ?? "idle";
  if (status === "error") return ROUTE_DELETE_KEY_STATE.unknown;
  if (status !== "ready") return ROUTE_DELETE_KEY_STATE.checking;
  if (probe?.configured !== true) return ROUTE_DELETE_KEY_STATE.absent;
  if (Array.isArray(probe?.sharedBy) && probe.sharedBy.length > 0) {
    return ROUTE_DELETE_KEY_STATE.shared;
  }
  if (probe?.writable === false) return ROUTE_DELETE_KEY_STATE.readonly;
  return ROUTE_DELETE_KEY_STATE.configured;
}

/** 只有这一种状态才真的调用 `credentials.unset`。 */
export function routeDeleteRemovesKey(keyState) {
  return keyState === ROUTE_DELETE_KEY_STATE.configured;
}

/**
 * 删除确认弹窗的文案。标题带路由 id，正文按密钥状态分两套（内置页 的
 * deleteDescription / deleteDescriptionWithCredential 同一思路），按钮文字
 * 在有密钥时直接写清后果。
 *
 * 正文里的引用名只是引用名，永远不是密钥内容。
 *
 * @param {{routeId?: string, modelCount?: number, ref?: string, keyState?: string, sharedBy?: string[],
 *   error?: string}} facts
 * @returns {{title: string, body: string, hint: string, confirmLabel: string, confirmDisabled: boolean}}
 */
export function describeRouteDeleteDialog(facts) {
  const routeId = typeof facts?.routeId === "string" ? facts.routeId : "";
  const modelCount = Number.isInteger(facts?.modelCount) && facts.modelCount >= 0 ? facts.modelCount : 0;
  const ref = credentialRefOf(facts?.ref);
  const sharedBy = Array.isArray(facts?.sharedBy)
    ? facts.sharedBy.filter((id) => typeof id === "string" && id !== "")
    : [];
  const state = typeof facts?.keyState === "string" ? facts.keyState : ROUTE_DELETE_KEY_STATE.absent;
  const title = `删除路由「${routeId}」？`;
  const base = `这会移除该路由的全部配置（${modelCount} 个模型）`;
  // 不可撤销这件事留在页脚提示里：正文按工单规定的句子写，不额外堆句子。
  const keepHint = "这一步不能撤销；删除后不会影响其它路由。";

  if (state === ROUTE_DELETE_KEY_STATE.checking) {
    return {
      title,
      body: `${base}，正在检查是否存在存储的密钥…`,
      hint: "检查完成前无法确认是否会一并删除密钥，因此还不能确认删除。",
      confirmLabel: "删除路由",
      confirmDisabled: true,
    };
  }
  if (state === ROUTE_DELETE_KEY_STATE.unknown) {
    // 读失败的原因（宿主文案，永不含密钥内容）附在提示行里，方便用户排查；
    // 正文只保留工单规定的那一句结论。
    const reason = typeof facts?.error === "string" && facts.error !== "" ? `（${facts.error}）` : "";
    return {
      title,
      body: `${base}。无法确认是否存在存储的密钥，因此只会删除配置。`,
      hint: `${ref === "" ? "密钥" : `密钥 ${ref}`} 可能仍保留在凭据存储中${reason}。这一步不能撤销。`,
      confirmLabel: "删除路由",
      confirmDisabled: false,
    };
  }
  if (state === ROUTE_DELETE_KEY_STATE.configured) {
    return {
      title,
      body: `${base}，并一并删除存储的密钥 ${ref}。密钥删除后无法恢复。`,
      hint: keepHint,
      confirmLabel: "删除路由和密钥",
      confirmDisabled: false,
    };
  }
  if (state === ROUTE_DELETE_KEY_STATE.shared) {
    const users = sharedBy.length > 0 ? `（${sharedBy.join("、")}）` : "";
    return {
      title,
      body: `${base}。密钥 ${ref} 仍被其他路由使用${users}，将保留。`,
      hint: keepHint,
      confirmLabel: "删除路由",
      confirmDisabled: false,
    };
  }
  if (state === ROUTE_DELETE_KEY_STATE.readonly) {
    return {
      title,
      body: `${base}。密钥 ${ref} 由环境变量提供，不可从此处删除，将保留。`,
      hint: keepHint,
      confirmLabel: "删除路由",
      confirmDisabled: false,
    };
  }
  return {
    title,
    body: `${base}。它没有存储的密钥。`,
    hint: keepHint,
    confirmLabel: "删除路由",
    confirmDisabled: false,
  };
}
