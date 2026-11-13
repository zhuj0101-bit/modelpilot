// 版本能力探测（DESIGN-v2 §6 J4）。
// 版本门禁的唯一事实来源；探测失败一律显式降级 [B1 §4.4]。

/**
 * @param llm - 宿主 `llm` 运行时（在降级宿主上可能为 undefined）。
 * @returns 冻结的能力标志。supportsConfigure ⇔ prepareCall.length>=3
 *   （0.2.1 的三参数形式）。目前 nativeReasoningEditing 跟随同一门禁，
 *   因为 0.2.1 才带上 ModelReasoningEfforts [audit 02-S4]；若日后有回移版本
 *   落地，这处拆分已经预留好了。
 */
export function detectVersionCapabilities(llm) {
  const probeArgs = typeof llm?.prepareCall === "function" ? llm.prepareCall.length : 0;
  return Object.freeze({
    supportsConfigure: probeArgs >= 3,
    probeArgs,
    nativeReasoningEditing: probeArgs >= 3,
  });
}
