// 工单 #23：推理档位的「API 参数值」映射。
//
// 档位名是给人看的，真正发出去的是 reasoningEfforts 字典里的线上值。
// 这里集中实现三条硬规则，供创建表单、编辑表单与投影前的差异比较共用：
//
// 1. 留空 = 用档位名，不写空串（宿主 validatePiAiReasoningEfforts 会拒绝空串）。
// 2. off 的线上值恒为 null，不参与映射。
// 3. 值必须只属于当前勾选的档位；与档位名相同的值不写（省掉冗余噪音）。
//
// 纯函数、零宿主依赖；src/client 与 src/core 都直接复用，避免两处规则漂移。

import { PI_AI_LEVELS } from "./domain.js";

/** 任意输入 → 去首尾空白后的字符串；非字符串按「未填」处理。 */
function trimmedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 表单输入 → wireMap。
 *
 * 只保留 `levels` 里勾选的非 off 档位；空白值、与档位名相同的值都不写入。
 * 返回对象按 PI_AI_LEVELS 顺序插入，便于测试与调试时阅读。
 *
 * @param {string[]|Set<string>} levels 当前勾选的档位
 * @param {Record<string, string>|undefined} apiValues 各档位的 API 参数值输入
 * @returns {Record<string, string>}
 */
export function wireMapFromApiValues(levels, apiValues) {
  const selected = levels instanceof Set ? levels : new Set(Array.isArray(levels) ? levels : []);
  const wireMap = {};
  for (const level of PI_AI_LEVELS) {
    if (level === "off" || !selected.has(level)) continue;
    const wire = trimmedText(apiValues?.[level]);
    if (wire !== "" && wire !== level) wireMap[level] = wire;
  }
  return wireMap;
}

/**
 * 现有 model.reasoningEfforts → wireMap。
 *
 * 只摘出「值与档位名不同」的条目：off 的 null、与档位名相同的值、未知键与
 * 非字符串值都不算自定义映射。线上值先 trim 再比较：配置里带首尾空白的值
 * 不会让「打开表单但什么都没改」被误判成改动。
 *
 * @param {unknown} efforts
 * @returns {Record<string, string>}
 */
export function wireMapFromEfforts(efforts) {
  if (efforts === null || typeof efforts !== "object" || Array.isArray(efforts)) return {};
  const wireMap = {};
  for (const level of PI_AI_LEVELS) {
    if (level === "off" || !Object.hasOwn(efforts, level)) continue;
    const wire = efforts[level];
    if (typeof wire !== "string") continue;
    const trimmed = wire.trim();
    if (trimmed !== "" && trimmed !== level) wireMap[level] = trimmed;
  }
  return wireMap;
}

/** 表单里「值与档位名不同」的档位个数；供折叠摘要显示。 */
export function customWireCount(levels, apiValues) {
  return Object.keys(wireMapFromApiValues(levels, apiValues)).length;
}

/** 两套 wireMap 语义相等（键集合 + 值；与插入顺序无关）。 */
export function sameWireMap(left, right) {
  const a = left ?? {};
  const b = right ?? {};
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}
