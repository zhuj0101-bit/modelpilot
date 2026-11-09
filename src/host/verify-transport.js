// VerifyTransport — prepareCall dual-track adapter (DESIGN-v2 §6 J4, B1 §4).
//
// Track A "configure" (host 0.2.1, prepareCall.length>=3):
//   prepareCall(config, signal, configure) → one-shot frozen PreparedLlmCall.
//   The configure callback is pure: it receives deep-frozen structuredClones
//   of (controls, modelInfo) and returns replacement controls. Result marked
//   driver-confirmed.
// Track B "precheck" (host 0.2.0, two-arg form):
//   resolveCallConfig(config, signal) validates (materializing defaults and
//   rejecting unsupported efforts with UNSUPPORTED_REASONING_EFFORT), then the
//   caller dispatches an explicit stream(). Result marked driver-confirmed for
//   the validation fact; wire identity carries a documented HMR-splice
//   residual risk [B1 §4.3].
// Track U "unavailable" (no runtime): explicit degradation — logical-only,
//   never a silent pretend-confirmed.

/**
 * @param llm - host llm runtime or undefined.
 * @returns {mode: "configure"|"precheck"|"unavailable", verify(config, options)}
 */
export function createVerifyTransport(llm) {
  const caps = detectLocal(llm);
  if (caps.supportsConfigure) {
    return {
      mode: "configure",
      caps,
      async verify(config, { signal, configure } = {}) {
        // Track A's whole point: a configure callback runs (identity by
        // default) so the prepared-call path is exercised end to end.
        const effectiveConfigure = configure ?? ((controls) => controls);
        const prepared = await llm.prepareCall(config, signal, effectiveConfigure);
        let dispatched = false;
        let lastOptions = prepared.config;
        return {
          fidelity: "driver-confirmed",
          config: prepared.config,
          adapterDefaults: prepared.adapterDefaults,
          /** One-shot dispatch of the prepared handle (test/ops seam). */
          stream: (options) => prepared.stream(options ?? prepared.config),
          dispatchAgain: () => prepared.stream(lastOptions),
          dispatchWithMutatedConfig: () => prepared.stream({ ...prepared.config, maxTokens: (prepared.config.maxTokens ?? 0) + 1 }),
        };
      },
    };
  }
  if (caps.probeArgs === 2) {
    return {
      mode: "precheck",
      caps,
      async verify(config, { signal } = {}) {
        const resolved = await llm.resolveCallConfig(config, signal);
        return {
          fidelity: "driver-confirmed",
          config: resolved,
          stream: (options) => llm.stream(options ?? resolved),
        };
      },
    };
  }
  return {
    mode: "unavailable",
    caps,
    async verify(config) {
      return { fidelity: "logical-only", unavailable: true, config };
    },
  };
}

function detectLocal(llm) {
  const probeArgs = typeof llm?.prepareCall === "function" ? llm.prepareCall.length : 0;
  return { supportsConfigure: probeArgs >= 3, probeArgs, nativeReasoningEditing: probeArgs >= 3 };
}
