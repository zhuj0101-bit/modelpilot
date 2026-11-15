// 工单 #37：改密钥引用名时一并清理旧密钥 —— 与 route-delete.js 同一思路的纯规则。
//
// 这一层只回答四个问题，不碰任何密钥内容：
//   1. 这次保存是不是「改引用名」（旧 / 新引用名都非空且不同）；
//   2. describe 的结果 + 共用关系 → 旧引用名该怎么处理（删 / 留 / 读不到）；
//   3. 哪种状态才真的调用 `credentials.unset`；
//   4. 改引用名确认弹窗的标题、正文、提示与按钮文字。
//
// 顺序不在这一层：调用方必须先 `unset` 旧引用、确认成功后再写新配置。反过来
// 会在 unset 失败时把旧密钥变成界面上再也看不到的永久孤儿 —— 正是本单要消灭
// 的东西。引用名为空不在此列：首次设置 / 清空引用名都不是「改名」。
//
// 明文密钥永远不经过这里：只有引用名，没有任何密钥内容。

import { credentialRefOf } from "./api-key.js";

/**
 * 改引用名时旧密钥的处理方式：
 *
 * - `unchanged` —— 引用名没变 / 都为空 / 任一为空（首次设置或清空），不碰凭据；
 * - `absent`    —— 旧引用没有存储的密钥，照常保存；
 * - `movable`   —— 旧引用有密钥、可写、且没有别的路由共用 → 先删密钥再保存；
 * - `shared`    —— 旧引用还被别的路由使用 → 保留密钥，只改引用名；
 * - `readonly`  —— 密钥由环境变量提供（writable: false）→ 删不掉，保留；
 * - `unknown`   —— 读失败 / 读不到：无法确认存在与否，不删但必须提示。
 */
export const KEY_RENAME_STATE = Object.freeze({
  unchanged: "unchanged",
  absent: "absent",
  movable: "movable",
  shared: "shared",
  readonly: "readonly",
  unknown: "unknown",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 比较路由上保存的引用名与本次表单要写的引用名。
 *
 * 两个引用名都按 `credentialRefOf` 归一化（首尾空白不算名字的一部分）：路由
 * 上还没声明、或表单要清空时那一侧为空，都**不算**改引用名 —— 没有旧引用
 * 可删，也不该把「首次设置密钥」误当成改名。
 *
 * @param {string} routeId 路由 id（providers 的键）
 * @param {object} providers 最新的 providers 映射
 * @param {unknown} nextApiKeyEnv 表单里待写入的 apiKeyEnv
 * @returns {{oldRef: string, newRef: string, changed: boolean}}
 */
export function keyRenameTarget(routeId, providers, nextApiKeyEnv) {
  const map = isPlainObject(providers) ? providers : {};
  const oldRef = credentialRefOf(map[routeId]?.apiKeyEnv);
  const newRef = credentialRefOf(nextApiKeyEnv);
  return { oldRef, newRef, changed: oldRef !== "" && newRef !== "" && oldRef !== newRef };
}

/**
 * describe 结果 + 最新快照里的共用关系 → 旧密钥的处理方式。
 *
 * 优先级刻意如此：
 * - 明确没改 / 任一引用名为空 / 两个引用名相同 → unchanged（绝不发 unset）；
 * - 还没查、正在查、读失败 → unknown（不是 absent，也不能偷偷当 absent）；
 * - 未配置 → absent（绝不发一次注定失败的 unset）；
 * - 共用 → shared（比 readonly 先说，因为它解释了「为什么保留」）；
 * - 不可写（环境变量提供）→ readonly；
 * - 其余 → movable。
 *
 * @param {{oldRef?: string, newRef?: string, changed?: boolean,
 *   status?: "idle"|"loading"|"ready"|"error", configured?: boolean,
 *   writable?: boolean, sharedBy?: string[]}} probe
 * @returns {string} {@link KEY_RENAME_STATE} 之一
 */
export function keyRenameState(probe) {
  if (probe?.changed === false) return KEY_RENAME_STATE.unchanged;
  const oldRef = credentialRefOf(probe?.oldRef);
  const newRef = credentialRefOf(probe?.newRef);
  if (oldRef === "" || newRef === "" || oldRef === newRef) return KEY_RENAME_STATE.unchanged;
  const status = probe?.status ?? "idle";
  // 只有明确读到结果（ready）才敢判断存在与否；其余状态一律按「无法确认」处理。
  if (status !== "ready") return KEY_RENAME_STATE.unknown;
  if (probe?.configured !== true) return KEY_RENAME_STATE.absent;
  if (Array.isArray(probe?.sharedBy) && probe.sharedBy.length > 0) {
    return KEY_RENAME_STATE.shared;
  }
  if (probe?.writable === false) return KEY_RENAME_STATE.readonly;
  return KEY_RENAME_STATE.movable;
}

/** 只有这一种状态才真的调用 `credentials.unset`。 */
export function keyRenameRemovesOldKey(state) {
  return state === KEY_RENAME_STATE.movable;
}

/**
 * 改引用名确认弹窗的文案。
 *
 * 只在「旧密钥可删」时弹出：说明旧密钥会被删除且无法恢复，并提醒新引用
 * 还没有密钥、保存后需要重新填写。页脚沿用与删除路由一致的「先删密钥再
 * 写配置」说明。正文里的引用名只是引用名，永远不是密钥内容。
 *
 * @param {{oldRef?: string, newRef?: string}} facts
 * @returns {{title: string, body: string, hint: string, confirmLabel: string}}
 */
export function describeKeyRenameDialog(facts) {
  const oldRef = credentialRefOf(facts?.oldRef);
  const newRef = credentialRefOf(facts?.newRef);
  return {
    title: `把密钥引用从 ${oldRef} 改为 ${newRef}？`,
    body: `保存后会删除旧密钥 ${oldRef}，且无法恢复。新引用 ${newRef} 还没有配置密钥，保存后需要重新填写。`,
    hint: "先删除旧密钥，成功后才写入新的引用名；删除失败会中止保存。",
    confirmLabel: "保存并删除旧密钥",
  };
}
