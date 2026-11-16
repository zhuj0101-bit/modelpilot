// 内置模型预设：给第一次打开插件的用户一个能直接用的起点，而不是空白表单。
//
// 预设只是「推荐起点」，不是模型能力事实（docs/design-parts/B3-candidates-sources.md
// 的不变式 I5）：界面把值填进表单，用户仍然可以逐项修改；写入配置仍走原有路径。
//
// 纯数据 + 纯函数：不读网络、不读宿主 schema、不碰 localStorage。
// 本工单只做界面预设，candidates.js 的接线留给 P1-07。

/** 三个预设共用的推理档位（顺序与表单里的 PI_AI_LEVELS 筛选顺序一致）。 */
const PRESET_LEVELS = Object.freeze(["off", "low", "medium", "high"]);

/**
 * 三个内置预设。`values` 与「添加模型」表单 / 默认模板同构：
 * contextWindow / maxTokens 是 token 字符串，inputText / inputImage 是布尔，
 * reasoningLevels 是档位数组。`hint` 给 chip 的 title 用，写清具体数值。
 */
export const MODEL_PRESETS = Object.freeze([
  Object.freeze({
    id: "basic",
    label: "基础对话",
    // title 分三行：既有具体数值，又保持每行 ≤ 40 字（工单 #30 的悬停说明约束）。
    hint: "基础对话 · 日常问答、写作\n上下文 128000（128K） · 输出 8192（8K）\ntext · off,low,medium,high",
    values: Object.freeze({
      contextWindow: "128000",
      maxTokens: "8192",
      inputText: true,
      inputImage: false,
      reasoningLevels: PRESET_LEVELS,
    }),
  }),
  Object.freeze({
    id: "coding",
    label: "代码",
    hint: "代码 · 读代码、改代码\n上下文 200000（200K） · 输出 16384（16K）\ntext · off,low,medium,high",
    values: Object.freeze({
      contextWindow: "200000",
      maxTokens: "16384",
      inputText: true,
      inputImage: false,
      reasoningLevels: PRESET_LEVELS,
    }),
  }),
  Object.freeze({
    id: "long",
    label: "长文档",
    hint: "长文档 · 长文分析、整库阅读\n上下文 1000000（1M） · 输出 8192（8K）\ntext · off,low,medium,high",
    values: Object.freeze({
      contextWindow: "1000000",
      maxTokens: "8192",
      inputText: true,
      inputImage: false,
      reasoningLevels: PRESET_LEVELS,
    }),
  }),
]);

/** 预设 id 列表，顺序与 MODEL_PRESETS 一致。 */
export const MODEL_PRESET_IDS = Object.freeze(MODEL_PRESETS.map((preset) => preset.id));

/**
 * 按 id 找预设；未知 id、非字符串都返回 null，不抛错。
 * @param {unknown} id
 */
export function findModelPreset(id) {
  if (typeof id !== "string") return null;
  return MODEL_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** 取一个合法预设的 values 副本；结构不合法返回 null。 */
function presetValues(preset) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) return null;
  const values = preset.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const inputText = values.inputText === true;
  const inputImage = values.inputImage === true;
  // 两个模态都没勾时不能当模板用（normalizeTemplate 同样会拒绝）。
  if (!inputText && !inputImage) return null;
  if (typeof values.contextWindow !== "string" || typeof values.maxTokens !== "string") return null;
  const reasoningLevels = Array.isArray(values.reasoningLevels)
    ? values.reasoningLevels.filter((level) => typeof level === "string")
    : [];
  return {
    contextWindow: values.contextWindow,
    maxTokens: values.maxTokens,
    inputText,
    inputImage,
    reasoningLevels,
  };
}

/**
 * 预设 → 表单状态片段；与 templateToForm 同构。
 * 结构不合法返回 null。
 * @param {unknown} preset
 */
export function presetToForm(preset) {
  const values = presetValues(preset);
  if (values === null) return null;
  return {
    contextWindow: values.contextWindow,
    maxTokens: values.maxTokens,
    inputText: values.inputText,
    inputImage: values.inputImage,
    reasoningLevels: [...values.reasoningLevels],
  };
}

/**
 * 预设 → normalizeTemplate 认得的对象（还没有 version 字段，由它补）。
 * 结构不合法返回 null。
 * @param {unknown} preset
 */
export function presetToTemplate(preset) {
  const form = presetToForm(preset);
  if (form === null) return null;
  return {
    contextWindow: form.contextWindow,
    maxTokens: form.maxTokens,
    inputText: form.inputText,
    inputImage: form.inputImage,
    reasoningLevels: form.reasoningLevels,
  };
}

/** token 字段在表单里是字符串，也允许数字（预设值可能来自 JSON）。 */
function normalizeToken(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** 档位数组按顺序逐项比较；非数组按空数组处理。 */
function sameLevels(left, right) {
  const a = Array.isArray(left) ? left.filter((level) => typeof level === "string") : [];
  const b = Array.isArray(right) ? right.filter((level) => typeof level === "string") : [];
  return a.length === b.length && a.every((level, index) => level === b[index]);
}

/**
 * 表单值 → 命中的预设 id；不命中返回 null。
 *
 * 只有四个字段全部与某个预设相同时才算命中 —— 用户改过任何一个字段，
 * 界面就不该继续高亮那个预设。空的 token 与空档位不会命中任何预设。
 * @param {unknown} values
 */
export function detectPreset(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const contextWindow = normalizeToken(values.contextWindow);
  const maxTokens = normalizeToken(values.maxTokens);
  const inputText = values.inputText === true;
  const inputImage = values.inputImage === true;
  const levels = Array.isArray(values.reasoningLevels) ? values.reasoningLevels : [];
  for (const preset of MODEL_PRESETS) {
    const candidate = preset.values;
    if (normalizeToken(candidate.contextWindow) !== contextWindow) continue;
    if (normalizeToken(candidate.maxTokens) !== maxTokens) continue;
    if (candidate.inputText !== inputText || candidate.inputImage !== inputImage) continue;
    if (!sameLevels(candidate.reasoningLevels, levels)) continue;
    return preset.id;
  }
  return null;
}
