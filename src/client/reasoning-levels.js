// 推理档位复选框组的纯逻辑：默认值、排序、快捷操作、R5 守卫。
// 单独成模块，让工作台之外可以用 node:test 直接覆盖四种状态；
// 组件本身只负责把这些结果接到 useState / JSX 上。

import { PI_AI_LEVELS } from "../core/domain.js";

/** 界面打开时默认勾选的档位。 */
export const DEFAULT_REASONING_LEVELS = Object.freeze(["off", "low", "medium", "high"]);

/** 只保留 PI_AI_LEVELS 已知档位，并按 PI_AI_LEVELS 的顺序排列。 */
export function orderReasoningLevels(levels) {
  const selected = new Set(levels instanceof Set ? levels : Array.isArray(levels) ? levels : []);
  return PI_AI_LEVELS.filter((level) => selected.has(level));
}

/** 勾选 / 取消一个档位；返回新的有序数组。 */
export function toggleReasoningLevel(levels, level) {
  if (!PI_AI_LEVELS.includes(level)) return orderReasoningLevels(levels);
  const selected = new Set(Array.isArray(levels) ? levels : []);
  if (selected.has(level)) selected.delete(level);
  else selected.add(level);
  return orderReasoningLevels(selected);
}

/** 「全选」：七个档位全部勾上。 */
export function allReasoningLevels() {
  return [...PI_AI_LEVELS];
}

/** 「全不选」：不写 reasoningEfforts（沿用目录能力事实）。 */
export function noReasoningLevels() {
  return [];
}

/** 「恢复默认」：回到 off / low / medium / high。 */
export function defaultReasoningLevels() {
  return [...DEFAULT_REASONING_LEVELS];
}

/** 由勾选状态构造 draft.reasoning；一个都没勾时返回 undefined。 */
export function reasoningPolicyFor(levels) {
  const ordered = orderReasoningLevels(levels);
  return ordered.length === 0 ? undefined : { mode: "effort", levels: ordered };
}

/** R5 守卫：只勾 off 会被宿主引擎以 efforts-only-off 拒绝。返回说明或 null。 */
export function reasoningLevelsGuard(levels) {
  const ordered = orderReasoningLevels(levels);
  if (ordered.length === 1 && ordered[0] === "off") {
    return "只勾 off 无法组成合法的 reasoningEfforts（R5：efforts-only-off）。off:null 只是省略该参数；请再勾选一个思考档位，或全不选（不写该字段）。";
  }
  return null;
}
