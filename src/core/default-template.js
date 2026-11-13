// 默认模板：把「添加模型」表单里复用性最高的几个字段存成本地偏好，
// 下次打开/清空/写入成功后自动回填。
//
// 存 localStorage 而不是 DSH configForms：这是纯前端偏好，
// 写进 configForms 会变成 provider 配置的一部分。
//
// 所有 storage 访问都包了 try/catch —— 隐私模式或禁用存储时
// 读取失败应退化成「没有模板」，而不是让整页崩掉。

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
 * 从 storage 读出默认模板；没有、损坏或不可读时返回 null。
 * @param {Pick<Storage,"getItem">|undefined} storage
 */
export function readDefaultTemplate(storage) {
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
