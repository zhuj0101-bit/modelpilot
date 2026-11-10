// Domain types + shared primitives (DESIGN-v2 §4; B2 §2 TS types, runtime JS form).
// Pure, zero host dependencies — everything here is fixture-testable.

/** Driver identifiers with a host settings namespace. */
export const DRIVERS = Object.freeze({
  "pi-ai": { settingsNs: "llm-pi-ai", pathPrefix: ["providers"] },
  deepseek: { settingsNs: "llm-deepseek", pathPrefix: [] },
});

export const FIELD_STATES = Object.freeze(["value", "inherit", "cleared"]);
export const PI_AI_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const DEEPSEEK_EFFORTS = Object.freeze(["off", "low", "high", "max"]);
export const MODALITIES = Object.freeze(["text", "image"]);

/** FNV-1a 32-bit digest (change detection / fingerprints; not crypto). */
export function digest(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

/** Canonical JSON: sorted object keys, stable number/string forms. */
export function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Field fingerprint: sha-style path+canonical-value (B5 §3.1; digest here is FNV). */
export function fieldFingerprint(path, value) {
  return digest(`${JSON.stringify(path)}:${canonicalJson(value)}`);
}

/** Canonical storage key of a ModelKey five-tuple (B3 §6; %2F escaping).
 * Only used for OUR namespace storage — host paths use raw segments. */
export function modelKeyStorageKey(key) {
  const esc = (s) => String(s).replace(/%/g, "%25").replace(/\//g, "%2F");
  return [key.connectionId, key.driverId, key.routeId, key.protocol, key.rawModelId].map(esc).join("/");
}

/** One catalog/route model row shape we project onto (pi-ai modelFields subset). */
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
 * Client-side pre-check replicating pi-ai resolveModelReasoning refusals
 * [audit 02-S3; B2 §4.2 R1–R7]. Returns null when the dict is legal, or a
 * {code, message} refusal. `efforts` is the raw reasoningEfforts value.
 */
export function validatePiAiReasoningEfforts(efforts) {
  if (efforts === undefined) return null; // R-inherit: keep catalog capability
  if (efforts === false) return null; // R6: false = non-reasoning model (legal)
  if (efforts === null || typeof efforts !== "object" || Array.isArray(efforts) || Object.keys(efforts).length === 0) {
    return { code: "efforts-empty", message: "reasoningEfforts is empty; declare levels, set false, or omit" };
  }
  const declared = PI_AI_LEVELS.filter((level) => efforts[level] !== undefined);
  for (const level of declared) {
    const wire = efforts[level];
    if (wire === null) {
      if (level !== "off") return { code: "efforts-null-non-off", message: `reasoningEfforts.${level}: only "off" may leave the wire value empty` };
    } else if (typeof wire !== "string" || wire.length === 0) {
      return { code: "efforts-empty-wire", message: `reasoningEfforts.${level}: wire value must be a non-empty string` };
    }
  }
  if (!declared.some((level) => level !== "off")) {
    return { code: "efforts-only-off", message: "reasoningEfforts offers no level beyond off; declare a thinking level or set false" };
  }
  // R5-adjacent: xhigh/max must be explicitly declared to be selectable —
  // that is a UI selection rule; here we only refuse UNKNOWN level keys that
  // pi-ai would silently ignore (THINKING_LEVELS unknown keys are dropped,
  // so writing them is allowed but useless — warn, not refuse).
  return null;
}

/** deepseek dialect gate [B2 §5; p1-precheck B2-Q3]: efforts dict → refuse. */
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
