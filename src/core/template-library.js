// 模板库：把「只能存一份默认模板」升级成可命名、可增删改、可选用的多份模板。
//
// 工单 #42。纯逻辑：不碰界面、不读网络，只读写注入的 storage（localStorage）。
//
// 与 default-template.js 的关系：
// - 库里每一份模板的 `values` 与 normalizeTemplate 同构，读写 / 填入表单复用
//   同一套结构收敛与描述文案。
// - 旧 key（单份默认模板）保留不动：读库时若新 key 不存在而旧 key 有值，把旧值
//   迁成库里第一份「我的模板」，并写回新 key。旧 key 不删 —— 回滚旧版本插件时
//   用户数据还在，且重复读取不会重复迁移（迁移结果已写回新 key）。
// - 所有 storage 访问都包 try/catch：隐私模式 / 禁用存储时读成空库、写入返回
//   false，界面据此提示「浏览器未开放本地存储」，绝不让整页崩掉。
//
// id 不用名字：改名后「最近选用」仍然指向同一份。id 形如
// `tpl-<时间戳>-<计数器><随机后缀>`，只含 [a-z0-9-]，同一毫秒内连续新增也不冲突。

import { DEFAULT_TEMPLATE_KEY, normalizeTemplate } from "./default-template.js";

/** 模板库的存储 key；结构变化时换版本号。 */
export const TEMPLATE_LIBRARY_KEY = "modelpilot.templates.v1";

/** 最近一次选用的模板 id；独立 key，删模板不影响它（读的时候再校验）。 */
export const TEMPLATE_SELECTION_KEY = "modelpilot.templates.selected.v1";

/** 模板库结构版本。 */
export const TEMPLATE_LIBRARY_VERSION = 1;

/** 单份模板的合法上限。 */
export const TEMPLATE_MAX_COUNT = 20;

/** 模板名称上限，按 Unicode 码点算。 */
export const TEMPLATE_NAME_MAX_LENGTH = 20;

/** 迁移旧单模板时使用的名字。 */
export const MIGRATED_TEMPLATE_NAME = "我的模板";

/** 名称校验错误文案（界面直接展示，测试按原文断言）。 */
export const TEMPLATE_NAME_ERRORS = Object.freeze({
  empty: "请填写模板名称",
  tooLong: "模板名称最多 20 个字",
  duplicate: "已有同名模板",
});

/** 模板计数 / 结构错误文案。 */
export const TEMPLATE_LIBRARY_ERRORS = Object.freeze({
  tooMany: `最多保存 ${TEMPLATE_MAX_COUNT} 份模板`,
  invalidValues: "模板至少需要一个输入模态（text 或 image）",
  missing: "模板不存在",
});

/** id 只允许小写字母、数字与连字符。 */
const TEMPLATE_ID_PATTERN = /^[a-z0-9-]+$/;

/** 同一毫秒内连续新增也不冲突的单调计数器。 */
let templateIdCounter = 0;

/** 纯对象的窄化判断；数组、null、类实例都不算。 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 按 Unicode 码点计数（不是 UTF-16 长度）。 */
function codePointLength(text) {
  return [...text].length;
}

function emptyLibrary() {
  return { version: TEMPLATE_LIBRARY_VERSION, templates: [] };
}

/** 名称比较键：去首尾空白 + 忽略大小写。 */
function nameKey(name) {
  return name.trim().toLowerCase();
}

/**
 * 名称校验；合法返回空字符串，否则返回可直接展示的中文文案。
 * @param {{templates: Array<{id:string,name:string}>}} library
 * @param {unknown} name
 * @param {string|null} exceptId  改名时排除自己
 */
function templateNameError(library, name, exceptId) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") return TEMPLATE_NAME_ERRORS.empty;
  if (codePointLength(trimmed) > TEMPLATE_NAME_MAX_LENGTH) return TEMPLATE_NAME_ERRORS.tooLong;
  const key = nameKey(trimmed);
  const duplicate = library.templates.some(
    (template) => template.id !== exceptId && nameKey(template.name) === key,
  );
  return duplicate ? TEMPLATE_NAME_ERRORS.duplicate : "";
}

/**
 * 一份模板：{ id, name, values }。id 不合法、名字为空 / 超长、values 非法都返回 null。
 * @param {unknown} value
 * @returns {{id:string, name:string, values:ReturnType<typeof normalizeTemplate>}|null}
 */
export function normalizeLibraryTemplate(value) {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!TEMPLATE_ID_PATTERN.test(id)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name === "" || codePointLength(name) > TEMPLATE_NAME_MAX_LENGTH) return null;
  const values = normalizeTemplate(value.values);
  if (values === null) return null;
  return { id, name, values };
}

