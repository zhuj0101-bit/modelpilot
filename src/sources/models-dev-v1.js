// models.dev v1 parser (DESIGN-v2 §3 SourceRegistry; gap-fill U6).
// Endpoint: https://models.dev/api.json (anonymous). Fixture-driven tests
// inject the document — this module never fetches on its own.

export const PARSER_SCHEMA_VERSION = 1;
/** Conservative poisoning guards [B3 §2.2]. */
export const LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxProviders: 5000,
  maxModelsPerProvider: 1000,
  maxEntryBytes: 64 * 1024,
  maxReasoningOptions: 8,
});

/** Digest two documents for change detection (ETag-less dedup fallback). */
export function contentDigest(jsonText) {
  let hash = 0x811c9dc5; // FNV-1a 32-bit — enough for change detection, not crypto
  for (let i = 0; i < jsonText.length; i++) {
    hash ^= jsonText.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${jsonText.length}`;
}

/**
 * Parse one models.dev v1 document into normalized entries.
 * Never throws for malformed content — malformed parts are skipped and
 * counted; only a non-object root fails structurally (caller keeps
 * last-known-good) [B3 I4].
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
    return { ok: false, entries: [], errors: [{ code: "bad-root", message: "root is not a provider map" }], digest: contentDigest(jsonText) };
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
  // context semantics: limit.input present → input; else combined (U6 mapping)
  const context = numberOrNull(limit.context);
  const contextSemantics = context === null ? "unknown" : numberOrNull(limit.input) !== null ? "input" : "combined";
  // reasoning controls from reasoning_options (three shapes; capped)
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
