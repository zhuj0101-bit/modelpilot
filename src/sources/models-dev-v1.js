// models.dev v1 解析器（DESIGN-v2 §3 SourceRegistry；补齐 U6）。
// 端点：https://models.dev/api.json（匿名可访问）。夹具驱动的测试自行注入
// 文档 —— 本模块本身从不发起抓取。

export const PARSER_SCHEMA_VERSION = 1;
/** 保守的投毒守卫 [B3 §2.2]。 */
export const LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxProviders: 5000,
  maxModelsPerProvider: 1000,
  maxEntryBytes: 64 * 1024,
  maxReasoningOptions: 8,
});

/** 对文档求摘要用于变更检测（无 ETag 时的去重兜底）。 */
export function contentDigest(jsonText) {
  let hash = 0x811c9dc5; // FNV-1a 32 位 —— 做变更检测足够，非密码学用途
  for (let i = 0; i < jsonText.length; i++) {
    hash ^= jsonText.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${jsonText.length}`;
}

/**
 * 把一个 models.dev v1 文档解析成归一化条目。
 * 内容畸形时绝不抛异常 —— 畸形部分会被跳过并计数；只有根不是对象时
 * 才算结构性失败（调用方继续沿用上一个已知良好版本）[B3 I4]。
 * @returns {ok, entries, errors, digest}
 */
export function parseModelsDevV1(jsonText, { now = new Date().toISOString() } = {}) {
  const errors = [];
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, entries: [], errors: [{ code: "bad-json", message: String(error) }], digest: contentDigest(jsonText) };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, entries: [], errors: [{ code: "bad-root", message: "根节点不是 provider 映射" }], digest: contentDigest(jsonText) };
  }
  const providerIds = Object.keys(doc);
  if (providerIds.length > LIMITS.maxProviders) {
    return { ok: false, entries: [], errors: [{ code: "too-many-providers", message: `${providerIds.length}` }], digest: contentDigest(jsonText) };
  }
  const entries = [];
  for (const providerId of providerIds) {
    const provider = doc[providerId];
    if (typeof provider !== "object" || provider === null || Array.isArray(provider)) {
      errors.push({ code: "bad-provider", providerId });
      continue;
    }
    const models = provider.models;
    if (typeof models !== "object" || models === null || Array.isArray(models)) {
      errors.push({ code: "provider-no-models", providerId });
      continue;
    }
    for (const [modelId, model] of Object.entries(models)) {
      if (typeof model !== "object" || model === null || Array.isArray(model)) {
        errors.push({ code: "bad-model", providerId, modelId });
        continue;
      }
      const normalized = normalizeModel(providerId, provider, modelId, model, errors, now);
      if (normalized) entries.push(normalized);
    }
  }
  return { ok: true, entries, errors, digest: contentDigest(jsonText), schemaVersion: PARSER_SCHEMA_VERSION };
}

function normalizeModel(providerId, provider, modelId, model, errors, now) {
  const id = typeof model.id === "string" && model.id.length > 0 ? model.id : modelId;
  if (id.length === 0) {
    errors.push({ code: "model-no-id", providerId, modelId });
    return undefined;
  }
  const limit = typeof model.limit === "object" && model.limit !== null ? model.limit : {};
  const modalities = typeof model.modalities === "object" && model.modalities !== null ? model.modalities : {};
  // 上下文语义：有 limit.input → input；否则按 combined（U6 映射）
  const context = numberOrNull(limit.context);
  const contextSemantics = context === null ? "unknown" : numberOrNull(limit.input) !== null ? "input" : "combined";
  // 从 reasoning_options 取推理 controls（三种形态；有上限）
  const controls = [];
  const options = Array.isArray(model.reasoning_options) ? model.reasoning_options.slice(0, LIMITS.maxReasoningOptions) : [];
  for (const option of options) {
    if (typeof option !== "object" || option === null) continue;
    if (option.type === "toggle") controls.push({ kind: "toggle" });
    else if (option.type === "effort" && Array.isArray(option.values)) controls.push({ kind: "effort", values: option.values.filter((v) => typeof v === "string") });
    else if (option.type === "budget_tokens") controls.push({ kind: "budget", min: numberOrNull(option.min), max: numberOrNull(option.max) });
  }
  const input = Array.isArray(modalities.input) ? modalities.input.filter((m) => typeof m === "string") : undefined;
  const output = Array.isArray(modalities.output) ? modalities.output.filter((m) => typeof m === "string") : undefined;
  return {
    providerId,
    providerName: typeof provider.name === "string" ? provider.name : providerId,
    providerApi: typeof provider.api === "string" ? provider.api : undefined,
    id,
    name: typeof model.name === "string" ? model.name : id,
    family: typeof model.family === "string" ? model.family : undefined,
    canonicalModelId: typeof model.canonical_model_id === "string" ? model.canonical_model_id : undefined,
    status: model.status === "deprecated" ? "deprecated" : "active",
    context,
    contextSemantics,
    outputLimit: numberOrNull(limit.output),
    inputModalities: input,
    outputModalities: output,
    reasoning: {
      reasoningFlag: model.reasoning === true,
      controls,
    },
    cost: typeof model.cost === "object" && model.cost !== null ? { input: model.cost.input, output: model.cost.output } : undefined,
    observedAt: typeof model.last_updated === "string" ? model.last_updated : now,
    source: { kind: "models-dev-v1" },
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
