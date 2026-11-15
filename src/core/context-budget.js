// 工单 #26 一期：maxTokens 的可用上下文实算。
//
// maxTokens 在 DSH 里是双身份字段：① 该模型最多能输出多少；② 每次请求默认
// 预留多少输出量。后者会从上下文窗口里扣掉，所以填得越大，能装的历史越少。
// ModelPilot 读不到宿主的运行时压缩配置，因此这里按 dsh-compaction-basic 的
// 文档化默认值估算；UI 必须标注「按默认策略估算」。
//
// 纯函数、零宿主依赖 —— 客户端与单元测试共用同一份计算。

export const COMPACTION_DEFAULTS = Object.freeze({
  thresholdRatio: 0.8, // 可用上限 = contextWindow × 0.8
  headroomTokens: 65536, // 额外缓冲
});

/**
 * 按 DSH 默认压缩策略估算可用上下文。
 *
 * 小窗口装不下 headroom 时预算会被完全吃光：`threshold` 截到 0（可用额度就是
 * 没有），而不是返回一个负的「可用上下文」；`loss` 的上限是 1（100%），
 * 不输出超过 100% 的「比最优少」。这种状态用 `exhausted` 显式标出，界面据此
 * 换成说明文案，而不是显示「可用上下文 0（比最优少 100%）」这种读不懂的数字。
 *
 * @param {number} contextWindow 上下文窗口；非有限数或 <= 0 时返回 null。
 * @param {number} maxTokens 输出上限；无效时按 0 处理。
 * @returns {{ceiling:number, threshold:number, loss:number, freeBoundary:number, exhausted:boolean, ok:boolean}|null}
 */
export function estimateContextBudget(contextWindow, maxTokens) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  const ceiling = Math.floor(contextWindow * COMPACTION_DEFAULTS.thresholdRatio);
  const used = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  const budget = contextWindow - used;
  const rawThreshold = Math.min(ceiling, budget - COMPACTION_DEFAULTS.headroomTokens);
  const threshold = Math.max(0, rawThreshold);
  const loss = ceiling > 0 ? Math.min(1, Math.max(0, (ceiling - threshold) / ceiling)) : 0;
  const freeBoundary = contextWindow - COMPACTION_DEFAULTS.headroomTokens - ceiling;
  const exhausted = budget - COMPACTION_DEFAULTS.headroomTokens <= 0;
  return { ceiling, threshold, loss, freeBoundary, exhausted, ok: loss === 0 };
}
