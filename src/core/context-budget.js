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
 * @param {number} contextWindow 上下文窗口；非有限数或 <= 0 时返回 null。
 * @param {number} maxTokens 输出上限；无效时按 0 处理。
 * @returns {{ceiling:number, threshold:number, loss:number, freeBoundary:number, ok:boolean}|null}
 */
export function estimateContextBudget(contextWindow, maxTokens) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  const ceiling = Math.floor(contextWindow * COMPACTION_DEFAULTS.thresholdRatio);
  const used = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  const budget = contextWindow - used;
  const threshold = Math.min(ceiling, budget - COMPACTION_DEFAULTS.headroomTokens);
  const loss = ceiling > 0 ? Math.max(0, (ceiling - threshold) / ceiling) : 0;
  const freeBoundary = contextWindow - COMPACTION_DEFAULTS.headroomTokens - ceiling;
  return { ceiling, threshold, loss, freeBoundary, ok: loss === 0 };
}
