// 默认模板：把「添加模型」表单里复用性最高的几个字段存成本地偏好，
// 下次打开/清空/写入成功后自动回填。
//
// 存 localStorage 而不是 DSH configForms：这是纯前端偏好，
// 写进 configForms 会变成 provider 配置的一部分。
//
// 所有 storage 访问都包了 try/catch —— 隐私模式或禁用存储时
// 读取失败应退化成内置预设，而不是让整页崩掉。
//
// 工单 #40：读不到用户模板时回落到内置的「基础对话」预设。这样第一次打开
// 插件就有可用的模板，「填入默认模板」不再是需要先手动配一条模型的循环依赖。
// 用户自己存的模板优先级始终高于内置预设。

import { MODEL_PRESETS, presetToTemplate } from "./model-presets.js";

/** localStorage key；结构变化时换版本号。 */
export const DEFAULT_TEMPLATE_KEY = "modelpilot.default-template.v1";

/** 模板结构版本。 */
export const DEFAULT_TEMPLATE_VERSION = 1;

/**
 * 把一个任意值收敛成合法模板；不合法返回 null。
 * @param {unknown} value
 * @returns {{version:number, contextWindow:string, maxTokens:string,
 *            inputText:boolean, inputImage:boolean, reasoningLevels:string[]}|null}
 */
export function normalizeTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contextWindow = typeof value.contextWindow === "string" ? value.contextWindow : "";
  const maxTokens = typeof value.maxTokens === "string" ? value.maxTokens : "";
  const inputText = value.inputText === true;
  const inputImage = value.inputImage === true;
  const reasoningLevels = Array.isArray(value.reasoningLevels)
    ? value.reasoningLevels.filter((l) => typeof l === "string")
    : [];
  // 两个模态都没勾时不能当模板用：投影会产生空 input，宿主会拒绝。
  if (!inputText && !inputImage) return null;
  return {
    version: DEFAULT_TEMPLATE_VERSION,
    contextWindow,
    maxTokens,
    inputText,
    inputImage,
    reasoningLevels,
  };
}

/**
 * 内置回落的模板：基础对话预设。
 * 先走 presetToTemplate，再交给 normalizeTemplate 补 version 与结构收敛。
 */
export function builtinDefaultTemplate() {
  return normalizeTemplate(presetToTemplate(MODEL_PRESETS[0]));
}

/**
 * 读取 storage 里的用户模板；没有、损坏或不可读时返回 null。
 * @param {Pick<Storage,"getItem">|undefined} storage
 */
function readStoredTemplate(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(DEFAULT_TEMPLATE_KEY);
    if (raw === null) return null;
    return normalizeTemplate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 从 storage 读出默认模板；用户没存过、数据损坏或不可读时回落到
 * 内置「基础对话」预设（不再返回 null）。
 * @param {Pick<Storage,"getItem">|undefined} storage
 */
export function readDefaultTemplate(storage) {
  return readStoredTemplate(storage) ?? builtinDefaultTemplate();
}

/**
 * storage 里是否有一份合法的用户模板；用于界面区分「默认模板」与「内置模板」。
 * @param {Pick<Storage,"getItem">|undefined} storage
 */
export function hasStoredDefaultTemplate(storage) {
  return readStoredTemplate(storage) !== null;
}

/**
 * 把模板写入 storage；成功返回 true。
 * @param {Pick<Storage,"setItem">|undefined} storage
 * @param {unknown} template
 */
export function writeDefaultTemplate(storage, template) {
  const normalized = normalizeTemplate(template);
  if (normalized === null) return false;
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(DEFAULT_TEMPLATE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

/**
 * 删除默认模板；成功返回 true（本来就没有也算成功）。
 * @param {Pick<Storage,"removeItem">|undefined} storage
 */
export function removeDefaultTemplate(storage) {
  if (!storage || typeof storage.removeItem !== "function") return false;
  try {
    storage.removeItem(DEFAULT_TEMPLATE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 模板 → 表单状态片段。
 * 模板为 null 时返回「空表单 + 默认档位」—— 即没有模板时的落点。
 * @param {ReturnType<typeof normalizeTemplate>} template
 */
export function templateToForm(template) {
  if (template === null) {
    return {
      contextWindow: "",
      maxTokens: "",
      inputText: true,
      inputImage: false,
      reasoningLevels: ["off", "low", "medium", "high"],
    };
  }
  return {
    contextWindow: template.contextWindow,
    maxTokens: template.maxTokens,
    inputText: template.inputText,
    inputImage: template.inputImage,
    reasoningLevels: [...template.reasoningLevels],
  };
}

/**
 * 表单状态 → 模板。
 * @param {{contextWindow:string, maxTokens:string, inputText:boolean,
 *          inputImage:boolean, reasoningLevels:string[]}} form
 */
export function formToTemplate(form) {
  return normalizeTemplate({
    contextWindow: form.contextWindow,
    maxTokens: form.maxTokens,
    inputText: form.inputText,
    inputImage: form.inputImage,
    reasoningLevels: form.reasoningLevels,
  });
}

/**
 * 一行描述，用于界面提示。
 * @param {ReturnType<typeof normalizeTemplate>} template
 * @param {(n: unknown) => string} humanize  humanizeTokenCount，注入以便测试
 */
export function describeTemplate(template, humanize) {
  if (template === null) return "";
  const parts = [];
  if (template.contextWindow.trim() !== "") {
    parts.push(`上下文 ${template.contextWindow}（${humanize(template.contextWindow)}）`);
  }
  if (template.maxTokens.trim() !== "") {
    parts.push(`输出 ${template.maxTokens}（${humanize(template.maxTokens)}）`);
  }
  const modes = [];
  if (template.inputText) modes.push("text");
  if (template.inputImage) modes.push("image");
  parts.push(modes.join(" + "));
  parts.push(template.reasoningLevels.length === 0 ? "不写档位" : template.reasoningLevels.join(","));
  return parts.join(" · ");
}

/** 档位集合：顺序无关（表单的顺序由 PI_AI_LEVELS 决定，不携带用户语义）。 */
function levelSet(levels) {
  return new Set(levels);
}

/**
 * 表单值是否与一份模板逐字段一致（工单 #43 缺陷 5）。
 *
 * 与 detectPreset 同一思路，但只回答「相等 / 不相等」，不判断命中了哪个预设：
 * - token 字段去掉首尾空白后按字符串比较（差一位就是不相等）；
 * - text / image 两个模态按布尔比较；
 * - 推理档位按集合比较：顺序不同但集合相同算一致。
 *
 * 任意一侧结构非法（两个模态都没勾、不是对象）都返回 false —— 表单此时也不
 * 是「与模板不同」，而是根本不能当模板用，调用方据此决定要不要提示。
 * @param {unknown} values  模板值（normalizeTemplate 同构）
 * @param {unknown} form    表单值（templateToForm / formToTemplate 同构）
 */
export function templateMatchesForm(values, form) {
  const template = normalizeTemplate(values);
  const current = normalizeTemplate(form);
  if (template === null || current === null) return false;
  if (template.contextWindow.trim() !== current.contextWindow.trim()) return false;
  if (template.maxTokens.trim() !== current.maxTokens.trim()) return false;
  if (template.inputText !== current.inputText) return false;
  if (template.inputImage !== current.inputImage) return false;
  const left = levelSet(template.reasoningLevels);
  const right = levelSet(current.reasoningLevels);
  if (left.size !== right.size) return false;
  for (const level of left) {
    if (!right.has(level)) return false;
  }
  return true;
}
