// VerifyTransport —— prepareCall 双轨适配器（DESIGN-v2 §6 J4、B1 §4）。
//
// 轨道 A「configure」（宿主 0.2.1，prepareCall.length>=3）：
//   prepareCall(config, signal, configure) → 一次性的冻结 PreparedLlmCall。
//   configure 回调是纯函数：它接收 (controls, modelInfo) 的深冻结
//   structuredClone，返回替换用的 controls。结果标记为 driver-confirmed。
// 轨道 B「precheck」（宿主 0.2.0，两参数形式）：
//   resolveCallConfig(config, signal) 负责校验（补齐默认值，并以
//   UNSUPPORTED_REASONING_EFFORT 拒绝不支持的 efforts），随后由调用方
//   显式派发 stream()。结果只对「校验事实」标记 driver-confirmed；
//   线上身份仍带有已记录的 HMR 拼接残余风险 [B1 §4.3]。
// 轨道 U「unavailable」（无运行时）：显式降级 —— 仅逻辑层（logical-only），
//   绝不静默伪装成已确认。

/**
 * @param llm - 宿主 llm 运行时，或 undefined。
 * @returns {mode: "configure"|"precheck"|"unavailable", verify(config, options)}
 */
export function createVerifyTransport(llm) {
  const caps = detectLocal(llm);
  if (caps.supportsConfigure) {
    return {
      mode: "configure",
      caps,
      async verify(config, { signal, configure } = {}) {
        // 轨道 A 的全部意义就在于此：configure 回调一定会跑（默认为恒等
        // 回调），从而把 prepareCall 路径端到端地跑通。
        const effectiveConfigure = configure ?? ((controls) => controls);
        const prepared = await llm.prepareCall(config, signal, effectiveConfigure);
        let dispatched = false;
        let lastOptions = prepared.config;
        return {
          fidelity: "driver-confirmed",
          config: prepared.config,
          adapterDefaults: prepared.adapterDefaults,
          /** 对已备好的句柄做一次性派发（测试 / 运维接缝）。 */
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

/* 本地探测：与 detectVersionCapabilities 同源的轻量副本。 */
function detectLocal(llm) {
  const probeArgs = typeof llm?.prepareCall === "function" ? llm.prepareCall.length : 0;
  return { supportsConfigure: probeArgs >= 3, probeArgs, nativeReasoningEditing: probeArgs >= 3 };
}
