// P1-06：ProfileRepository —— 我们命名空间里的 StoredField 三态用户档案
// （DESIGN-v2 §10；a.md §3.B）。底层是一个普通对象门面，由宿主接到插件
// 自己的设置命名空间；测试里用夹具驱动。

import { modelKeyStorageKey, canonicalJson, digest } from "./domain.js";

export function createProfileRepository({ profiles = [], version = 1 } = {}) {
  const store = new Map();
  for (const record of profiles) store.set(record.storageKey, record);
  let profileVersion = version;

  return {
    /** 当前 desiredProfileVersion —— 每次变更都会自增（B5 §2.3）。 */
    get version() {
      return profileVersion;
    },

    /** 把 ModelKey + 三态字段归一成一条记录（键做百分号转义）。 */
    buildRecord(key, fields, { lockedFields = [] } = {}) {
      const storageKey = modelKeyStorageKey(key);
      return {
        storageKey,
        key: { ...key },
        // 每字段三态：{state:"value"|"inherit"|"cleared", value?, origin?}
        fields: {
          contextWindow: normalizeField(fields.contextWindow),
          outputBudget: normalizeField(fields.outputBudget),
          input: normalizeField(fields.input),
          reasoning: normalizeField(fields.reasoning),
        },
        lockedFields: [...lockedFields],
        updatedAt: new Date().toISOString(),
      };
    },

    get(storageKey) {
      return store.get(storageKey);
    },

    /** 保存（插入或更新）。版本自增；内容相同则指纹相同。 */
    save(record) {
      const existing = store.get(record.storageKey);
      const next = { ...record, updatedAt: new Date().toISOString() };
      // 期望版本守卫（B5 §2.3）：写入必须携带它所依据的版本；比已存记录更旧的
      // 一律视为过期并拒绝 —— 更新的期望状态绝不会被重放的写入覆盖掉。
      if (existing && existing._version !== undefined) {
        const incoming = record._version ?? existing._version;
        if (incoming < existing._version) {
          return { ok: false, error: "stale-write", currentVersion: existing._version };
        }
      }
      profileVersion += 1;
      store.set(record.storageKey, { ...next, _version: profileVersion });
      return { ok: true, revision: profileVersion, fingerprint: digest(canonicalJson(next.fields)) };
    },

    /** 清除某字段 → state:"cleared"、locked:true（以后不再自动填充）。 */
    clearField(storageKey, fieldId) {
      const record = store.get(storageKey);
      if (!record) return { ok: false, error: "not-found" };
      record.fields[fieldId] = { state: "cleared", locked: true };
      record.updatedAt = new Date().toISOString();
      profileVersion += 1;
      record._version = profileVersion;
      return { ok: true, revision: profileVersion };
    },

    /** 把已清除的字段重置回 inherit（用户解锁动作）。 */
    resetField(storageKey, fieldId) {
      const record = store.get(storageKey);
      if (!record) return { ok: false, error: "not-found" };
      record.fields[fieldId] = { state: "inherit" };
      profileVersion += 1;
      record._version = profileVersion;
      return { ok: true, revision: profileVersion };
    },

    /** 重开语义（P0-3 / a.md §5）：往返一次之后 cleared 仍然是 cleared。 */
    roundTrip(storageKey) {
      const record = store.get(storageKey);
      if (!record) return undefined;
      // 按设置命名空间的方式做序列化 / 反序列化（普通 JSON）
      const serialized = JSON.parse(JSON.stringify({ ...record, _version: undefined }));
      return serialized;
    },

    /** 另一条路由上的同名字段仍相互隔离（键里含路由）。 */
    keys() {
      return [...store.keys()];
    },
  };
}

function normalizeField(field) {
  if (field === undefined || field === null) return { state: "inherit" };
  if (typeof field === "string") return { state: field };
  return field; // {state:"value", value, origin} etc.
}
