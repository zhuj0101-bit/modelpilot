// 工单 #31：长模型列表的纯视图规则 —— 按 id 前缀分组、组内短名、
// 摘要去重，以及「详细 / 紧凑」密度偏好。
//
// 这里不碰 React / DOM / 配置：分组是纯视图，models 数组顺序属于用户
// （工单 #19 拖出来的），任何函数都不会改写入参，也不会生成 settingsOps。

/** 没有 `/`（或以 `/` 开头）的 id 归到这一组；「其他」永远排最后。 */
export const OTHER_GROUP = "其他";

/** 密度偏好的两个合法值：紧凑（默认）与详细。 */
export const DENSITY_COMPACT = "compact";
export const DENSITY_DETAILED = "detailed";

/** 全局偏好，与路由无关；结构变化时换版本号。 */
export const DENSITY_STORAGE_KEY = "modelpilot.model-list-density.v1";

/**
 * 模型 id 的第一段作为分组键；没有 `/` 的归到「其他」。
 * @param {unknown} id
 * @returns {string}
 */
export function groupKeyOf(id) {
  if (typeof id !== "string" || id === "") return OTHER_GROUP;
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : OTHER_GROUP;
}

/**
 * 组内显示的短名：去掉自己那一段前缀；不属于该组时原样返回。
 * @param {unknown} id
 * @param {string} group
 * @returns {string}
 */
export function shortIdOf(id, group) {
  if (typeof id !== "string") return "";
  const prefix = `${group}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** 组键字母序；「其他」最后。大小写只影响次序，不合并分组。 */
function compareGroupKeys(left, right) {
  if (left === right) return 0;
  if (left === OTHER_GROUP) return 1;
  if (right === OTHER_GROUP) return -1;
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left < right) return -1;
  return 1;
}

/**
 * 按 id 第一段分组：组按字母序，「其他」最后；组内保持 models 数组顺序。
 * 入参不会被修改，返回的行带着 models 数组的绝对下标。
 *
 * @param {unknown[]} models
 * @returns {{key:string, rows:{model:unknown,index:number,shortId:string}[]}[]}
 */
export function groupModelRows(models) {
  const list = Array.isArray(models) ? models : [];
  const byKey = new Map();
  list.forEach((model, index) => {
    const key = groupKeyOf(model?.id);
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, rows: [] };
      byKey.set(key, group);
    }
    const id = typeof model?.id === "string" ? model.id : "";
    group.rows.push({ model, index, shortId: shortIdOf(id, key) });
  });
  return [...byKey.values()].sort((left, right) => compareGroupKeys(left.key, right.key));
}

/**
 * 按分组后的阅读顺序给一行编号（1 起）：组间字母序、组内数组顺序。
 * 折叠 / 搜索不改变编号；编号只是显示位置，写盘仍用 models 数组绝对下标。
 *
 * @param {unknown[]} models
 * @param {number} index
 * @returns {number}
 */
export function groupedOrdinalOf(models, index) {
  let ordinal = 0;
  for (const group of groupModelRows(models)) {
    for (const row of group.rows) {
      ordinal += 1;
      if (row.index === index) return ordinal;
    }
  }
  return index + 1;
}

/**
 * 组内摘要去重：所有行摘要逐字相同且不止一行才提到组头，否则返回 null。
 * 混合时返回 null，让每行各自显示自己的摘要，不猜。
 *
 * @param {unknown[]} texts
 * @returns {string|null}
 */
export function sharedSummaryText(texts) {
  if (!Array.isArray(texts) || texts.length < 2) return null;
  const [first] = texts;
  if (typeof first !== "string") return null;
  return texts.every((text) => text === first) ? first : null;
}

/**
 * 读取密度偏好；读不到、被禁用或值非法时回落 compact。
 * @param {Pick<Storage,"getItem">|undefined} storage
 * @returns {"compact"|"detailed"}
 */
export function readModelListDensity(storage) {
  if (!storage || typeof storage.getItem !== "function") return DENSITY_COMPACT;
  try {
    const value = storage.getItem(DENSITY_STORAGE_KEY);
    return value === DENSITY_DETAILED ? DENSITY_DETAILED : DENSITY_COMPACT;
  } catch {
    return DENSITY_COMPACT;
  }
}

/**
 * 写入密度偏好；成功返回 true，非法值或存储不可用时返回 false。
 * @param {Pick<Storage,"setItem">|undefined} storage
 * @param {unknown} density
 * @returns {boolean}
 */
export function writeModelListDensity(storage, density) {
  if (density !== DENSITY_COMPACT && density !== DENSITY_DETAILED) return false;
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(DENSITY_STORAGE_KEY, density);
    return true;
  } catch {
    return false;
  }
}
