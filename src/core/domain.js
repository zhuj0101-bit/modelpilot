// 领域类型 + 共享原语（DESIGN-v2 §4；B2 §2 的 TS 类型，这里是运行时 JS 形态）。
// 纯逻辑、零宿主依赖 —— 此处每一处都可以用夹具直接测试。

/** 带宿主设置命名空间的驱动标识。 */
export const DRIVERS = Object.freeze({
  "pi-ai": { settingsNs: "llm-pi-ai", pathPrefix: ["providers"] },
  deepseek: { settingsNs: "llm-deepseek", pathPrefix: [] },
});

export const FIELD_STATES = Object.freeze(["value", "inherit", "cleared"]);
export const PI_AI_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const DEEPSEEK_EFFORTS = Object.freeze(["off", "low", "high", "max"]);
export const MODALITIES = Object.freeze(["text", "image"]);

/** FNV-1a 32 位摘要（用于变更检测 / 指纹；不做密码学用途）。 */
export function digest(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

/** 规范 JSON：对象键排序，数字 / 字符串形态稳定。 */
export function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 字段指纹：sha 风格的 path + 规范值（B5 §3.1；这里的摘要算法是 FNV）。 */
export function fieldFingerprint(path, value) {
  return digest(`${JSON.stringify(path)}:${canonicalJson(value)}`);
}

/** ModelKey 五元组的规范存储键（B3 §6；按 %2F 转义）。
 * 只用于我们自己命名空间的存储 —— 宿主路径使用原始分段。 */
export function modelKeyStorageKey(key) {
  const esc = (s) => String(s).replace(/%/g, "%25").replace(/\//g, "%2F");
  return [key.connectionId, key.driverId, key.routeId, key.protocol, key.rawModelId].map(esc).join("/");
}

/** 我们投影落点的一行目录 / 路由模型形态（pi-ai modelFields 的子集）。 */
export function piAiModelRow({ id, name, contextWindow, maxTokens, input, reasoningEfforts, compat }) {
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(input === undefined ? {} : { input }),
    ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
    ...(compat === undefined ? {} : { compat }),
  };
}

/**
 * 客户端预检：复刻 pi-ai resolveModelReasoning 的拒绝规则
 * [audit 02-S3；B2 §4.2 R1–R7]。字典合法时返回 null，否则返回
 * {code, message} 形式的拒绝结果。`efforts` 是原始的 reasoningEfforts 值。
 */
export function validatePiAiReasoningEfforts(efforts) {
  if (efforts === undefined) return null; // R-inherit：沿用目录能力事实
  if (efforts === false) return null; // R6：false 表示非推理模型（合法）
  if (efforts === null || typeof efforts !== "object" || Array.isArray(efforts) || Object.keys(efforts).length === 0) {
    return { code: "efforts-empty", message: "reasoningEfforts 为空；请声明档位、设为 false，或直接省略" };
  }
  const declared = PI_AI_LEVELS.filter((level) => efforts[level] !== undefined);
  for (const level of declared) {
    const wire = efforts[level];
    if (wire === null) {
      if (level !== "off") return { code: "efforts-null-non-off", message: `reasoningEfforts.${level}：只有 "off" 允许线上值为空` };
    } else if (typeof wire !== "string" || wire.length === 0) {
      return { code: "efforts-empty-wire", message: `reasoningEfforts.${level}：线上值必须是非空字符串` };
    }
  }
  if (!declared.some((level) => level !== "off")) {
    return { code: "efforts-only-off", message: "reasoningEfforts 除 off 之外没有任何档位；请声明一个思考档位，或设为 false" };
  }
  // 与 R5 相邻：xhigh / max 必须显式声明才可选 —— 那是 UI 的选项规则；
  // 这里只处理会被 pi-ai 静默忽略的未知档位键（THINKING_LEVELS 的未知键会被丢弃，
  // 所以写进去合法但没意义 —— 仅告警，不拒绝）。
  return null;
}

/** deepseek 方言门禁 [B2 §5；p1-precheck B2-Q3]：efforts 字典 → 拒绝。 */
export function projectDeepseekReasoning(policy) {
  if (policy === undefined || policy.mode === "inherit") return { value: undefined, warning: undefined };
  if (policy.mode === "disabled") return { value: "off", warning: "deepseek-disabled-as-off" };
  if (policy.mode === "effort") {
    if (!DEEPSEEK_EFFORTS.includes(policy.defaultLevel)) {
      return { value: undefined, warning: "efforts-dict-not-in-dialect", unsupported: true };
    }
    return { value: policy.defaultLevel, warning: undefined };
  }
  if (policy.mode === "budget") {
    return { value: undefined, warning: "no-per-model-slot", profileOnly: true };
  }
  return { value: undefined, warning: "unknown-policy" };
}

/**
 * 从模型 ID 推导默认显示名：取最后一个 `/` 之后的片段并去掉首尾空白。
 * 无 `/` 时就是模型 ID 本身；空模型 ID 得到空字符串。
 * 纯函数，供客户端联动与单元测试共用（B4 工作台）。
 */
export function displayNameFromModelId(modelId) {
  const id = typeof modelId === "string" ? modelId : "";
  if (id === "") return "";
  return id.split("/").pop().trim();
}

/**
 * 把 token 数量转成便于阅读的 K / M 表示法，供工作台的上下文窗口 /
 * 输出上限实时提示共用。
 *
 * - 大于等于 1000000：用 M，保留一位小数并去掉末尾的 .0
 * - 大于等于 1000：用 K，四舍五入取整
 * - 其余：原样输出
 * - 非有限数或非正数：空字符串
 */
export function humanizeTokenCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 1_000_000) {
    const millions = Math.round((v / 1_000_000) * 10) / 10;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}