/**
 * 整个库：{ version, templates: [...] }。丢弃非法项、按 id 去重、截断到上限。
 * 非对象 / templates 不是数组都返回空库。
 * @param {unknown} value
 * @returns {{version:number, templates:Array<{id:string,name:string,values:ReturnType<typeof normalizeTemplate>}>}}
 */
export function normalizeTemplateLibrary(value) {
  if (!isRecord(value) || !Array.isArray(value.templates)) return emptyLibrary();
  const seen = new Set();
  const templates = [];
  for (const raw of value.templates) {
    if (templates.length >= TEMPLATE_MAX_COUNT) break;
    const template = normalizeLibraryTemplate(raw);
    if (template === null || seen.has(template.id)) continue;
    seen.add(template.id);
    templates.push(template);
  }
  return { version: TEMPLATE_LIBRARY_VERSION, templates };
}

/**
 * 旧单模板 → 库里的第一份「我的模板」。旧 key 不存在 / 损坏 / 结构非法返回 null。
 * 不删除旧 key：回滚旧版本插件时用户数据还在。
 * @param {Pick<Storage,"getItem">} storage
 */
function migrateLegacyTemplate(storage) {
  let raw;
  try {
    raw = storage.getItem(DEFAULT_TEMPLATE_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  let legacy;
  try {
    legacy = normalizeTemplate(JSON.parse(raw));
  } catch {
    return null;
  }
  if (legacy === null) return null;
  const library = {
    version: TEMPLATE_LIBRARY_VERSION,
    templates: [{ id: nextTemplateId(emptyLibrary()), name: MIGRATED_TEMPLATE_NAME, values: legacy }],
  };
  // 写回新 key；写入失败（隐私模式）仍然把迁移结果交给界面，旧 key 保持不变。
  writeTemplateLibrary(storage, library);
  return library;
}

/**
 * 读库；损坏 / 不可读返回空库（不是 null —— 界面要能区分「空库」与「没有选」）。
 *
 * 新 key 不存在、旧单模板 key 有值时执行一次迁移（结果写回新 key，因此幂等）；
 * 两个 key 都有值时以新 key 为准，忽略旧值。
 * @param {Pick<Storage,"getItem">|undefined} storage
 */
export function readTemplateLibrary(storage) {
  if (!storage || typeof storage.getItem !== "function") return emptyLibrary();
  let raw;
  try {
    raw = storage.getItem(TEMPLATE_LIBRARY_KEY);
  } catch {
    return emptyLibrary();
  }
  if (raw !== null && raw !== undefined) {
    try {
      return normalizeTemplateLibrary(JSON.parse(raw));
    } catch {
      return emptyLibrary();
    }
  }
  return migrateLegacyTemplate(storage) ?? emptyLibrary();
}

/**
 * 写库；超上限或全非法返回 false。空库是合法结果（删到最后一份）。
 * @param {Pick<Storage,"setItem">|undefined} storage
 * @param {unknown} library
 */
export function writeTemplateLibrary(storage, library) {
  if (!isRecord(library) || !Array.isArray(library.templates)) return false;
  if (library.templates.length > TEMPLATE_MAX_COUNT) return false;
  const normalized = normalizeTemplateLibrary(library);
  if (library.templates.length > 0 && normalized.templates.length === 0) return false;
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(TEMPLATE_LIBRARY_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

/**
 * 新增一份模板。名字重复 / 超上限 / 结构非法都返回 { ok:false, error }，库不变。
 * @param {unknown} library
 * @param {unknown} name
 * @param {unknown} values
 */
export function addLibraryTemplate(library, name, values) {
  const current = normalizeTemplateLibrary(library);
  const nameError = templateNameError(current, name, null);
  if (nameError !== "") return { ok: false, error: nameError };
  if (current.templates.length >= TEMPLATE_MAX_COUNT) {
    return { ok: false, error: TEMPLATE_LIBRARY_ERRORS.tooMany };
  }
  const normalizedValues = normalizeTemplate(values);
  if (normalizedValues === null) return { ok: false, error: TEMPLATE_LIBRARY_ERRORS.invalidValues };
  const id = nextTemplateId(current);
  const template = { id, name: name.trim(), values: normalizedValues };
  return {
    ok: true,
    id,
    template,
    library: {
      version: TEMPLATE_LIBRARY_VERSION,
      templates: [...current.templates, template],
    },
  };
}

/**
 * 改名：名字重复（除了自己）返回 { ok:false, error }；id 不变。
 * @param {unknown} library
 * @param {unknown} id
 * @param {unknown} name
 */
export function renameLibraryTemplate(library, id, name) {
  const current = normalizeTemplateLibrary(library);
  const index = current.templates.findIndex((template) => template.id === id);
  if (index < 0) return { ok: false, error: TEMPLATE_LIBRARY_ERRORS.missing };
  const nameError = templateNameError(current, name, id);
  if (nameError !== "") return { ok: false, error: nameError };
  const templates = current.templates.map((template, position) =>
    position === index ? { ...template, name: name.trim() } : template,
  );
  return { ok: true, library: { version: TEMPLATE_LIBRARY_VERSION, templates } };
}

/**
 * 用新的 values 覆盖某一份（名字不变）。未知 id / values 非法返回 { ok:false, error }。
 * @param {unknown} library
 * @param {unknown} id
 * @param {unknown} values
 */
export function updateLibraryTemplate(library, id, values) {
  const current = normalizeTemplateLibrary(library);
  const index = current.templates.findIndex((template) => template.id === id);
  if (index < 0) return { ok: false, error: TEMPLATE_LIBRARY_ERRORS.missing };
  const normalizedValues = normalizeTemplate(values);
  if (normalizedValues === null) return { ok: false, error: TEMPLATE_LIBRARY_ERRORS.invalidValues };
  const templates = current.templates.map((template, position) =>
    position === index ? { ...template, values: normalizedValues } : template,
  );
  return { ok: true, library: { version: TEMPLATE_LIBRARY_VERSION, templates } };
}

/**
 * 删除某一份；删到空库是合法结果。未知 id 返回 { ok:false, error } 且库不变。
 * @param {unknown} library
 * @param {unknown} id
 */
export function removeLibraryTemplate(library, id) {
  const current = normalizeTemplateLibrary(library);
  const index = current.templates.findIndex((template) => template.id === id);
  if (index < 0) return { ok: false, error: TEMPLATE_LIBRARY_ERRORS.missing };
  return {
    ok: true,
    library: {
      version: TEMPLATE_LIBRARY_VERSION,
      templates: current.templates.filter((_, position) => position !== index),
    },
  };
}

/**
 * 按 id 找一份模板；未知 id（含非字符串）返回 null。
 * @param {unknown} library
 * @param {unknown} id
 */
export function findLibraryTemplate(library, id) {
  if (typeof id !== "string" || id === "") return null;
  const current = normalizeTemplateLibrary(library);
  return current.templates.find((template) => template.id === id) ?? null;
}

/**
 * 读「最近选用」。值不存在、不可读或指向已删除的模板都返回 null。
 * @param {Pick<Storage,"getItem">|undefined} storage
 * @param {unknown} library
 */
export function readTemplateSelection(storage, library) {
  if (!storage || typeof storage.getItem !== "function") return null;
  let raw;
  try {
    raw = storage.getItem(TEMPLATE_SELECTION_KEY);
  } catch {
    return null;
  }
  if (typeof raw !== "string" || raw === "") return null;
  return findLibraryTemplate(library, raw) === null ? null : raw;
}

/**
 * 写「最近选用」；成功返回 true。空 id / 不可写返回 false。
 * @param {Pick<Storage,"setItem">|undefined} storage
 * @param {unknown} id
 */
export function writeTemplateSelection(storage, id) {
  if (typeof id !== "string" || id === "") return false;
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(TEMPLATE_SELECTION_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成新模板 id：`tpl-<时间戳>-<计数器><随机后缀>`。
 *
 * 计数器保证同一毫秒内连续新增不冲突；随机后缀降低跨页面 / 跨标签页撞 id 的概率。
 * 只含 [a-z0-9-]（Date.now() 是数字，36 进制的计数器与随机数是小写字母 + 数字）。
 * @param {{templates: Array<{id:string}>}} library
 */
function nextTemplateId(library) {
  const stamp = Date.now();
  const used = new Set(library.templates.map((template) => template.id));
  for (let attempt = 0; attempt < 1000; attempt++) {
    templateIdCounter += 1;
    const counter = templateIdCounter.toString(36);
    const random = Math.random().toString(36).slice(2, 6) || "0";
    const id = `tpl-${stamp}-${counter}${random}`;
    if (TEMPLATE_ID_PATTERN.test(id) && !used.has(id)) return id;
  }
  // 1000 次都撞（实际上不可能）：退回只用计数器的确定性 id。
  return `tpl-${stamp}-c${templateIdCounter.toString(36)}`;
}
