// Version capability detection (DESIGN-v2 §6 J4).
// Single source of truth for version gates;探测失败一律显式降级 [B1 §4.4]。

/**
 * @param llm - the host `llm` runtime (may be undefined on degraded hosts).
 * @returns frozen capability flags. supportsConfigure ⇔ prepareCall.length>=3
 *   (0.2.1 three-arg form). nativeReasoningEditing tracks the same gate today
 *   because 0.2.1 ships ModelReasoningEfforts [audit 02-S4]; if a backport
 *   lands later this split already exists.
 */
export function detectVersionCapabilities(llm) {
  const probeArgs = typeof llm?.prepareCall === "function" ? llm.prepareCall.length : 0;
  return Object.freeze({
    supportsConfigure: probeArgs >= 3,
    probeArgs,
    nativeReasoningEditing: probeArgs >= 3,
  });
}
